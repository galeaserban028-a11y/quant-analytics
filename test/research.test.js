'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scoreFeatures, extractFeatures, PROTECTED_FILTERS } = require('../src/core/scoring');
const { reviewAgents, proposePromotions, diffCI } = require('../src/research/review');
const { selectShadows, validationLevel, walkForward } = require('../src/research/walkforward');
const { portfolioSim, monteCarloMonths, fillMonths } = require('../src/research/portfolio');
const { loadConfig, applyOverrides, writePromotionSection } = require('../src/config');
const { generateSyntheticUniverse } = require('../src/backtest/synthetic');
const { runBacktest } = require('../src/backtest/engine');
const config = require('../config/agents_config.json');

const feat = (over = {}) => Object.assign({
  direction: 'LONG',
  points: { mtf: true, sweep: true, orderBlock: true, fvg: true, premiumDiscount: true, displacement: true, macro: true },
  redTeam: false, vetoes: [], vetoReasons: {}
}, over);

test('scoring: formula unică — 100 cu toate punctele, anti-inducement fără sweep, veto ⇒ 0', () => {
  assert.equal(scoreFeatures(feat(), config).finalScore, 100);
  const noSweep = scoreFeatures(feat({ points: { mtf: true, sweep: false, orderBlock: true, fvg: true, premiumDiscount: true, displacement: true, macro: true } }), config);
  assert.equal(noSweep.breakdown.obFvgEquilibrium, 0);
  assert.equal(noSweep.finalScore, 55);
  const v = scoreFeatures(feat({ vetoes: ['1B'] }), config);
  assert.equal(v.finalScore, 0);
  assert.equal(v.approved, false);
});

test('scoring: filtrele consultative nu blochează, dar cele protejate blochează mereu', () => {
  const cfg = applyOverrides(config, { advisoryFilters: ['1B', '4C'] });
  const r1 = scoreFeatures(feat({ vetoes: ['1B'] }), cfg);
  assert.equal(r1.vetoed, false);
  assert.deepEqual(r1.advisoryVetoes, ['1B']);
  assert.ok(PROTECTED_FILTERS.has('4C'));
  assert.equal(scoreFeatures(feat({ vetoes: ['4C'] }), cfg).vetoed, true);
});

test('scoring: ponderile din config schimbă scorul (promovare/retrogradare)', () => {
  const cfg = applyOverrides(config, { scoringWeights: { displacement: 30, orderBlock: 0 } });
  const s = scoreFeatures(feat(), cfg);
  assert.equal(s.breakdown.displacement, 30);
  assert.equal(s.breakdown.orderBlock, 0);
});

test('scoring: extractFeatures e fail-closed pentru filtre lipsă sau cu eroare', () => {
  const reports = { MTF: { direction: 'LONG', approved: true, veto: false, status: 'OK' } };
  const f = extractFeatures((id) => reports[id] || { status: 'MISSING', approved: false, veto: false, direction: 'NEUTRAL', score: 0 });
  assert.ok(f.vetoes.includes('1A') && f.vetoes.includes('7A') && f.vetoes.includes('4E'));
});

function fakeShadow(r, over = {}) {
  return { symbol: over.symbol || 'BTCUSD', resultR: r, openedAt: 0, meta: { features: feat(over.features || {}), costToRisk: over.cost != null ? over.cost : 0.1 } };
}

test('evaluare agenți: un agent care chiar ajută e PROMOVAT, unul care strică e RETROGRADAT', () => {
  const shadows = [];
  for (let i = 0; i < 80; i++) {
    shadows.push(fakeShadow(1 + (i % 3) * 0.1, { features: { points: { mtf: true, sweep: true, orderBlock: false, fvg: false, premiumDiscount: false, displacement: true, macro: false } } }));
    shadows.push(fakeShadow(-1 - (i % 3) * 0.1, { features: { points: { mtf: true, sweep: true, orderBlock: true, fvg: false, premiumDiscount: false, displacement: false, macro: false } } }));
  }
  const rv = reviewAgents(shadows, config);
  const g = (id) => rv.agents.find((a) => a.id === id).grade;
  assert.equal(g('3D'), 'PROMOVAT');
  assert.equal(g('3B'), 'RETROGRADAT');
  assert.equal(g('3C'), 'DATE_PUTINE');
  const prop = proposePromotions(rv, config);
  assert.ok(prop.scoringWeights.displacement > config.scoringWeights.displacement);
  assert.equal(prop.scoringWeights.orderBlock, 0);
  assert.ok(prop.moves.length >= 2);
});

