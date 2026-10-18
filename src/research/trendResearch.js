'use strict';

/**
 * Walk-forward pentru Departamentul Trend (H4).
 * Antrenare pe `trainYears`, test pe anul următor, apoi fereastra avansează un an.
 * Comparăm două lucruri, ambele out-of-sample:
 *   A) parametrii FIXI din literatură (zero optimizare → zero selection bias)
 *   B) parametrii aleși pe antrenare dintr-o grilă (riscul de supra-optimizare e măsurat, nu ignorat)
 */
const { simulate, DEFAULT_PARAMS } = require('../strategies/trendDesk');
const { computeMetrics } = require('../backtest/metrics');

const YEAR = 365.25 * 24 * 3600e3;

const DEFAULT_TREND_GRID = (() => {
  const g = [];
  for (const lookbacks of [[10, 20, 40], [20, 40, 80], [40, 80, 160]]) {
    for (const atrMult of [2, 3, 4, 5]) {
      for (const entry of [0.6, 1.0]) {
        for (const allowShort of [true, false]) g.push({ lookbacks, atrMult, entry, allowShort });
      }
    }
  }
  return g;
})();

function sliceBars(dataBySymbol, from, to) {
  const out = {};
  for (const [s, bars] of Object.entries(dataBySymbol)) {
    const part = bars.filter((b) => b.timestamp >= from && b.timestamp < to);
    if (part.length > 200) out[s] = part;
  }
  return out;
}

/**
 * @param {Object<string,Array>} h4BySymbol lumânări H4 normalizate
 * @param {object} instruments config.instruments
 * @param {object} [opts] { trainYears, grid, minTrades, warmupBars, log }
 */
function trendWalkForward(h4BySymbol, instruments, opts = {}) {
  const trainYears = opts.trainYears || 2;
  const grid = opts.grid || DEFAULT_TREND_GRID;
  const minTrades = opts.minTrades || 30;
  const log = opts.log || (() => {});
  const warmMs = 200 * 4 * 3600e3; // destul pentru lookback 160 + ATR

  let start = Infinity, end = -Infinity;
  for (const b of Object.values(h4BySymbol)) { start = Math.min(start, b[0].timestamp); end = Math.max(end, b[b.length - 1].timestamp); }

  const folds = [];
  const oosFixed = [];
  const oosSelected = [];
  let latest = null;

  for (let testStart = start + trainYears * YEAR; testStart < end - 30 * 24 * 3600e3; testStart += YEAR) {
    const testEnd = Math.min(end + 1, testStart + YEAR);
    const train = sliceBars(h4BySymbol, testStart - trainYears * YEAR, testStart);
    let best = null;
    for (const params of grid) {
      const m = computeMetrics(simulate(train, instruments, params, { barsAreH4: true }));
      const obj = m.trades >= minTrades ? m.expectancyR * Math.sqrt(m.trades) : -Infinity;
      if (!best || obj > best.obj) best = { obj, params, metrics: m };
    }
    const test = sliceBars(h4BySymbol, testStart - warmMs, testEnd);
    const optsTest = { barsAreH4: true, tradeFromTs: testStart, tradeUntilTs: testEnd };
    const fixedTrades = simulate(test, instruments, DEFAULT_PARAMS, optsTest);
    const tradeSelected = best && best.obj > 0;
    const selTrades = tradeSelected ? simulate(test, instruments, best.params, optsTest) : [];
    oosFixed.push(...fixedTrades);
    oosSelected.push(...selTrades);
    const fold = {
      testFrom: new Date(testStart).toISOString().slice(0, 10),
      testTo: new Date(testEnd).toISOString().slice(0, 10),
      chosen: best ? best.params : null,
      trainMetrics: best ? best.metrics : null,
      decision: tradeSelected ? 'TRANZACȚIONEAZĂ' : 'STĂ PE LOC',
      oosFixed: computeMetrics(fixedTrades),
      oosSelected: computeMetrics(selTrades)
    };
    log(`Trend ${fold.testFrom} → ${fold.testTo}: fix E=${fold.oosFixed.expectancyR}R (${fold.oosFixed.trades}) | ales ${JSON.stringify(best.params)} E=${fold.oosSelected.expectancyR}R (${fold.oosSelected.trades})`);
    folds.push(fold);
    latest = best;
  }
  return {
    folds,
    oosFixed: computeMetrics(oosFixed),
    oosSelected: computeMetrics(oosSelected),
    oosFixedTrades: oosFixed,
    oosSelectedTrades: oosSelected,
    latest: latest ? { params: latest.params, trainMetrics: latest.metrics } : null
  };
}

module.exports = { trendWalkForward, DEFAULT_TREND_GRID };
