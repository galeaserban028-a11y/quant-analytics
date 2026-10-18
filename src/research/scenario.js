'use strict';

/**
 * SCENARII pe înțeles, din tranzacțiile reale out-of-sample (nu inventate):
 *  - luna tipică / bună / proastă în examen și pe contul finanțat (profit în $, câte semnale, câte câștigate);
 *  - drumul pe 12 luni: unde ești la fiecare lună (faza 1, faza 2, finanțat, picat) și cât ai încasat cumulat.
 * Toate trec prin Gardian și regulile firmei, exact ca live.
 */
const { runAccount } = require('../prop/challengeSim');

const DAY = 864e5;
const MONTH = 30 * DAY;

function pct(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p / 100 * s.length)))];
}

function sortTrades(trades) {
  return trades.slice().sort((a, b) => a.openedAt - b.openedAt || String(a.symbol).localeCompare(String(b.symbol)) || a.closedAt - b.closedAt);
}

/** Distribuția unei luni (30 de zile) pornind din multe date diferite. */
function monthDistribution(trades, rules, cfg, { target = null, initial = 10000, stepDays = 7 } = {}) {
  const t = sortTrades(trades);
  if (!t.length) return null;
  const first = t[0].openedAt, last = t[t.length - 1].closedAt;
  const pnl = [], taken = [], wins = [];
  for (let s = first; s + MONTH <= last; s += stepDays * DAY) {
    const r = runAccount(t, rules, cfg, { startTs: s, endTs: s + MONTH, target, initial });
    pnl.push(r.balance - initial);
    taken.push(r.tradesTaken);
    // câștigătoare: tranzacțiile luate (aproximare: aceeași rată ca toate tranzacțiile închise în fereastră)
    const inWin = t.filter((x) => x.openedAt >= s && x.openedAt < s + MONTH);
    wins.push(inWin.length ? inWin.filter((x) => x.resultR > 0).length / inWin.length : 0);
  }
  const n = pnl.length;
  return {
    months: n,
    p10: Math.round(pct(pnl, 10)), p25: Math.round(pct(pnl, 25)), median: Math.round(pct(pnl, 50)), p75: Math.round(pct(pnl, 75)), p90: Math.round(pct(pnl, 90)),
    average: Math.round(pnl.reduce((a, b) => a + b, 0) / n),
    positivePct: Number((pnl.filter((v) => v > 0).length / n * 100).toFixed(1)),
    tradesMedian: pct(taken, 50),
    tradesP10: pct(taken, 10), tradesP90: pct(taken, 90),
    winRatePct: Number((wins.reduce((a, b) => a + b, 0) / n * 100).toFixed(1))
  };
}

/**
 * Drumul pe `months` luni: faza 1 → faza 2 → finanțat (retragere lunară a profitului, soldul se poartă).
 * @returns { byMonth: [{ month, phase1Pct, phase2Pct, fundedPct, failedPct, cumPayoutMedian, cumPayoutAvg, netAvg }] }
 */
function journey(trades, rules, cfg, { months = 12, initial = 10000, stepDays = 14, fee = 0 } = {}) {
  const t = sortTrades(trades);
  if (!t.length) return null;
  const first = t[0].openedAt, last = t[t.length - 1].closedAt;
  const runs = [];
  for (let s = first; s + months * MONTH <= last; s += stepDays * DAY) {
    const horizon = s + months * MONTH;
    let ts = s, failedAt = null;
    const passAt = [];
    for (const target of rules.phases) {
      const r = runAccount(t, rules, cfg, { startTs: ts, endTs: horizon, target, initial });
      if (r.outcome === 'PASS') { passAt.push(r.endTs); ts = r.endTs; } else { if (r.outcome === 'FAIL') failedAt = r.endTs; break; }
    }
    const payouts = []; // [{ at, amount }]
    if (passAt.length === rules.phases.length && !failedAt) {
      let bal = initial, fts = ts;
      while (fts + MONTH <= horizon) {
        const r = runAccount(t, rules, cfg, { startTs: fts, endTs: fts + MONTH, target: null, initial, startBalance: bal });
        bal = r.balance;
        if (r.outcome === 'FAIL') { failedAt = r.endTs; break; }
        if (bal > initial) { payouts.push({ at: fts + MONTH, amount: (bal - initial) * rules.split }); bal = initial; }
        fts += MONTH;
      }
    }
    runs.push({ s, passAt, failedAt, payouts });
  }
  const byMonth = [];
  for (let m = 1; m <= months; m++) {
    let p1 = 0, p2 = 0, f = 0, x = 0, lost = 0;
    const cum = [];
    for (const r of runs) {
      const at = r.s + m * MONTH;
      const failed = r.failedAt && r.failedAt <= at;
      const passed = r.passAt.filter((p) => p <= at).length;
      if (failed && passed < rules.phases.length) x++;
      else if (failed) lost++; // a trecut, dar a pierdut ulterior contul finanțat
      else if (passed >= rules.phases.length) f++;
      else if (passed === 0) p1++;
      else p2++;
      cum.push(r.payouts.filter((p) => p.at <= at).reduce((a, b) => a + b.amount, 0));
    }
    const n = runs.length;
    const avg = cum.reduce((a, b) => a + b, 0) / n;
    byMonth.push({
      month: m,
      phase1Pct: Number((p1 / n * 100).toFixed(1)), phase2Pct: Number((p2 / n * 100).toFixed(1)),
      fundedPct: Number((f / n * 100).toFixed(1)), failedPct: Number((x / n * 100).toFixed(1)), lostFundedPct: Number((lost / n * 100).toFixed(1)),
      cumPayoutMedian: Math.round(pct(cum, 50)), cumPayoutP90: Math.round(pct(cum, 90)), cumPayoutAvg: Math.round(avg),
      netAvg: Math.round(avg - fee)
    });
  }
  return { runs: runs.length, byMonth };
}

module.exports = { monthDistribution, journey, pct };
