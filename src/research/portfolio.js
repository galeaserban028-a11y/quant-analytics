'use strict';

/**
 * Transformă tranzacțiile (în R) în evoluția contului, cu risc fix pe tranzacție (fixed fractional).
 * Exemplu: risc 0.5% ⇒ o tranzacție de +2R adaugă ~1% la cont; una de −1R scade 0.5%.
 *
 * Simplificare declarată: rezultatul se aplică la închidere, iar riscul se calculează din capitalul
 * de la acel moment (pozițiile simultane nu sunt modelate separat).
 */
function equityCurve(trades, { riskPct = 0.5, startEquity = 10000 } = {}) {
  const sorted = trades.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = startEquity;
  let peak = eq;
  let maxDDPct = 0;
  const monthly = {};
  for (const t of sorted) {
    const pnl = eq * (riskPct / 100) * t.resultR;
    eq += pnl;
    peak = Math.max(peak, eq);
    maxDDPct = Math.max(maxDDPct, (peak - eq) / peak * 100);
    const m = new Date(t.closedAt).toISOString().slice(0, 7);
    if (!monthly[m]) monthly[m] = { start: eq - pnl, pnl: 0, trades: 0 };
    monthly[m].pnl += pnl;
    monthly[m].trades += 1;
  }
  const months = Object.entries(monthly).map(([month, v]) => ({ month, returnPct: Number((v.pnl / v.start * 100).toFixed(2)), trades: v.trades }));
  const rets = months.map((m) => m.returnPct);
  const first = sorted.length ? sorted[0].closedAt : null;
  const last = sorted.length ? sorted[sorted.length - 1].closedAt : null;
  const years = first ? Math.max((last - first) / (365.25 * 24 * 3600e3), 1 / 12) : 0;
  const totalPct = (eq / startEquity - 1) * 100;
  return {
    riskPct,
    startEquity,
    endEquity: Number(eq.toFixed(2)),
    totalReturnPct: Number(totalPct.toFixed(2)),
    cagrPct: years ? Number(((Math.pow(eq / startEquity, 1 / years) - 1) * 100).toFixed(2)) : null,
    maxDrawdownPct: Number(maxDDPct.toFixed(2)),
    months: months.length,
    avgMonthlyPct: rets.length ? Number((rets.reduce((s, v) => s + v, 0) / rets.length).toFixed(2)) : null,
    medianMonthlyPct: rets.length ? Number(rets.slice().sort((a, b) => a - b)[Math.floor(rets.length / 2)].toFixed(2)) : null,
    positiveMonthsPct: rets.length ? Number((rets.filter((r) => r > 0).length / rets.length * 100).toFixed(1)) : null,
    worstMonthPct: rets.length ? Math.min(...rets) : null,
    bestMonthPct: rets.length ? Math.max(...rets) : null,
    monthly: months
  };
}

/**
 * Simulare de portofoliu realistă, pe evenimente (deschideri/închideri în ordine cronologică):
 *  - riscul fiecărei poziții = riskPct × capitalul de la DESCHIDERE;
 *  - maxim `maxOpen` poziții simultan (crypto e foarte corelat: 10 poziții long = practic un singur pariu mare);
 *  - poziția nouă e refuzată dacă riscul total deschis ar depăși `maxOpenRiskPct`;
 *  - capitalul se actualizează la închidere (realizat).
 */
function portfolioSim(trades, { riskPct = 0.5, maxOpen = 5, maxOpenRiskPct = 3, startEquity = 10000 } = {}) {
  const events = [];
  trades.forEach((t, idx) => {
    events.push({ at: t.openedAt, type: 'open', idx });
    events.push({ at: t.closedAt, type: 'close', idx });
  });
  // la același moment: întâi închiderile (eliberează risc), apoi deschiderile
  events.sort((a, b) => a.at - b.at || (a.type === 'close' ? -1 : 1));
  let eq = startEquity, peak = eq, maxDD = 0;
  const open = new Map(); // idx → sumă riscată
  const taken = [];
  let skipped = 0;
  const monthly = {};
  for (const e of events) {
    const t = trades[e.idx];
    if (e.type === 'open') {
      const openRisk = Array.from(open.values()).reduce((s, v) => s + v, 0);
      const amt = eq * riskPct / 100;
      if (open.size >= maxOpen || (openRisk + amt) / eq * 100 > maxOpenRiskPct + 1e-9) { skipped += 1; continue; }
      open.set(e.idx, amt);
    } else if (open.has(e.idx)) {
      const amt = open.get(e.idx);
      open.delete(e.idx);
      const pnl = amt * t.resultR;
      const m = new Date(t.closedAt).toISOString().slice(0, 7);
      if (!monthly[m]) monthly[m] = { start: eq, pnl: 0, trades: 0 };
      eq += pnl;
      monthly[m].pnl += pnl;
      monthly[m].trades += 1;
      peak = Math.max(peak, eq);
      maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
      taken.push(t);
    }
  }
  const months = fillMonths(monthly);
  return Object.assign(summarize(months, startEquity, eq, maxDD, taken), { riskPct, maxOpen, maxOpenRiskPct, tradesTaken: taken.length, tradesSkipped: skipped });
}

