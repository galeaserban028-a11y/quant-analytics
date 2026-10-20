'use strict';

/**
 * DEPARTAMENTUL PROP — ciclul LIVE (indici, grafic zilnic, mai multe strategii).
 *
 * Rulează des (din 5 în 5 minute pe GitHub), dar descarcă date doar când e nevoie: imediat după închiderea
 * oficială a fiecărei burse (+10 minute) și, în rest, cel mult o dată pe oră. Astfel semnalul ajunge la tine
 * la ~10–15 minute după închidere, cât piața CFD e încă deschisă.
 *
 * La fiecare lumânare zilnică nou închisă, pentru fiecare strategie activă:
 *  1. reconstruiește starea cu ACELAȘI simulator ca backtest-ul (dailyLab.liveState);
 *  2. ieșiri: calculează rezultatul și actualizează contul urmărit (soldul estimat al contului tău de prop);
 *  3. intrări noi: Gardianul Prop decide dacă ai voie și cu ce risc; se calculează lotul exact;
 *  4. urmărește fazele examenului (țintă, zile minime) și te anunță la trecere sau la apropierea de limite.
 *
 * Contul e urmărit presupunând că execuți fiecare semnal trimis. Dacă soldul real diferă, setează
 * variabila PROP_BALANCE (GitHub → Settings → Variables) cu soldul real și sistemul se sincronizează.
 */
const { fetchDaily, sessionCloseUtc, todayCloseUtc, CLOSE_BUFFER_MS } = require('./data/dailySources');
const lab = require('./strategies/dailyLab');
const { decide } = require('./prop/guardian');
const { lotsFor } = require('./prop/lots');
const { PROP_RULES } = require('./prop/rules');
const { escapeHtml, roTime } = require('./notify/telegram');
const { nameFor } = require('./research/team');

const DAY_MS = 864e5;
const FRESH_MS = 36 * 3600e3; // o lumânare închisă acum mai mult de 36h (ex. sistem oprit) nu mai produce intrări
const SAME_POS_MS = 30 * 3600e3; // sursele (Yahoo/Stooq) etichetează aceeași zi la ore diferite
const REFETCH_MS = 55 * 60e3; // în afara ferestrei de după închidere, cel mult o descărcare pe oră
const DUE_WINDOW_MS = 4 * 3600e3; // fereastra de după închidere în care verificăm la fiecare rulare
const STATE_VERSION = 2;

/** Aceeași poziție? (aceeași direcție, deschisă în aceeași zi de tranzacționare, indiferent de sursa datelor) */
function samePos(a, b) {
  return Boolean(a && b) && a.direction === b.direction && Math.abs(a.openedAt - b.openedAt) < SAME_POS_MS;
}

