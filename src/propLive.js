'use strict';

/**
 * DEPARTAMENTUL PROP — ciclul LIVE (Forex, aur, indici; grafic zilnic).
 *
 * La fiecare lumânare zilnică nou închisă:
 *  1. reconstruiește starea fiecărui instrument cu ACELAȘI simulator ca backtest-ul (meanRevDesk.liveState);
 *  2. ieșiri: calculează rezultatul și actualizează contul urmărit (soldul estimat al contului tău de prop);
 *  3. intrări noi: Gardianul Prop decide dacă ai voie și cu ce risc; se calculează lotul exact;
 *  4. urmărește fazele examenului (țintă, zile minime) și te anunță la trecere sau la apropierea de limite.
 *
 * Contul e urmărit presupunând că execuți fiecare semnal trimis. Dacă soldul real diferă, setează
 * variabila PROP_BALANCE (GitHub → Settings → Variables) cu soldul real și sistemul se sincronizează.
 */
const { fetchDaily } = require('./data/dailySources');
const { liveState, DAY_MS } = require('./strategies/meanRevDesk');
const { decide } = require('./prop/guardian');
const { lotsFor } = require('./prop/lots');
const { PROP_RULES } = require('./prop/rules');
const { escapeHtml, roTime } = require('./notify/telegram');

const FRESH_MS = 36 * 3600e3; // un semnal mai vechi de 36h (ex. sistem oprit) nu mai e trimis ca intrare
const SAME_POS_MS = 30 * 3600e3; // sursele (Yahoo/Stooq) etichetează aceeași zi la ore diferite

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