/** Include și lunile fără tranzacții închise (0%), ca statisticile lunare să fie corecte. */
function fillMonths(monthly) {
  const keys = Object.keys(monthly).sort();
  if (!keys.length) return [];
  const out = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    const v = monthly[k];
    out.push({ month: k, returnPct: v ? Number((v.pnl / v.start * 100).toFixed(2)) : 0, trades: v ? v.trades : 0 });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function summarize(months, startEquity, endEquity, maxDD, taken) {
  const rets = months.map((x) => x.returnPct);
  const years = months.length / 12;
  const sorted = rets.slice().sort((a, b) => a - b);
  const mean = rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const byYear = {};
  for (const x of months) {
    const yr = x.month.slice(0, 4);
    byYear[yr] = (byYear[yr] || 1) * (1 + x.returnPct / 100);
  }
  return {
    startEquity,
    endEquity: Number(endEquity.toFixed(2)),
    totalReturnPct: Number(((endEquity / startEquity - 1) * 100).toFixed(2)),
    cagrPct: years > 0 ? Number(((Math.pow(endEquity / startEquity, 1 / years) - 1) * 100).toFixed(2)) : null,
    maxDrawdownPct: Number(maxDD.toFixed(2)),
    sharpeMonthly: sd > 0 ? Number((mean / sd * Math.sqrt(12)).toFixed(2)) : null,
    months: months.length,
    avgMonthlyPct: Number(mean.toFixed(2)),
    medianMonthlyPct: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    positiveMonthsPct: rets.length ? Number((rets.filter((r) => r > 0).length / rets.length * 100).toFixed(1)) : null,
    worstMonthPct: sorted.length ? sorted[0] : null,
    bestMonthPct: sorted.length ? sorted[sorted.length - 1] : null,
    yearly: Object.fromEntries(Object.entries(byYear).map(([y, f]) => [y, Number(((f - 1) * 100).toFixed(1))])),
    monthly: months
  };
}

/**
 * Monte Carlo prin reeșantionarea lunilor (cu înlocuire): distribuția randamentului și a scăderii maxime
 * pe un orizont dat. Răspunde la „cât de rău poate fi?”, nu doar „cât a fost?”.
 */
function monteCarloMonths(monthlyReturnsPct, { horizonMonths = 12, iterations = 5000, seed = 99 } = {}) {
  const { rng } = require('../backtest/metrics');
  const r = rng(seed);
  if (!monthlyReturnsPct.length) return null;
  const finals = [];
  const dds = [];
  for (let it = 0; it < iterations; it++) {
    let eq = 1, peak = 1, dd = 0;
    for (let m = 0; m < horizonMonths; m++) {
      eq *= 1 + monthlyReturnsPct[Math.floor(r() * monthlyReturnsPct.length)] / 100;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, (peak - eq) / peak);
    }
    finals.push((eq - 1) * 100);
    dds.push(dd * 100);
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const q = (arr, p) => Number(arr[Math.floor(p * (arr.length - 1))].toFixed(1));
  return {
    horizonMonths,
    returnPct: { p5: q(finals, 0.05), p25: q(finals, 0.25), median: q(finals, 0.5), p75: q(finals, 0.75), p95: q(finals, 0.95) },
    maxDrawdownPct: { median: q(dds, 0.5), p95: q(dds, 0.95), p99: q(dds, 0.99) },
    probLossPct: Number((finals.filter((v) => v < 0).length / finals.length * 100).toFixed(1))
  };
}

module.exports = { equityCurve, portfolioSim, monteCarloMonths, fillMonths };
