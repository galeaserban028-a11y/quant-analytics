'use strict';

/**
 * SISTEMUL DE TEST „TONI” (failed auction, profil TPO, M15), SEPARAT de sistemul zilnic (APEX PROP).
 * Piețe: Nasdaq, S&P 500, DAX, aur, EUR/USD, GBP/USD, fiecare în sesiunea ei.
 *
 * Indicii rulează VARIANTA 2 (doar deschideri în afara zonei de valoare, TP la marginea opusă; vezi strategies/amtAgent.js):
 * backtest Nasdaq +0,16R, S&P +0,21R, DAX +0,05R pe tranzacție. Aur (−0,13R), EUR/USD (−0,19R) și GBP/USD (−0,10R) rămân pe
 * varianta 1, doar pentru scor: acolo nicio variantă testată nu a ieșit pe plus. De aceea e doar TEST: mesajele sunt marcate 🧪 TEST, iar sistemul își ține singur scorul
 * pe fiecare piață, cu prețuri reale. O piață „trece testul” doar după ≥ 50 de tranzacții live cu media ≥ +0,05R și t ≥ 1,5.
 *
 * Risk management (pentru un cont separat de 5.000 $, implicit 1% pe tranzacție):
 *  - cel mult o poziție pe piață și 3 în total; după 2 pierderi în aceeași zi pe o piață, acea piață se oprește până mâine;
 *  - fiecare tranzacție se închide cel târziu la finalul sesiunii pieței (nimic peste noapte).
 * Implicit sistemul deschide și închide SINGUR tranzacțiile, pe hârtie, fără mesaje pe fiecare tranzacție; trimite doar
 * un rezumat zilnic (după 23:15 ora României, în zilele cu tranzacții închise) cu media pe fiecare piață.
 * Variabile: TONI_SIGNALS=1 trimite și fiecare intrare/ieșire (pentru demo), TONI_ACCOUNT, TONI_RISK_PCT.
 */
const A = require('../strategies/amtAgent');
const { lotsFor } = require('../prop/lots');
const { zonedToUtc } = require('../data/dailySources');
/** Ora (UTC) la care începe/se termină sesiunea pieței în ziua locală `day` a pieței. */
function sessionUtc(day, mk, minutes) { const [y, m, d] = day.split('-').map(Number); return zonedToUtc(y, m, d, Math.floor(minutes / 60), minutes % 60, mk.tz); }
const roHM = (t) => new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));

const MIN_TRADES = 50, MIN_MEAN = 0.05, T_MIN = 1.5, MAX_OPEN = 3;
const M15 = A.M15;

function stats(trades) {
  const r = trades.map((t) => t.r), n = r.length;
  if (!n) return { n: 0, mean: 0, t: 0, totalR: 0, wins: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, wins: r.filter((x) => x > 0).length, mean: Number(mean.toFixed(4)), t: sd > 0 ? Number((mean / (sd / Math.sqrt(n))).toFixed(2)) : 0, totalR: Number(r.reduce((a, b) => a + b, 0).toFixed(2)) };
}
const fmtDist = (mk, d) => (mk.pip ? `${(d / mk.pip).toFixed(1)} pips` : `${d.toFixed(mk.dp)} ${mk.unit}`);

/**
 * @param {(sym, mk) => Promise<Array<{t,o,h,l,c}>>} p.fetchBars lumânări de 15 minute (UTC, ms), ultimele ~60 de zile
 * @param {object} p.instruments instrumentele cu contract size-ul brokerului tău (pentru lot)
 */
