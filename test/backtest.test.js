'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runBacktest } = require('../src/backtest/engine');
const { generateSyntheticUniverse, generateRandomWalk } = require('../src/backtest/synthetic');
const { computeMetrics } = require('../src/backtest/metrics');
const { loadCsv } = require('../src/backtest/dataLoader');
const { aggregate, H1_MS, M15_MS, computeEMA } = require('../src/core/candles');
const { computeUsdBias } = require('../src/data/macro');
const config = require('../config/agents_config.json');

test('fără look-ahead: modificarea viitorului nu schimbă tranzacțiile din trecut', async () => {
  const data = generateSyntheticUniverse({ seed: 7, days: 60 });
  const base = await runBacktest({ dataBySymbol: data, config });
  assert.ok(base.trades.length > 5, 'avem nevoie de tranzacții ca testul să fie relevant');

  const cutoff = Date.parse(base.period.from) + (Date.parse(base.period.to) - Date.parse(base.period.from)) * 0.6;
  const mutated = {};
  for (const [s, candles] of Object.entries(data)) {
    mutated[s] = candles.map((c) => (c.timestamp >= cutoff
      ? { timestamp: c.timestamp, open: c.open * 1.05, high: c.high * 1.07, low: c.low * 1.03, close: c.close * 1.05, volume: c.volume * 3 }
      : c));
  }
  const alt = await runBacktest({ dataBySymbol: mutated, config });
  const before = (rep) => rep.trades.filter((t) => Date.parse(t.closedAt) < cutoff).map((t) => JSON.stringify(t));
  assert.ok(before(base).length > 0);
  assert.deepEqual(before(alt), before(base));
});

test('test de sănătate: pe random walk (fără edge) backtest-ul NU arată profit semnificativ', async () => {
  const all = [];
  for (let seed = 1; seed <= 4; seed++) {
    const rep = await runBacktest({ dataBySymbol: generateSyntheticUniverse({ seed, days: 90 }), config });
    all.push(...rep.trades);
  }
  const m = computeMetrics(all);
  assert.ok(m.trades >= 50, `prea puține tranzacții: ${m.trades}`);
  // Limita de jos a intervalului de încredere NU poate fi > 0 pe zgomot pur
  assert.ok(m.expectancyCI95[0] <= 0, `edge fals detectat: ${JSON.stringify(m)}`);
});

test('costurile contează: spread dublu dă expectancy mai mic', async () => {
  const data = generateSyntheticUniverse({ seed: 3, days: 90 });
  const a = await runBacktest({ dataBySymbol: data, config, options: { spreadMultiplier: 1 } });
  const b = await runBacktest({ dataBySymbol: data, config, options: { spreadMultiplier: 3 } });
  const tot = (r) => r.trades.reduce((s, t) => s + t.resultR, 0) / Math.max(1, r.trades.length);
  assert.ok(tot(b) < tot(a));
});

test('rezultatele sunt deterministe', async () => {
  const data = generateSyntheticUniverse({ seed: 11, days: 45 });
  const a = await runBacktest({ dataBySymbol: data, config });
  const b = await runBacktest({ dataBySymbol: data, config });
  assert.deepEqual(a.trades, b.trades);
});

test('metrici: calcule corecte pe un exemplu cunoscut', () => {
  const m = computeMetrics([1, -1, 2, -1, -1, 3].map((r) => ({ resultR: r, outcome: r > 0 ? 'TP2' : 'SL' })));
  assert.equal(m.trades, 6);
  assert.equal(m.wins, 3);
  assert.equal(m.expectancyR, 0.5);
  assert.equal(m.totalR, 3);
  assert.equal(m.profitFactor, 2);
  assert.equal(m.maxDrawdownR, 2);
  assert.equal(m.maxLosingStreak, 2);
});

test('agregare H1 din M15 și EMA', () => {
  const m15 = [];
  const t0 = Date.UTC(2026, 0, 5, 10);
  for (let i = 0; i < 8; i++) m15.push({ timestamp: t0 + i * M15_MS, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 });
  const h1 = aggregate(m15, H1_MS);
  assert.equal(h1.length, 2);
  assert.deepEqual(h1[0], { timestamp: t0, open: 0, high: 4, low: -1, close: 3.5, volume: 4 });
  const flat = Array.from({ length: 30 }, (_, i) => ({ close: 10 }));
  assert.equal(computeEMA(flat, 20), 10);
});

test('indice USD sintetic: EUR/GBP/AUD scad și USDJPY urcă ⇒ USD puternic', () => {
  const mk = (from, to) => Array.from({ length: 25 }, (_, i) => ({ close: from + (to - from) * (i / 24) }));
  const res = computeUsdBias({ EURUSD: mk(1.1, 1.09), GBPUSD: mk(1.3, 1.28), AUDUSD: mk(0.66, 0.65), USDJPY: mk(150, 152) }, config.instruments, { lookback: 20, thresholdPct: 0.1 });
  assert.equal(res.usdBias, 'BULLISH_USD');
  assert.equal(computeUsdBias({ EURUSD: mk(1, 1.1) }, config.instruments).usdBias, null);
});

test('încărcare CSV (ISO și milisecunde, cu antet)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-csv-'));
  const f = path.join(dir, 'EURUSD.csv');
  fs.writeFileSync(f, 'time,open,high,low,close,volume\n2026-01-05 10:00:00,1.1,1.2,1.0,1.15,10\n1767608100000,1.15,1.16,1.14,1.155,5\n');
  const c = loadCsv(f);
  assert.equal(c.length, 2);
  assert.equal(c[0].timestamp, Date.UTC(2026, 0, 5, 10));
  assert.equal(c[1].close, 1.155);
});

test('random walk sintetic este determinist și valid', () => {
  const a = generateRandomWalk({ seed: 5, days: 3 });
  const b = generateRandomWalk({ seed: 5, days: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.every((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)));
});
