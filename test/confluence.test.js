'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { goldSetup, makeOrch, buildInstitutionalGoldDataset, REFERENCE_TIME } = require('./helpers');

test('setup-ul de referință XAUUSD primește 100/100 LONG și deschide poziție', async () => {
  const { orch } = goldSetup();
  const { evaluated, signals } = await orch.runCycle(['XAUUSD']);
  const c = evaluated.XAUUSD;
  assert.equal(c.direction, 'LONG');
  assert.equal(c.finalScore, 100);
  assert.equal(c.approved, true);
  assert.deepEqual(c.vetoReasons, []);
  assert.equal(signals.length, 1);
  assert.ok(orch.stateBus.getActiveTrade('XAUUSD'));
});

test('fără date macro, 1D NU mai dă 15 puncte gratis', async () => {
  const { orch } = goldSetup({ usdBias: null });
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(c.breakdown.macroCompass, 0);
  assert.equal(c.finalScore, 85);
});

test('macro care susține direcția OPUSĂ celei MTF nu primește puncte', async () => {
  const { orch } = goldSetup({ usdBias: 'BULLISH_USD' }); // susține SHORT pe XAUUSD, MTF zice LONG
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(c.direction, 'LONG');
  assert.equal(c.breakdown.macroCompass, 0);
});

test('anti-inducement: fără liquidity sweep, OB/FVG/EQ primesc 0 și semnalul pică', async () => {
  const data = buildInstitutionalGoldDataset();
  // Ștergem fitilul de sweep: lumânarea nu mai coboară sub pool-ul de lichiditate
  const sweepIdx = data.m15Candles.findIndex((c) => c.low === 2646.2);
  data.m15Candles[sweepIdx].low = 2648.4;
  const { orch } = makeOrch();
  orch.ingest('XAUUSD', data);
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(c.breakdown.liquiditySweep, 0);
  assert.equal(c.breakdown.obFvgEquilibrium, 0);
  assert.equal(c.breakdown.antiInducementTriggered, true);
  assert.equal(c.approved, false);
});

test('orice veto aduce scorul la 0', async () => {
  const { orch } = goldSetup({ spotAsk: 2651.0 }); // spread 10 pips > max 4
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(c.finalScore, 0);
  assert.equal(c.vetoed, true);
  assert.ok(c.vetoReasons.some((r) => r.startsWith('1A_SPREAD_TOO_HIGH')));
});

test('știre cu impact mare în ±30 minute blochează', async () => {
  const { orch } = goldSetup({ newsEvents: [{ title: 'CPI', currency: 'USD', impact: 'HIGH', timestamp: REFERENCE_TIME + 10 * 60e3 }] });
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('1C_NEWS_BLOCK')));
});

test('feed de știri căzut pe FX/aur → veto (fail-closed)', async () => {
  const { orch } = goldSetup({ newsFeedAvailable: false });
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.includes('1C_NEWS_FEED_UNAVAILABLE'));
});

test('în afara sesiunii și în weekend → veto', async () => {
  const { orch, clock } = goldSetup();
  clock.now = Date.UTC(2026, 9, 14, 3, 0); // 03:00 UTC
  orch.ingest('XAUUSD', { spotTimestamp: clock.now, m15Candles: buildInstitutionalGoldDataset(clock.now).m15Candles });
  let c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('1B_OUTSIDE_KILLZONE')));

  clock.now = Date.UTC(2026, 9, 17, 14, 30); // sâmbătă
  orch.ingest('XAUUSD', { spotTimestamp: clock.now, m15Candles: buildInstitutionalGoldDataset(clock.now).m15Candles });
  c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.includes('1B_FX_WEEKEND_CLOSED'));
});

test('date vechi (spot sau lumânări) → veto', async () => {
  const { orch, clock } = goldSetup();
  clock.now = REFERENCE_TIME + 60 * 60e3; // o oră fără date noi
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('1A_SPOT_STALE') || r.startsWith('1A_CANDLES_STALE')));
});

test('conflict MTF → veto', async () => {
  const data = buildInstitutionalGoldDataset();
  // H1 în trend descendent
  const n = data.h1Candles.length;
  data.h1Candles = data.h1Candles.map((c, i) => {
    const o = 2700 - i * 0.8;
    return { timestamp: c.timestamp, open: o, high: o + 0.6, low: o - 1.0, close: o - 0.5, volume: c.volume };
  });
  assert.equal(data.h1Candles.length, n);
  const { orch } = makeOrch();
  orch.ingest('XAUUSD', data);
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('MTF_CONFLICT')));
});

test('o ramură care aruncă excepție pune VETO (fail-closed), nu aprobă', async () => {
  const cfg = JSON.parse(JSON.stringify(require('../config/agents_config.json')));
  const { orch } = makeOrch(REFERENCE_TIME, cfg);
  orch.ingest('XAUUSD', buildInstitutionalGoldDataset());
  const agent = orch.agents.find((a) => a.branchId === '1C');
  agent.handler = () => { throw new Error('boom'); };
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(c.approved, false);
  assert.ok(c.vetoReasons.some((r) => r.includes('1C_ERROR')));
  assert.equal(orch.stateBus.state.diagnostics.errorCount, 1);
});

test('date corupte pe toate simbolurile nu opresc sistemul și nu generează semnale', async () => {
  const { orch } = makeOrch();
  const garbage = [null, undefined, 'x', { open: 'a' }, [1, 2], { close: NaN }];
  for (const s of orch.symbols()) {
    orch.ingest(s, { spotMid: NaN, spotBid: 'abc', m15Candles: garbage, h1Candles: garbage });
  }
  const { signals } = await orch.runCycle();
  assert.equal(signals.length, 0);
});

test('1D direct: fără indice USD, agentul macro nu aprobă și nu dă puncte', () => {
  const { branch1D_MacroUsdCompass } = require('../src/divisions/div1_shield_macro');
  const inst = require('../config/agents_config.json').instruments.EURUSD;
  const r = branch1D_MacroUsdCompass({ marketData: { usdBias: null }, inst });
  assert.equal(r.approved, false);
  assert.equal(r.score, 0);
  assert.equal(r.direction, 'NEUTRAL');
  const r2 = branch1D_MacroUsdCompass({ marketData: { usdBias: 'BEARISH_USD' }, inst });
  assert.equal(r2.direction, 'LONG');
  const cross = require('../config/agents_config.json').instruments.GBPJPY;
  assert.equal(branch1D_MacroUsdCompass({ marketData: { usdBias: 'BEARISH_USD' }, inst: cross }).approved, false);
});
