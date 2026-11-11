'use strict';

/**
 * SISTEMUL DE TEST „TONI” (failed auction, profil TPO, M15), SEPARAT de sistemul zilnic (APEX PROP).
 * Piețe: Nasdaq, S&P 500, DAX, aur, EUR/USD, GBP/USD, fiecare în sesiunea ei.
 *
 * Backtest (Dukascopy M15, costuri incluse, reguli fixate dinainte): indici ≈ 0 (−0,01…−0,05R), aur −0,13R, EUR/USD −0,19R,
 * GBP/USD −0,10R pe tranzacție. De aceea e doar TEST: mesajele sunt marcate 🧪 TEST, iar sistemul își ține singur scorul
 * pe fiecare piață, cu prețuri reale. O piață „trece testul” doar după ≥ 50 de tranzacții live cu media ≥ +0,05R și t ≥ 1,5.
 *
 * Risk management (pentru un cont separat de 5.000 $, implicit 1% pe tranzacție):
 *  - cel mult o poziție pe piață și 3 în total; după 2 pierderi în aceeași zi pe o piață, acea piață se oprește până mâine;
 *  - fiecare tranzacție se închide cel târziu la finalul sesiunii pieței (nimic peste noapte).
 * Variabile: TONI_SIGNALS=0 oprește mesajele (scorul continuă), TONI_ACCOUNT, TONI_RISK_PCT.
 */
const A = require('../strategies/amtAgent');
const { lotsFor } = require('../prop/lots');

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
  if (!bus.state.toni || bus.state.toni.v !== 1) bus.state.toni = { v: 1, startedAt: now, trades: [], open: {}, seen: {}, slot: {}, lossDay: {}, passed: {} };
  const book = bus.state.toni;
  const slot = Math.floor((now - 60e3) / M15);
  const send = notify && env.TONI_SIGNALS !== '0';
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
          if (op.sent && send) {
            const sc = stats(book.trades.filter((t) => t.sym === sym));
            const usd = res.r * op.riskUsd;
            const head = res.outcome === 'TP' ? '✅' : (res.outcome === 'SL' ? '⛔' : '⏰');
            const what = res.outcome === 'TP' ? 'a atins TP-ul (s-a închis singur)' : (res.outcome === 'SL' ? 'a atins SL-ul (s-a închis singur)' : 's-a terminat sesiunea — ÎNCHIDE ACUM dacă e încă deschisă');
            await notify(`${head} <b>🧪 TEST TONI · ${mk.name}</b> ${what}\n` +
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
    book.open[sym] = { dir: s.dir, stop: s.stop, tp: s.tp, setup: s.setup, day: s.day, entryT: last.t + M15, ref: last.c, riskUsd: lot.ok ? lot.actualRiskUsd : riskUsd, sent: Boolean(send) };
    report.opened++;
    if (send) {
      await notify([
        `🧪 <b>TEST TONI · ${mk.name} — ${s.dir > 0 ? '🟢 BUY' : '🔴 SELL'} ACUM</b> (la prețul pieței)`,
        `Referință: ~${last.c.toFixed(mk.dp)}`,
        `SL: <b>${fmtDist(mk, dist)}</b> ${s.dir > 0 ? 'sub' : 'peste'} intrare`,
        `TP: <b>${fmtDist(mk, tpDist)}</b> ${s.dir > 0 ? 'peste' : 'sub'} intrare (POC-ul de ieri, ~${(tpDist / dist).toFixed(1)}R)`,
        `Lot: <b>${lot.ok ? lot.lots.toFixed(2) : '— (' + lot.reason.replace(/_/g, ' ').toLowerCase() + ')'}</b> (cont de ${account} $, risc ${riskPct}% = ${riskUsd.toFixed(0)} $)`,
        `M15 · ${s.setup} · se închide cel târziu la finalul sesiunii`,
        'Pune SL și TP ca distanță de la prețul tău de intrare (prețurile diferă puțin între platforme).',
        'Doar TEST (demo sau notat pe hârtie): strategia nu e dovedită. NU pe contul cu sistemul zilnic.'
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
  if (book.trades.length > 5000) book.trades.splice(0, book.trades.length - 5000);
  return report;
}

module.exports = { runToniCycle, stats, MIN_TRADES };