test('evaluare agenți: filtrul care blochează tranzacții profitabile e mutat la Consultativ; cel protejat nu', () => {
  const shadows = [];
  for (let i = 0; i < 60; i++) {
    shadows.push(fakeShadow(1.5, { features: { vetoes: ['1B'] } }));
    shadows.push(fakeShadow(-0.5, {}));
    shadows.push(fakeShadow(1.5, { features: { vetoes: ['4C'] } }));
  }
  const rv = reviewAgents(shadows, config);
  const prop = proposePromotions(rv, config);
  assert.ok(prop.advisoryFilters.includes('1B'));
  assert.ok(!prop.advisoryFilters.includes('4C'));
});

test('evaluare: birourile pe instrumente cu expectancy negativ semnificativ sunt suspendate', () => {
  const shadows = [];
  for (let i = 0; i < 50; i++) { shadows.push(fakeShadow(-1 - (i % 2) * 0.2, { symbol: 'XRPUSD' })); shadows.push(fakeShadow(0.5 + (i % 2), { symbol: 'BTCUSD' })); }
  const prop = proposePromotions(reviewAgents(shadows, config), config);
  assert.ok(prop.disabledSymbols.includes('XRPUSD'));
  assert.ok(!prop.disabledSymbols.includes('BTCUSD'));
});

test('diffCI: diferență clară ⇒ interval complet peste 0', () => {
  const a = Array.from({ length: 50 }, (_, i) => 1 + (i % 5) * 0.01);
  const b = Array.from({ length: 50 }, (_, i) => -1 - (i % 5) * 0.01);
  const [lo, hi] = diffCI(a, b);
  assert.ok(lo > 1.5 && hi < 2.5);
});

test('selectShadows: pragul de cost re-evaluat și birourile suspendate respectate', () => {
  const s = [fakeShadow(1, { cost: 0.1 }), fakeShadow(1, { cost: 0.4 }), fakeShadow(1, { symbol: 'XRPUSD', cost: 0.1 })];
  const cfg = applyOverrides(config, { disabledSymbols: ['XRPUSD'], executionPolicy: { confluenceThreshold: 85 } });
  assert.equal(selectShadows(s, cfg, 0.25).length, 1);
  assert.equal(selectShadows(s, applyOverrides(config, {}), 0.5).length, 3);
});

test('nivel de validare: LIVE / DEMO / NIMIC', () => {
  assert.equal(validationLevel({ trades: 150, expectancyR: 0.2, expectancyCI95: [0.05, 0.3] }, { expectancyR: 0 }), 'LIVE');
  assert.equal(validationLevel({ trades: 40, expectancyR: 0.1, expectancyCI95: [-0.1, 0.3] }, { expectancyR: 0 }), 'DEMO');
  assert.equal(validationLevel({ trades: 200, expectancyR: -0.1, expectancyCI95: [-0.2, 0] }, { expectancyR: 0 }), 'NIMIC');
});

test('walk-forward: rulează cap-coadă pe date sintetice și pe zgomot nu validează nimic', async () => {
  const data = generateSyntheticUniverse({ seed: 21, days: 100 });
  const res = await walkForward({
    dataBySymbol: data,
    config,
    options: { trainDays: 50, testDays: 25, grid: { geometry: [{ minRiskAtr: 0, tp2RiskReward: 3 }], thresholds: [25, 85], maxCost: [0.25] } }
  });
  assert.ok(res.folds.length >= 1);
  assert.notEqual(validationLevel(res.oos, res.baselineOos), 'LIVE');
});