function initAccount(desk, rules, now) {
  const initial = desk.accountSize || 10000;
  return {
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
    lastAsOf: {},
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
async function runPropCycle({ config, instruments, bus, notify, fetch, now = Date.now(), env = process.env }) {
  const desk = Object.assign({}, config.propDesk || {});
  if (!desk.enabled) return { skipped: 'PROP_DESK_DISABLED' };
  if (env.PROP_FIRM && PROP_RULES[env.PROP_FIRM]) desk.firm = env.PROP_FIRM;
  if (env.PROP_ACCOUNT_SIZE && Number(env.PROP_ACCOUNT_SIZE) > 0) desk.accountSize = Number(env.PROP_ACCOUNT_SIZE);
  const rules = PROP_RULES[desk.firm] || PROP_RULES.THE5ERS_HIGH_STAKES;
  const fetcher = fetch || ((sym, inst) => fetchDaily(inst, { now }));

  if (!bus.state.prop || bus.state.prop.firm !== desk.firm || bus.state.prop.initial !== (desk.accountSize || 10000)) {
    bus.state.prop = initAccount(desk, rules, now);
  }
  const acct = bus.state.prop;
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
  const report = { events: [], errors: {} };
  const series = {};
  const prices = {};

  for (const sym of desk.symbols || []) {
    const inst = instruments[sym];
    if (!inst) continue;
    try {
      const { candles } = await fetcher(sym, inst);
      if (!candles || candles.length < 250) throw new Error(`DATE_INSUFICIENTE(${candles ? candles.length : 0})`);
      series[sym] = candles;
      prices[sym] = candles[candles.length - 1].close;
    } catch (err) {
      report.errors[sym] = err.message;
      bus.logDiagnostic(`prop:${sym}`, err);
    }
  }

  for (const sym of Object.keys(series)) {
    const inst = instruments[sym];
    const candles = series[sym];
    const asOf = candles[candles.length - 1].timestamp + DAY_MS;
    if (acct.lastAsOf[sym] === asOf) continue;
    acct.lastAsOf[sym] = asOf;

    const { position, lastClosed } = liveState(sym, candles, inst, desk.params, { barMs: DAY_MS });
    const prev = acct.positions[sym];

    // 1. Ieșire
    if (prev && !samePos(position, prev)) {
      delete acct.positions[sym];
      const closed = samePos(lastClosed, prev) ? lastClosed : null;
      const r = closed ? closed.resultR : 0;
      const pnl = prev.riskUsd * r;
      acct.balance += pnl;
      acct.history.push({ sym, direction: prev.direction, openedAt: prev.openedAt, closedAt: closed ? closed.closedAt : now, r, pnl, outcome: closed ? closed.outcome : 'NECUNOSCUT' });
      if (acct.history.length > 300) acct.history.shift();
      const why = !closed ? 'poziția s-a închis' : (closed.outcome === 'STOP' ? 'stop-ul a fost atins (s-a închis singur la broker)' : (closed.outcome === 'TIME' ? 'a expirat timpul maxim de 10 zile — ÎNCHIDE ACUM' : 'prețul a revenit peste/sub media scurtă — ÎNCHIDE ACUM'));
      await notify([
        `⏹️ <b>PROP: ${escapeHtml(sym)}</b> ${prev.direction === 'LONG' ? '(cumpărare)' : '(vânzare)'}: ${why}.`,
        `Rezultat estimat: <b>${r >= 0 ? '+' : ''}${r.toFixed(2)}R ≈ ${money(pnl)}</b>.`,
        progressLine(acct, rules)
      ].join('\n'));
      report.events.push({ sym, event: 'EXIT', r });
    }
    const skippedHere = acct.skipped[sym] != null && position && Math.abs(position.openedAt - acct.skipped[sym]) < SAME_POS_MS;
    if (acct.skipped[sym] != null && !skippedHere) delete acct.skipped[sym];

    if (!position || acct.positions[sym] || skippedHere) continue;

    // 2. Semnal nou: la prima pornire sau dacă e vechi, nu îl trimitem (nu intrăm în tranzacții deja începute)
    if (firstRun || now - position.openedAt > FRESH_MS) {
      acct.skipped[sym] = position.openedAt;
      continue;
    }
    const openRisk = Object.values(acct.positions).reduce((s, p) => s + p.riskUsd, 0);
    const d = decide(
      { initial: acct.initial, balance: acct.balance, dayStartBalance: acct.dayStart, openRisk, highestEod: acct.highestEod, phaseTarget: phaseTarget(acct, rules) },
      rules,
      { riskPct: desk.riskPct, safety: desk.safety, maxOpen: desk.maxOpen, openCount: Object.keys(acct.positions).length }
    );
    if (!d.allow) {
      acct.skipped[sym] = position.openedAt;
      if (d.reason !== 'ȚINTA_ATINSĂ') await notify(`🛡️ <b>PROP: ${escapeHtml(sym)}</b> semnal ignorat de Gardian (${d.reason.replace(/_/g, ' ').toLowerCase()}). Nu face nimic.`);
      report.events.push({ sym, event: 'SKIP', reason: d.reason });
      continue;
    }
    const stopDist = Math.abs(position.entry - position.stop);
    const lot = lotsFor(inst, d.riskAmount, stopDist, prices);
    if (!lot.ok) {
      acct.skipped[sym] = position.openedAt;
      report.events.push({ sym, event: 'SKIP', reason: lot.reason });
      continue;
    }
    acct.positions[sym] = Object.assign({}, position, { riskUsd: lot.actualRiskUsd, lots: lot.lots });
    const day = dayKeyIn(now, rules.resetTz);
    if (!acct.tradingDays.includes(day)) acct.tradingDays.push(day);
    const long = position.direction === 'LONG';
    const pts = stopDist / inst.pipSize;
    await notify([
      `📈 <b>SEMNAL PROP: ${escapeHtml(sym)}</b> ${long ? '🟢 CUMPĂRĂ (Buy)' : '🔴 VINDE (Sell)'} la prețul pieței`,
      `📦 Lot: <b>${lot.lots.toFixed(2)}</b> (risc ${money(lot.actualRiskUsd)} = ${(lot.actualRiskUsd / acct.initial * 100).toFixed(2)}% din cont)`,
      `🛑 Stop loss: la <b>${pts.toFixed(inst.pipSize >= 1 ? 0 : 1)} ${inst.category === 'FX' ? 'pips' : 'puncte'}</b> ${long ? 'SUB' : 'PESTE'} prețul tău de intrare`,
      `📍 Preț de referință (închiderea zilei): ${fmtPx(position.entry, inst)} → stop ≈ ${fmtPx(position.stop, inst)}`,
      `🎯 Fără take-profit fix: primești mesaj de ÎNCHIDERE (de obicei în 1–5 zile).`,
      `🕒 Semnal din ${roTime(position.openedAt)} (ora României).`,
      progressLine(acct, rules),
      roomLine(acct, rules)
    ].join('\n'));
    report.events.push({ sym, event: 'ENTRY', lots: lot.lots, riskUsd: lot.actualRiskUsd });
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
      const openSyms = Object.keys(acct.positions);
      acct.positions = {};
      acct.balance = acct.initial;
      acct.dayStart = acct.initial;
      acct.highestEod = acct.initial;
      acct.tradingDays = [];
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
    await notify(`🚀 <b>APEX PROP a pornit</b>: ${rules.name}, cont ${money(acct.initial)}, ${(desk.symbols || []).length} instrumente (Forex, aur, indici).\n` +
      `Semnalele vin după închiderea zilnică, cu lot exact și stop. Riscul de bază e de ${desk.riskPct}% pe tranzacție; Gardianul îl reduce automat ca să nu atingi niciodată limitele (${(rules.dailyLoss * 100).toFixed(0)}% pe zi, ${(rules.maxLoss * 100).toFixed(0)}% total).\n` +
      `Pozițiile deja începute în piață NU îți sunt trimise. Așteptăm semnale noi.`);
  }
  bus.saveSnapshot();
  report.account = { phase: acct.phase, balance: acct.balance, open: Object.keys(acct.positions) };
  return report;
}

/** Rezumatul pentru mesajul zilnic. */
function propSummary(acct, config) {
  if (!acct) return null;
  const rules = PROP_RULES[acct.firm] || PROP_RULES.THE5ERS_HIGH_STAKES;
  const pos = Object.values(acct.positions || {});
  const lines = pos.map((p) => `• ${p.symbol} ${p.direction === 'LONG' ? 'cumpărare' : 'vânzare'}, ${p.lots.toFixed(2)} loturi, risc ${money(p.riskUsd)} (din ${roTime(p.openedAt)})`);
  return `💼 <b>Contul de prop</b> (${rules.name})\n${progressLine(acct, rules)}\n${roomLine(acct, rules)}\n` + (pos.length ? `Poziții deschise:\n${lines.join('\n')}` : 'Nicio poziție deschisă.');
}

module.exports = { runPropCycle, propSummary, initAccount, dayKeyIn, samePos };