function dayKeyIn(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function fmtPx(v, inst) {
  return Number.isFinite(v) ? v.toFixed(inst.decimals) : 'n/a';
}

function money(v) {
  return `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} $`;
}

/** Strategiile active (compatibil cu configurația veche, care avea o singură strategie în `params`). */
function deskStrategies(desk) {
  if (Array.isArray(desk.strategies) && desk.strategies.length) return desk.strategies;
  return [{ kind: 'rsi2', name: 'Pullback RSI(2)', params: Object.assign({ kind: 'rsi2' }, desk.params || {}) }];
}

function initAccount(desk, rules, now) {
  const initial = desk.accountSize || 10000;
  return {
    v: STATE_VERSION,
    firm: desk.firm,
    phase: 0,
    initial,
    balance: initial,
    dayKey: null,
    dayStart: initial,
    highestEod: initial,
    tradingDays: [],
    positions: {},
    skipped: {},
    lastBarClose: {},
    lastFetch: {},
    initialized: false,
    history: [],
    startedAt: now
  };
}

function phaseTarget(acct, rules) {
  return acct.phase < rules.phases.length ? rules.phases[acct.phase] : null;
}

function phaseLabel(acct, rules) {
  return acct.phase < rules.phases.length ? `Faza ${acct.phase + 1} din ${rules.phases.length}` : 'Cont FINANȚAT';
}

function progressLine(acct, rules) {
  const t = phaseTarget(acct, rules);
  const pnl = acct.balance - acct.initial;
  if (t == null) return `${phaseLabel(acct, rules)}: sold estimat ${money(acct.balance)} (profit ${money(pnl)}).`;
  const goal = acct.initial * t;
  const pct = Math.max(0, Math.min(100, pnl / goal * 100));
  return `${phaseLabel(acct, rules)}: sold estimat ${money(acct.balance)}, țintă ${money(acct.initial + goal)} (progres ${pct.toFixed(0)}%).`;
}

function roomLine(acct, rules) {
  const lostToday = Math.max(0, acct.dayStart - acct.balance);
  const openRisk = Object.values(acct.positions).reduce((s, p) => s + p.riskUsd, 0);
  const dailyLeft = acct.initial * rules.dailyLoss - lostToday - openRisk;
  const floor = acct.initial * (1 - rules.maxLoss);
  return `Gardian: risc deschis ${money(openRisk)} · mai poți pierde azi ${money(Math.max(0, dailyLeft))} până la limita zilnică · distanță până la limita totală ${money(acct.balance - floor)}.`;
}

/** Momentul la care lumânarea zilnică s-a închis (ora oficială a bursei, sau +24h pentru instrumentele fără program). */
function barCloseOf(bar, inst) {
  return inst.closeTz && inst.closeTime ? sessionCloseUtc(bar.timestamp, inst) : bar.timestamp + DAY_MS;
}

/** Trebuie descărcate date acum pentru acest instrument? */
function shouldFetch(acct, sym, inst, now) {
  const last = acct.lastFetch[sym];
  if (!last) return true;
  if (inst.closeTz && inst.closeTime) {
    const c = todayCloseUtc(inst, now);
    const due = now >= c + CLOSE_BUFFER_MS && now <= c + DUE_WINDOW_MS && (acct.lastBarClose[sym] || 0) < c;
    if (due) return true;
  }
  return now - last >= REFETCH_MS;
}

const lotsTxt = (x) => x.toFixed(2);

/**
 * Mesajele unui instrument la o rulare: întâi ieșirile, apoi intrările, câte UN mesaj pentru fiecare.
 * Când mai mulți traderi intră deodată pe același instrument, în aceeași direcție, primești un singur semnal cu lotul
 * TOTAL; la ieșire, mesajul spune exact ce lot închizi și ce rămâne deschis.
 */
async function flushSymbol({ sym, inst, acct, rules, label, barClose, outExits, outEntries, notify }) {
  const tag = label === 'APEX PROP' ? 'PROP' : 'FOREX';
  const unit = inst.category === 'FX' ? 'pips' : 'puncte';
  const newKeys = new Set(outEntries.map((e) => e.key));
  const stillOpen = () => Object.entries(acct.positions).filter(([k]) => k.split('|')[0] === sym && !newKeys.has(k)).map(([, p]) => p);
  if (outExits.length) {
    const left = stillOpen();
    const lines = [`⏹️ <b>${tag}: ${escapeHtml(sym)}</b> ${outExits[0].prev.direction === 'LONG' ? '(cumpărare)' : '(vânzare)'}`];
    for (const x of outExits) {
      const why = x.why.replace(/ — ÎNCHIDE ACUM$/, '');
      const action = x.outcome === 'STOP' ? 'Nu faci nimic.' : `<b>ÎNCHIDE ${x.prev.lots != null && (left.length || outExits.length > 1) ? lotsTxt(x.prev.lots) + ' loturi' : 'ACUM'}</b>.`;
      lines.push(`• ${escapeHtml(x.who)}: ${why}. ${action} Rezultat estimat: <b>${x.r >= 0 ? '+' : ''}${x.r.toFixed(2)}R ≈ ${money(x.pnl)}</b>`);
    }
    if (left.length) lines.push(`Rămâne deschis pe ${escapeHtml(sym)}: ${lotsTxt(left.reduce((t, p) => t + (p.lots || 0), 0))} loturi (${left.map((p) => escapeHtml((p.who || '').split(' (')[0])).join(', ')}). Pe acelea NU le închide.`);
    else if (outExits.filter((x) => x.outcome !== 'STOP').length > 1) lines.push(`➡️ Închizi TOT ce ai pe ${escapeHtml(sym)}.`);
    lines.push(progressLine(acct, rules));
    await notify(lines.join('\n'));
  }
  const groups = {};
  for (const e of outEntries) (groups[e.position.direction] = groups[e.position.direction] || []).push(e);
  for (const [dir, es] of Object.entries(groups)) {
    const long = dir === 'LONG';
    const totalLots = es.reduce((t, e) => t + e.lot.lots, 0);
    const totalRisk = es.reduce((t, e) => t + e.lot.actualRiskUsd, 0);
    const sameStop = es.every((e) => Math.abs(e.position.stop - es[0].position.stop) < inst.pipSize / 2);
    const pts = (e) => (e.stopDist / inst.pipSize).toFixed(inst.pipSize >= 1 ? 0 : 1);
    const lines = [`📈 <b>SEMNAL ${tag}: ${escapeHtml(sym)}</b> ${long ? '🟢 CUMPĂRĂ (Buy)' : '🔴 VINDE (Sell)'} la prețul pieței, ACUM`];
    if (es.length === 1) lines.push(`🧠 Trader: ${escapeHtml(es[0].who)}`);
    else lines.push(`🧠 ${es.length} traderi de acord: ${es.map((e) => `${escapeHtml(e.who)} ${lotsTxt(e.lot.lots)}`).join(' · ')}`);
    if (sameStop) {
      lines.push(`📦 Lot${es.length > 1 ? ' TOTAL' : ''}: <b>${lotsTxt(totalLots)}</b> (risc ${money(totalRisk)} = ${(totalRisk / acct.initial * 100).toFixed(2)}% din cont)${es.length > 1 ? '. Îl poți deschide ca o singură poziție; la ieșire îți spun exact cât închizi.' : ''}`);
      lines.push(`🛑 Stop loss: la <b>${pts(es[0])} ${unit}</b> ${long ? 'SUB' : 'PESTE'} prețul tău de intrare`);
      lines.push(`📍 Preț de referință (închiderea de azi): ${fmtPx(es[0].position.entry, inst)} → stop ≈ ${fmtPx(es[0].position.stop, inst)}`);
    } else {
      lines.push(`📦 Deschide ${es.length} poziții separate (stopuri diferite), risc total ${money(totalRisk)} = ${(totalRisk / acct.initial * 100).toFixed(2)}% din cont:`);
      es.forEach((e, k) => lines.push(`  ${k + 1}) lot <b>${lotsTxt(e.lot.lots)}</b>, stop la <b>${pts(e)} ${unit}</b> ${long ? 'SUB' : 'PESTE'} intrare (≈ ${fmtPx(e.position.stop, inst)}) · ${escapeHtml((e.who || '').split(' (')[0])}`));
      lines.push(`📍 Preț de referință (închiderea de azi): ${fmtPx(es[0].position.entry, inst)}`);
    }
    const pu = es[0].pointUsd;
    lines.push(`🔎 Presupus: 1 lot = ${pu < 1 ? pu.toFixed(3) : pu.toFixed(2)} $ pe ${inst.category === 'FX' ? 'pip' : 'punct'}. Verifică în platformă (specificațiile contractului); dacă diferă, NU intra și setează PROP_CONTRACT_SIZES.${totalLots > 20 ? ' ⚠️ Lot neobișnuit de mare: verifică de două ori!' : ''}`);
    lines.push('🎯 Fără take-profit fix: primești mesaj de ÎNCHIDERE (de obicei în 1–5 zile).');
    lines.push(`⏱️ ${inst.category === 'FX' ? 'Ziua Forex' : 'Bursa'} s-a închis la ${roTime(barClose)} (ora României). Intră cât mai repede; dacă au trecut peste 12 ore, sari peste.`);
    lines.push(progressLine(acct, rules));
    lines.push(roomLine(acct, rules));
    await notify(lines.join('\n'));
  }
}

/**
 * @param {object} p
 * @param {object} p.config config efectiv (cu propDesk)
 * @param {object} p.instruments config/forex_instruments.json
 * @param {object} p.bus MarketStateBus (pentru persistență: bus.state.prop)
 * @param {(t:string)=>Promise} p.notify
 * @param {(sym, inst)=>Promise<{candles}>} [p.fetch] injectabil (teste)
 * @param {number} [p.now]
 * @param {object} [p.env] suprascrieri: PROP_BALANCE, PROP_ACCOUNT_SIZE, PROP_FIRM, PROP_PHASE
 */
async function runPropCycle({ config, instruments: instrumentsIn, bus, notify, fetch, now = Date.now(), env = process.env, deskKey = 'propDesk', stateKey = 'prop', label = 'APEX PROP', simOpts = {} }) {
  const desk = Object.assign({}, config[deskKey] || {});
  if (!desk.enabled) return { skipped: 'PROP_DESK_DISABLED' };
  let instruments = instrumentsIn;
  if (env.PROP_FIRM && PROP_RULES[env.PROP_FIRM]) desk.firm = env.PROP_FIRM;
  if (env.PROP_ACCOUNT_SIZE && Number(env.PROP_ACCOUNT_SIZE) > 0) desk.accountSize = Number(env.PROP_ACCOUNT_SIZE);
  const rules = PROP_RULES[desk.firm] || PROP_RULES.THE5ERS_HIGH_STAKES;
  // Valoarea unui punct diferă de la firmă la firmă (ex. JP225: 1 sau 100 yeni pe punct la 1 lot). PROP_CONTRACT_SIZES
  // o corectează: „JP225=100,GER40=1”. Fără ea folosim valorile din config/forex_instruments.json.
  instruments = applyContractSizes(instruments, env.PROP_CONTRACT_SIZES);
  const strategies = deskStrategies(desk);
  const benched = new Set(desk.benched || []);
  const fetcher = fetch || ((sym, inst) => fetchDaily(inst, { now }));

  const prevAcct = bus.state[stateKey];
  if (!prevAcct || prevAcct.v !== STATE_VERSION || prevAcct.firm !== desk.firm || prevAcct.initial !== (desk.accountSize || 10000)) {
    bus.state[stateKey] = initAccount(desk, rules, now);
  }
  const acct = bus.state[stateKey];
  // Sincronizare manuală cu soldul real (opțional)
  if (env.PROP_BALANCE && Number(env.PROP_BALANCE) > 0 && Number(env.PROP_BALANCE) !== acct.syncedBalance) {
    acct.balance = Number(env.PROP_BALANCE);
    acct.syncedBalance = acct.balance;
  }
  // PROP_PHASE se aplică doar când îi schimbi valoarea (altfel ar anula trecerea automată la faza următoare)
  const envPhase = Number(env.PROP_PHASE);
  if (Number.isInteger(envPhase) && envPhase >= 1 && envPhase <= rules.phases.length + 1 && envPhase !== acct.syncedPhase) {
    acct.phase = envPhase - 1;
    acct.syncedPhase = envPhase;
  }

  // Ziua de tranzacționare a firmei (resetul limitei zilnice)
  const today = dayKeyIn(now, rules.resetTz);
  if (acct.dayKey !== today) {
    acct.highestEod = Math.max(acct.highestEod, acct.balance);
    acct.dayStart = acct.balance;
    acct.dayKey = today;
  }

  const firstRun = !acct.initialized;
  const report = { events: [], errors: {}, fetched: [] };
  const series = {};
  const prices = {};

  // Conversia valutară (EUR, GBP, JPY, AUD) are nevoie de cursuri: le luăm din ultimele prețuri cunoscute
  Object.assign(prices, acct.fxRates || {});

  for (const sym of desk.symbols || []) {
    const inst = instruments[sym];
    if (!inst) continue;
    if (!firstRun && !shouldFetch(acct, sym, inst, now)) continue;
    try {
      const { candles } = await fetcher(sym, inst);
      if (!candles || candles.length < 250) throw new Error(`DATE_INSUFICIENTE(${candles ? candles.length : 0})`);
      acct.lastFetch[sym] = now;
      series[sym] = candles;
      report.fetched.push(sym);
    } catch (err) {
      report.errors[sym] = err.message;
      bus.logDiagnostic(`prop:${sym}`, err);
    }
  }
  // cursurile pentru conversie (perechile majore), cel mult o dată pe oră
  await refreshFxRates(acct, instruments, desk.symbols || [], fetcher, now, prices, report);

  for (const sym of Object.keys(series)) {
    const inst = instruments[sym];
    const candles = series[sym];
    const lastBar = candles[candles.length - 1];
    const barClose = barCloseOf(lastBar, inst);
    if (acct.lastBarClose[sym] === barClose) continue; // nimic nou închis
    acct.lastBarClose[sym] = barClose;
    prices[sym] = lastBar.close;
    const stale = now - barClose > FRESH_MS;

    const outExits = [], outEntries = []; // mesajele se trimit la final, câte UNUL pe instrument (nu câte unul pe trader)
    for (const st of strategies) {
      if (st.symbols && !st.symbols.includes(sym)) continue; // agenții Academiei au fiecare perechea lui
      const key = st.id ? `${sym}|${st.id}` : `${sym}|${st.kind}`;
      const who = st.who || `${nameFor(st.kind, sym)} (${st.name || st.kind})`;
      const params = Object.assign({ kind: st.kind }, st.params);
      const { position, lastClosed } = lab.liveState(sym, candles, inst, params, Object.assign({ barMs: DAY_MS }, simOpts));
      const prev = acct.positions[key];

      // 1. Ieșire
      if (prev && !samePos(position, prev)) {
        delete acct.positions[key];
        const closed = samePos(lastClosed, prev) ? lastClosed : null;
        const r = closed ? closed.resultR : 0;
        const pnl = prev.riskUsd * r;
        acct.balance += pnl;
        acct.history.push({ sym, strategy: st.kind, agent: st.id || null, direction: prev.direction, openedAt: prev.openedAt, closedAt: closed ? closed.closedAt : now, r, pnl, outcome: closed ? closed.outcome : 'NECUNOSCUT' });
        if (acct.history.length > 300) acct.history.shift();
        const why = !closed ? 'poziția s-a închis' : (closed.outcome === 'STOP' ? 'stop-ul a fost atins (s-a închis singur la broker)' : (closed.outcome === 'TIME' ? `a expirat timpul maxim de ${params.maxDays || 10} zile — ÎNCHIDE ACUM` : 'prețul a revenit — ÎNCHIDE ACUM'));
        outExits.push({ who, prev, r, pnl, why, outcome: closed ? closed.outcome : null });
        report.events.push({ sym, strategy: st.kind, event: 'EXIT', r });
      }
      const skippedHere = acct.skipped[key] != null && position && Math.abs(position.openedAt - acct.skipped[key]) < SAME_POS_MS;
      if (acct.skipped[key] != null && !skippedHere) delete acct.skipped[key];

      if (!position || acct.positions[key] || skippedHere) continue;

      // O singură poziție pe pereche (când mai mulți agenți tranzacționează aceeași pereche)
      if (desk.onePerSymbol && Object.values(acct.positions).some((p) => p.symbol === sym)) {
        acct.skipped[key] = position.openedAt;
        report.events.push({ sym, strategy: st.kind, event: 'SKIP', reason: 'PERECHE_OCUPATĂ' });
        continue;
      }

      // Traderii de pe bancă nu deschid poziții noi (pozițiile deja deschise le închid normal)
      if (benched.has(key)) {
        acct.skipped[key] = position.openedAt;
        report.events.push({ sym, strategy: st.kind, event: 'SKIP', reason: 'BANCĂ' });
        continue;
      }

      // Frâna de urgență: dacă rezultatele live sunt mult sub teste, nu mai deschidem nimic până la reluare
      if (acct.paused) {
        acct.skipped[key] = position.openedAt;
        report.events.push({ sym, strategy: st.kind, event: 'SKIP', reason: 'PAUZĂ' });
        continue;
      }

      // 2. Semnal nou: doar dacă s-a deschis pe ULTIMA lumânare, proaspăt închisă (nu intrăm în tranzacții deja începute)
      const onLastBar = position.openedAt >= lastBar.timestamp + DAY_MS - SAME_POS_MS / 2;
      if (firstRun || stale || !onLastBar) {
        acct.skipped[key] = position.openedAt;
        continue;
      }
      const openRisk = Object.values(acct.positions).reduce((s, p) => s + p.riskUsd, 0);
      const d = decide(
        { initial: acct.initial, balance: acct.balance, dayStartBalance: acct.dayStart, openRisk, highestEod: acct.highestEod, phaseTarget: phaseTarget(acct, rules), tradingDays: acct.tradingDays.length },
        rules,
        { riskPct: desk.riskPct, safety: desk.safety, maxOpen: desk.maxOpen, openCount: Object.keys(acct.positions).length }
      );
      if (!d.allow) {
        acct.skipped[key] = position.openedAt;
        if (d.reason !== 'ȚINTA_ATINSĂ') await notify(`🛡️ <b>PROP: ${escapeHtml(sym)}</b> semnal ignorat de Gardian (${d.reason.replace(/_/g, ' ').toLowerCase()}). Nu face nimic.`);
        report.events.push({ sym, strategy: st.kind, event: 'SKIP', reason: d.reason });
        continue;
      }
      const stopDist = Math.abs(position.entry - position.stop);
      const lot = lotsFor(inst, d.riskAmount, stopDist, prices);
      if (!lot.ok) {
        acct.skipped[key] = position.openedAt;
        report.events.push({ sym, strategy: st.kind, event: 'SKIP', reason: lot.reason });
        if (lot.reason === 'CONVERSIE_LIPSĂ') await notify(`⚠️ <b>PROP: ${escapeHtml(sym)}</b> semnal sărit: lipsește cursul valutar pentru calculul lotului. Nu face nimic.`);
        continue;
      }
      acct.positions[key] = Object.assign({}, position, { strategy: st.kind, agent: st.id || null, who, riskUsd: lot.actualRiskUsd, lots: lot.lots });
      const day = dayKeyIn(now, rules.resetTz);
      if (!acct.tradingDays.includes(day)) acct.tradingDays.push(day);
      const pointUsd = (inst.contractSize || 1) * inst.pipSize * (lot.perLotRiskUsd / ((inst.contractSize || 1) * stopDist));
      outEntries.push({ key, who, position, lot, stopDist, pointUsd });
      report.events.push({ sym, strategy: st.kind, event: 'ENTRY', lots: lot.lots, riskUsd: lot.actualRiskUsd });
    }
    await flushSymbol({ sym, inst, acct, rules, label, barClose, outExits, outEntries, notify });
  }

  // Reluare după pauză: PROP_RESUME cu o valoare nouă (ex. data de azi)
  if (acct.paused && env.PROP_RESUME && env.PROP_RESUME !== acct.resumeToken) {
    acct.paused = null;
    acct.resumeToken = env.PROP_RESUME;
    acct.breakerFrom = acct.history.length; // evaluarea reîncepe de la zero
    await notify(`▶️ <b>${label}: reluat</b> (PROP_RESUME=${escapeHtml(env.PROP_RESUME)}). Semnalele noi vin din nou.`);
  }
  const brk = breakerCheck(acct.history.slice(acct.breakerFrom || 0), desk.expectedR != null ? desk.expectedR : 0.04);
  if (brk && !acct.paused) {
    acct.paused = { at: now, why: brk };
    await notify(`⛔ <b>${label}: FRÂNĂ DE URGENȚĂ</b>\n${brk}\nNu mai intru în tranzacții noi. Pozițiile deschise le închid normal. Verifică dacă execuți corect semnalele (lot, stop, ora). Pentru reluare setează variabila PROP_RESUME în GitHub (orice valoare nouă, de exemplu data de azi).`);
    report.events.push({ event: 'PAUSED', why: brk });
  }

  // 3. Fazele examenului
  const target = phaseTarget(acct, rules);
  const floor = acct.initial * (1 - rules.maxLoss);
  if (acct.balance <= floor || acct.dayStart - acct.balance > acct.initial * rules.dailyLoss) {
    if (!acct.breachNotified) {
      acct.breachNotified = true;
      await notify(`🚨 <b>PROP: limită atinsă (după calculul estimat)</b>. Verifică imediat contul în platformă. Dacă soldul real e altul, setează variabila PROP_BALANCE.`);
    }
  } else if (target != null && acct.balance >= acct.initial * (1 + target)) {
    if (acct.tradingDays.length >= (rules.minDays || 0)) {
      const passed = phaseLabel(acct, rules);
      acct.phase += 1;
      const openSyms = Array.from(new Set(Object.values(acct.positions).map((p) => p.symbol)));
      acct.positions = {};
      acct.balance = acct.initial;
      acct.dayStart = acct.initial;
      acct.highestEod = acct.initial;
      acct.tradingDays = [];
      acct.minDaysNotified = false;
      await notify(`🎉 <b>${passed} TRECUTĂ</b> (după calculul estimat)! Verifică în platformă.\n` +
        (openSyms.length ? `Închide pozițiile rămase: ${openSyms.join(', ')}.\n` : '') +
        (acct.phase < rules.phases.length ? `Când primești contul pentru ${phaseLabel(acct, rules)}, sistemul continuă automat (țintă ${(rules.phases[acct.phase] * 100).toFixed(0)}%).` : 'Urmează contul FINANȚAT: aceleași reguli, iar profitul îl retragi lunar.'));
      report.events.push({ event: 'PHASE_PASSED', phase: acct.phase });
    } else if (!acct.minDaysNotified) {
      acct.minDaysNotified = true;
      await notify(`✅ <b>Ținta e atinsă</b>, dar firma cere minim ${rules.minDays} zile de tranzacționare (ai ${acct.tradingDays.length}). Verifică regula exactă a firmei (unele cer și profit minim pe zi). Nu mări riscul.`);
    }
  }

  // Pornim când majoritatea instrumentelor au date (un singur simbol stricat nu blochează sistemul)
  const nSyms = (desk.symbols || []).length;
  if (firstRun && Object.keys(series).length > 0 && Object.keys(report.errors).length * 2 < nSyms) {
    acct.initialized = true;
    await notify(`🚀 <b>${label} a pornit</b>: ${rules.name}, cont ${money(acct.initial)}, ${nSyms} instrumente, ${strategies.length} ${label === 'APEX PROP' ? 'strategii' : 'agenți ELITĂ'} (${strategies.slice(0, 8).map((s) => escapeHtml(s.who || s.name || s.kind)).join(', ')}${strategies.length > 8 ? '…' : ''}).\n` +
      `Semnalele vin după închiderea zilei, cu lot exact și stop. Riscul de bază e de ${desk.riskPct}% pe tranzacție; Gardianul îl reduce automat ca să nu atingi niciodată limitele (${(rules.dailyLoss * 100).toFixed(0)}% pe zi, ${(rules.maxLoss * 100).toFixed(0)}% total).\n` +
      `Pozițiile deja începute în piață NU îți sunt trimise. Așteptăm semnale noi.` +
      (label === 'APEX PROP' ? '' : `\n⚠️ Semnalele FOREX sunt pentru un cont SEPARAT de cel cu indici (alt examen). Pe același cont riscurile s-ar aduna și ai putea depăși limita zilnică.`));
  }
  bus.saveSnapshot();
  report.account = { phase: acct.phase, balance: acct.balance, open: Object.keys(acct.positions) };
  return report;
}

/** Suprascrie valoarea contractului per instrument: „JP225=100,GER40=1”. */
function applyContractSizes(instruments, spec) {
  if (!spec) return instruments;
  const out = Object.assign({}, instruments);
  for (const part of String(spec).split(',')) {
    const [sym, val] = part.split('=').map((x) => (x || '').trim());
    const v = Number(val);
    if (out[sym] && v > 0) out[sym] = Object.assign({}, out[sym], { contractSize: v });
  }
  return out;
}

/**
 * Frâna de urgență: oprește intrările noi dacă rezultatele live ies clar din ce au arătat testele.
 *  - după cel puțin 20 de tranzacții, media live e sub cea așteptată cu mai mult de 2,5 erori standard; sau
 *  - 15 pierderi la rând (în teste, cea mai lungă serie a fost 14).
 */
function breakerCheck(history, expectedR = 0.04) {
  const rs = history.map((h) => h.r).filter(Number.isFinite);
  let streak = 0, worst = 0;
  for (const r of rs) { streak = r < 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  if (worst >= 15) return `${worst} pierderi la rând (în teste, cea mai lungă serie a fost 14).`;
  if (rs.length >= 20) {
    const n = rs.length, m = rs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) || 1;
    const t = (m - expectedR) / (sd / Math.sqrt(n));
    if (t < -2.5) return `După ${n} tranzacții live, media e ${m.toFixed(2)}R, mult sub ${expectedR.toFixed(2)}R cât au arătat testele (diferență statistică clară).`;
  }
  return null;
}

const FX_FOR = { EUR: 'EURUSD', GBP: 'GBPUSD', AUD: 'AUDUSD', NZD: 'NZDUSD', JPY: 'USDJPY', CAD: 'USDCAD', CHF: 'USDCHF' };

/** Cursurile necesare pentru loturile instrumentelor cotate în altă monedă decât USD (EUR, GBP, JPY, AUD). */
async function refreshFxRates(acct, instruments, symbols, fetcher, now, prices, report) {
  acct.fxRates = acct.fxRates || {};
  const need = new Set();
  for (const sym of symbols) {
    const p = instruments[sym];
    if (p && p.quoteCurrency && FX_FOR[p.quoteCurrency]) need.add(FX_FOR[p.quoteCurrency]);
  }
  if (acct.fxFetchedAt && now - acct.fxFetchedAt < REFETCH_MS && need.size && [...need].every((s) => acct.fxRates[s] > 0)) return;
  for (const s of need) {
    const inst = instruments[s];
    if (!inst) continue;
    try {
      const { candles } = await fetcher(s, inst);
      if (candles && candles.length) { acct.fxRates[s] = candles[candles.length - 1].close; prices[s] = acct.fxRates[s]; }
    } catch (err) {
      report.errors[`fx:${s}`] = err.message;
    }
  }
  acct.fxFetchedAt = now;
}

/** Rezumatul pentru mesajul zilnic. */
function propSummary(acct, config) {
  if (!acct) return null;
  const rules = PROP_RULES[acct.firm] || PROP_RULES.THE5ERS_HIGH_STAKES;
  const pos = Object.values(acct.positions || {});
  const lines = pos.map((p) => `• ${p.symbol} ${p.direction === 'LONG' ? 'cumpărare' : 'vânzare'}, ${p.lots.toFixed(2)} loturi, risc ${money(p.riskUsd)} (din ${roTime(p.openedAt - DAY_MS)})`);
  return `💼 <b>Contul de prop</b> (${rules.name})\n${progressLine(acct, rules)}\n${roomLine(acct, rules)}\n` + (pos.length ? `Poziții deschise:\n${lines.join('\n')}` : 'Nicio poziție deschisă.');
}

module.exports = { flushSymbol, runPropCycle, propSummary, initAccount, dayKeyIn, samePos, shouldFetch, deskStrategies, barCloseOf, breakerCheck, applyContractSizes };