test('backtest umbră: produce tranzacții-umbră cu votul fiecărui agent', async () => {
  const rep = await runBacktest({ dataBySymbol: generateSyntheticUniverse({ seed: 4, days: 45 }), config, options: { shadow: true } });
  assert.ok(rep.shadowTrades.length > 10);
  const s = rep.shadowTrades[0];
  assert.ok(s.meta.features && Array.isArray(s.meta.features.vetoes));
  assert.ok(Number.isFinite(s.resultR));
});

test('portofoliu: limita de poziții simultane și calculele de capital', () => {
  const T = (o, c, r) => ({ openedAt: o, closedAt: c, resultR: r });
  const day = 864e5;
  const t0 = Date.UTC(2025, 0, 1);
  const trades = [T(t0, t0 + 5 * day, 2), T(t0 + day, t0 + 6 * day, -1), T(t0 + 2 * day, t0 + 3 * day, 1)];
  const p = portfolioSim(trades, { riskPct: 1, maxOpen: 2, maxOpenRiskPct: 10 });
  assert.equal(p.tradesTaken, 2);
  assert.equal(p.tradesSkipped, 1);
  // +2% apoi −1% din capitalul de la deschidere (10000): 10000 + 200 − 100 = 10100
  assert.equal(p.endEquity, 10100);
});

test('portofoliu: lunile fără tranzacții apar cu 0%', () => {
  const m = fillMonths({ '2025-01': { start: 100, pnl: 10, trades: 1 }, '2025-04': { start: 110, pnl: -11, trades: 1 } });
  assert.deepEqual(m.map((x) => x.month), ['2025-01', '2025-02', '2025-03', '2025-04']);
  assert.equal(m[1].returnPct, 0);
});

test('Monte Carlo: determinist și cu percentile ordonate', () => {
  const a = monteCarloMonths([5, -3, 2, 0, 8, -6], { horizonMonths: 12, iterations: 1000 });
  const b = monteCarloMonths([5, -3, 2, 0, 8, -6], { horizonMonths: 12, iterations: 1000 });
  assert.deepEqual(a, b);
  assert.ok(a.returnPct.p5 <= a.returnPct.median && a.returnPct.median <= a.returnPct.p95);
});

test('config: promovările se aplică DOAR pentru secțiunile validate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-cfg-'));
  const prom = path.join(dir, 'promotions.json');
  const basePath = path.join(dir, 'base.json');
  fs.writeFileSync(basePath, JSON.stringify(Object.assign({}, config, { userDisabledDesks: [] })));
  writePromotionSection('trend', { validatedOOS: true, overrides: { trendDesk: { enabled: true } } }, prom);
  writePromotionSection('smc', { validatedOOS: false, overrides: { smcDesk: { enabled: true } } }, prom);
  const cfg = loadConfig({ basePath, promotionsPath: prom });
  assert.equal(cfg.trendDesk.enabled, true);
  assert.equal(cfg.smcDesk.enabled, false);
  assert.equal(loadConfig({ basePath, promotionsPath: prom, ignorePromotions: true }).trendDesk.enabled, false);
  fs.writeFileSync(prom, '{ stricat');
  assert.equal(loadConfig({ basePath, promotionsPath: prom }).trendDesk.enabled, false, 'fișier corupt ⇒ setările de bază');
});

test('portofoliu: o tranzacție de durată 0 (deschisă și închisă în aceeași clipă) nu blochează locurile (bug găsit)', () => {
  const t0 = Date.UTC(2025, 0, 1), day = 864e5;
  const trades = [{ openedAt: t0, closedAt: t0, resultR: 0 }, { openedAt: t0 + day, closedAt: t0 + 2 * day, resultR: 1 }];
  const p = portfolioSim(trades, { riskPct: 1, maxOpen: 1, maxOpenRiskPct: 10 });
  assert.equal(p.tradesTaken, 1);
  assert.equal(p.endEquity, 10100);
});