async function runToniCycle({ bus, instruments, fetchBars, notify = null, now = Date.now(), env = {} }) {
  if (!bus.state.toni || bus.state.toni.v !== 2) bus.state.toni = { v: 2, startedAt: now, trades: [], open: {}, seen: {}, slot: {}, lossDay: {}, passed: {} };
  const book = bus.state.toni;
  const slot = Math.floor((now - 60e3) / M15);
  // Semnale reale pe Telegram doar pentru piețele din TONI_SIGNAL_SYMS (implicit doar US500, la cererea utilizatorului, 13.11.2026);
  // restul piețelor rulează doar pe hârtie, pentru scor. TONI_SIGNALS=1 trimite pentru toate.
  const signalSyms = String(env.TONI_SIGNAL_SYMS != null ? env.TONI_SIGNAL_SYMS : 'SPX500').split(',').map((x) => x.trim()).filter(Boolean);
  const sendFor = (sym) => Boolean(notify) && (env.TONI_SIGNALS === '1' || signalSyms.includes(sym));
  const SHOWN = { SPX500: 'US500', NAS100: 'US100', GER40: 'GER40', XAUUSD: 'XAUUSD', EURUSD: 'EURUSD', GBPUSD: 'GBPUSD' };
  const account = Number(env.TONI_ACCOUNT || 5000), riskPct = Number(env.TONI_RISK_PCT || 1);
  const report = { opened: 0, closed: 0, skipped: 0, errors: {} };
  const prices = {};
  const series = {};

  for (const [sym, mk] of Object.entries(A.MARKETS)) {
    if (book.slot[sym] === slot && !book.open[sym]) continue;
    try { series[sym] = await fetchBars(sym, mk); } catch (err) { report.errors[sym] = err.message; continue; }
    book.slot[sym] = slot;
    series[sym] = (series[sym] || []).filter((b) => b.t + M15 <= now - 30e3).sort((a, b) => a.t - b.t);
    const last = series[sym][series[sym].length - 1];
    if (last) prices[sym] = last.c;
  }

  // 0. Nivelurile zilei (VAH, POC, VAL de ieri) pe Telegram, înainte de deschidere: indicii americani la 16:00–16:29, DAX la 09:45–09:59
  //    (ora României), în zilele lucrătoare. Ca să poți trage liniile pe grafic fără să calculezi nimic. TONI_LEVELS=0 le oprește.
  if (notify && env.TONI_LEVELS !== '0') {
    const ro = A.local(now, 'Europe/Bucharest');
    const wd = new Date(ro.day + 'T12:00:00Z').getUTCDay();
    // fereastra mesajului: cu 30 de minute înainte de deschiderea reală (ora României se schimbă când SUA/Europa trec la altă oră)
    const mkGroup = (key, syms, ref) => {
      const mk = A.MARKETS[ref], day = A.local(now, mk.tz).day;
      const open = sessionUtc(day, mk, mk.s0), close = sessionUtc(day, mk, mk.s1);
      const f = A.local(open - 30 * 60e3, 'Europe/Bucharest').m, t = A.local(open, 'Europe/Bucharest').m;
      return { key, from: f, to: t, syms, open: roHM(open), end: roHM(close), late: roHM(open + 75 * 60e3), closed: A.isClosedDay(day, mk.tz) };
    };
    const groups = [mkGroup('us', ['SPX500', 'NAS100'].filter((x) => signalSyms.includes(x) || env.TONI_SIGNALS === '1'), 'SPX500'),
      mkGroup('dax', ['GER40'].filter((x) => signalSyms.includes(x) || env.TONI_SIGNALS === '1'), 'GER40')];
    book.levelsDay = book.levelsDay || {};
    for (const g of groups) {
      if (wd === 0 || wd === 6 || g.closed || !g.syms.length || ro.m < g.from || ro.m >= g.to || book.levelsDay[g.key] === ro.day) continue;
      const lines = [];
      for (const sym of g.syms) {
        const bars = series[sym], mk = A.MARKETS[sym];
        if (!bars || bars.length < 100) continue;
        const today = A.local(now, mk.tz).day;
        const prev = A.sessions(bars, mk).filter((x) => x.full && x.day < today).pop();
        if (!prev) continue;
        const bin = bars[prev.idx[0]].c * 0.0005, va = A.valueArea(bars, prev.idx, bin), last = bars[bars.length - 1].c;
        const f = (v) => v.toFixed(mk.dp === 0 ? 0 : 1);
        const shown = { SPX500: 'US500', NAS100: 'US100', GER40: 'GER40' }[sym];
        lines.push(`<b>${shown}</b>: VAH <b>${f(va.VAH)}</b> · POC <b>${f(va.POC)}</b> · VAL <b>${f(va.VAL)}</b>  (preț de referință acum: ${f(last)})`);
      }
      if (!lines.length) continue;
      book.levelsDay[g.key] = ro.day;
      await notify([`📏 <b>Nivelurile de azi</b> (strategia M15, din sesiunea de ieri)`, ...lines, '',
        `Dacă în platforma ta prețul diferă de referință, adaugă aceeași diferență la toate nivelurile.`,
        `La <b>${g.open}</b> te uiți unde se deschide:`,
        `• <b>în afara benzii</b> (sub VAL / peste VAH) ⇒ aștepți revenirea în bandă (până pe la ${g.late}) ⇒ intri spre bandă, TP la marginea opusă;`,
        `• <b>în bandă, pe la mijloc</b> ⇒ aștepți 2 lumânări M15 la rând închise afară, doar în direcția trendului ⇒ intri cu ieșirea, SL la mijlocul benzii, TP 1,5R.`,
        `Semnalul îți vine pe Telegram când e cazul. Închizi tot la ${g.end}.`].join('\n'));
    }
  }

  for (const [sym, bars] of Object.entries(series)) {
    const mk = A.MARKETS[sym];
    if (bars.length < 300) { report.errors[sym] = `DATE_INSUFICIENTE(${bars.length})`; continue; }

    // 1. Poziția deschisă: SL, TP sau finalul sesiunii?
    const op = book.open[sym];
    if (op) {
      const ei = bars.findIndex((b) => b.t === op.entryT);
      const res = ei >= 0 ? A.settle(bars, ei, op, mk, now) : null;
      const lostTrack = ei < 0 && now - op.entryT > 2 * 864e5;
      if ((res && !res.invalid) || lostTrack || (res && res.invalid)) {
        delete book.open[sym];
        if (res && !res.invalid) {
          const tr = { sym, setup: op.setup, dir: op.dir, openedAt: op.entryT, closedAt: res.closedAt, outcome: res.outcome, r: Number(res.r.toFixed(3)), sent: op.sent };
          book.trades.push(tr);
          report.closed++;
          if (res.r < 0) book.lossDay[sym + op.day] = (book.lossDay[sym + op.day] || 0) + 1;
          if (op.sent && sendFor(sym)) {
            const sc = stats(book.trades.filter((t) => t.sym === sym));
            const usd = res.r * op.riskUsd;
            const head = res.outcome === 'TP' ? '✅' : (res.outcome === 'SL' ? '⛔' : '⏰');
            const what = res.outcome === 'TP' ? 'a atins TP-ul (s-a închis singur)' : (res.outcome === 'SL' ? 'a atins SL-ul (s-a închis singur)' : 's-a terminat sesiunea — ÎNCHIDE ACUM dacă e încă deschisă');
            await notify(`${head} <b>M15 · ${SHOWN[sym] || sym}</b> ${what}\n` +
              `Rezultat: ${res.r >= 0 ? '+' : ''}${res.r.toFixed(2)}R (≈ ${usd >= 0 ? '+' : '−'}${Math.abs(usd).toFixed(0)} $ la ${riskPct}% risc)\n` +
              `Scorul pe ${sym}: ${sc.n} tranzacții, media ${sc.mean >= 0 ? '+' : ''}${sc.mean.toFixed(2)}R, total ${sc.totalR >= 0 ? '+' : ''}${sc.totalR}R`);
          }
        }
      }
    }

    // 2. Semnal nou pe ultima lumânare încheiată
    if (book.open[sym]) continue;
    const last = bars[bars.length - 1];
    if (now - last.t > 2 * 3600e3 || book.seen[sym] === last.t) continue;
    const sig = A.findSignals(bars, mk).filter((s) => s.t === last.t);
    book.seen[sym] = last.t;
    if (!sig.length) continue;
    const s = sig[0];
    const nOpen = Object.keys(book.open).length;
    if ((book.lossDay[sym + s.day] || 0) >= 2 || nOpen >= MAX_OPEN) { report.skipped++; continue; }
    const riskUsd = account * riskPct / 100;
    const dist = Math.abs(last.c - s.stop) + mk.cost;
    const tpDist = Math.abs(s.tp - last.c);
    if (!(tpDist > mk.cost) || s.dir * (s.tp - last.c) <= 0) { report.skipped++; continue; }
    const inst = instruments[sym];
    const lot = inst ? lotsFor(inst, riskUsd, dist, prices) : { ok: false, reason: 'INSTRUMENT_LIPSĂ' };
    book.open[sym] = { dir: s.dir, stop: s.stop, tp: s.tp, setup: s.setup, inside: Boolean(s.inside), day: s.day, entryT: last.t + M15, ref: last.c, riskUsd: lot.ok ? lot.actualRiskUsd : riskUsd, sent: sendFor(sym) };
    report.opened++;
    if (sendFor(sym)) {
      const px = (v) => v.toFixed(mk.dp === 0 ? 0 : 1);
      const slPx = s.dir > 0 ? last.c - dist : last.c + dist, tpPx = s.tp;
      await notify([
        `${s.dir > 0 ? '🟢 <b>BUY' : '🔴 <b>SELL'}</b> · strategia M15`,
        `Pe ce: <b>${SHOWN[sym] || sym}</b> (${mk.name.split(' (')[0]})`,
        `Time frame: <b>M15</b> (se închide cel târziu la finalul sesiunii, ${roHM(sessionUtc(s.day, mk, mk.s1))})`,
        `Intrare: <b>ACUM</b>, la prețul pieței · referință ~${px(last.c)}`,
        `Stop loss: <b>~${px(slPx)}</b> (${fmtDist(mk, dist)} ${s.dir > 0 ? 'sub' : 'peste'} intrare)`,
        s.inside
          ? `Take profit: <b>~${px(tpPx)}</b> (${fmtDist(mk, tpDist)}, 1,5R)`
          : `Take profit: <b>~${px(tpPx)}</b> (${fmtDist(mk, tpDist)}, marginea ${s.dir > 0 ? 'de sus (VAH)' : 'de jos (VAL)'} a zonei de valoare, ~${(tpDist / dist).toFixed(1)}R)`,
        `Tipul zilei: ${s.inside ? 'deschidere ÎN bandă ⇒ ieșire acceptată în direcția trendului' : 'deschidere ÎN AFARA benzii ⇒ revenire în bandă'}`,
        `Lot: <b>${lot.ok ? lot.lots.toFixed(2) : '— (' + lot.reason.replace(/_/g, ' ').toLowerCase() + ')'}</b> (risc ${riskPct}% = ${riskUsd.toFixed(0)} $)`,
        `<i>Dacă prețul tău de intrare e altul decât referința, păstrează aceleași distanțe pentru stop loss și take profit. Strategie nouă: încă se dovedește live.</i>`
      ].join('\n'));
    }
  }

  // 3. Scorul pe fiecare piață: anunță o singură dată când o piață trece testul
  report.stats = {};
  for (const sym of Object.keys(A.MARKETS)) {
    const sc = stats(book.trades.filter((t) => t.sym === sym));
    report.stats[sym] = sc;
    if (!book.passed[sym] && sc.n >= MIN_TRADES && sc.mean >= MIN_MEAN && sc.t >= T_MIN) {
      book.passed[sym] = { at: now, stats: sc };
      if (notify) await notify(`🎓 <b>TEST TONI: ${A.MARKETS[sym].name} a trecut testul live</b>: ${sc.n} tranzacții pe prețuri reale, media +${sc.mean}R (t = ${sc.t}). Putem discuta trecerea pe un cont real separat.`);
    }
  }
  // 4. Rezumatul zilei (o dată pe zi, după 23:15 ora României, doar dacă s-au închis tranzacții azi)
  const ro = A.local(now, 'Europe/Bucharest');
  if (notify && ro.m >= 23 * 60 + 15 && book.summaryDay !== ro.day) {
    const isToday = (t) => A.local(t.closedAt, 'Europe/Bucharest').day === ro.day;
    const todays = book.trades.filter(isToday);
    if (todays.length) {
      book.summaryDay = ro.day;
      const sign = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
      const lines = [`🧪 <b>TEST TONI · rezumatul zilei</b> (tranzacții pe hârtie, făcute automat; nu faci nimic)`];
      lines.push(`Azi: ${todays.length} tranzacții, ${todays.filter((t) => t.r > 0).length} pe plus, total ${sign(todays.reduce((a, t) => a + t.r, 0))}R (≈ ${sign(todays.reduce((a, t) => a + t.r, 0) * account * riskPct / 100, 0)} $ la ${riskPct}% risc)`);
      lines.push('', '<b>Media de la pornire, pe fiecare piață:</b>');
      for (const sym of Object.keys(A.MARKETS)) {
        const sc = report.stats[sym];
        if (!sc.n) continue;
        lines.push(`${A.MARKETS[sym].name}: ${sc.n} tranz., media ${sign(sc.mean)}R, total ${sign(sc.totalR)}R${book.passed[sym] ? ' 🎓' : ''}`);
      }
      const all = stats(book.trades);
      lines.push('', `<b>Total:</b> ${all.n} tranzacții, media ${sign(all.mean)}R (pe 5.000 $ la ${riskPct}%: ${sign(all.totalR * account * riskPct / 100, 0)} $). Testul e trecut la ≥ ${MIN_TRADES} tranzacții pe o piață cu media ≥ +${MIN_MEAN}R.`);
      await notify(lines.join('\n'));
    }
  }
  if (book.trades.length > 5000) book.trades.splice(0, book.trades.length - 5000);
  return report;
}

module.exports = { runToniCycle, stats, MIN_TRADES };
