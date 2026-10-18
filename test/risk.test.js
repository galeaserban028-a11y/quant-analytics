'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { goldSetup, makeOrch, REFERENCE_TIME, buildInstitutionalGoldDataset } = require('./helpers');
const MarketStateBus = require('../src/core/MarketStateBus');
const config = require('../config/agents_config.json');

test('4A: LONG intră la ASK, SL sub fitilul sweep-ului, TP-uri la multipli R corecți', async () => {
  const { orch } = goldSetup();
  await orch.evaluateSymbol('XAUUSD');
  const g = orch.stateBus.getBranchReport('XAUUSD', '4A').data;
  assert.equal(g.entry, 2650.2);
  assert.ok(g.stopLoss < 2646.2);
  const risk = g.entry - g.stopLoss;
  assert.ok(Math.abs(g.tp1 - (g.entry + 1.5 * risk)) < 0.011);
  assert.ok(Math.abs(g.tp2 - (g.entry + 3 * risk)) < 0.011);
  assert.ok(g.protectedBreakEven > g.entry);
  assert.ok(g.costR > 0);
});

test('4E: spread prea mare față de SL → veto (4A doar calculează)', async () => {
  const data = buildInstitutionalGoldDataset();
  const { orch } = makeOrch();
  const cfg = orch.config.instruments.XAUUSD;
  const oldMax = cfg.maxSpreadPips;
  cfg.maxSpreadPips = 100; // lăsăm 1A să treacă, ca să testăm 4A
  orch.ingest('XAUUSD', Object.assign(data, { spotBid: 2650.0, spotAsk: 2651.0, spotMid: 2650.5 }));
  await orch.evaluateSymbol('XAUUSD');
  cfg.maxSpreadPips = oldMax;
  assert.equal(orch.stateBus.getBranchReport('XAUUSD', '4A').approved, true);
  const r = orch.stateBus.getBranchReport('XAUUSD', '4E');
  assert.equal(r.veto, true);
  assert.match(r.vetoReason, /SPREAD_TO_SL_TOO_HIGH/);
});

test('4B: preț plecat > 15% spre TP1 → veto anti-chase', async () => {
  const { orch } = goldSetup({ spotBid: 2651.8, spotAsk: 2652.0, spotMid: 2651.9 });
  await orch.evaluateSymbol('XAUUSD');
  const r = orch.stateBus.getBranchReport('XAUUSD', '4B');
  assert.equal(r.veto, true);
  assert.match(r.vetoReason, /4B_ANTI_CHASE/);
});

test('4C: cu XAUUSD deschis, EURUSD (tot USD) e blocat', async () => {
  const { orch } = goldSetup();
  await orch.runCycle(['XAUUSD']);
  const check = orch.stateBus.checkCurrencyCorrelationConflict('EURUSD');
  assert.equal(check.conflict, true);
  assert.match(check.reason, /USD/);
  assert.equal(orch.stateBus.checkCurrencyCorrelationConflict('XAUUSD').conflict, true);
});

test('4D + 7A: după 2 SL într-o zi, simbolul e blocat 48h — și blocajul rezistă după miezul nopții', async () => {
  const { orch, clock } = goldSetup();
  const bus = orch.stateBus;
  bus.recordStopLoss('XAUUSD');
  bus.recordStopLoss('XAUUSD');
  let c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('7A_LOCKOUT')));
  assert.ok(c.vetoReasons.some((r) => r.startsWith('4D')));

  clock.now = REFERENCE_TIME + 24 * 3600e3; // a doua zi: contorul zilnic s-a resetat
  orch.ingest('XAUUSD', Object.assign(buildInstitutionalGoldDataset(clock.now)));
  c = await orch.evaluateSymbol('XAUUSD');
  assert.equal(bus.getDailySlCount('XAUUSD'), 0);
  assert.ok(c.vetoReasons.some((r) => r.startsWith('7A_LOCKOUT')), 'lockout-ul de 48h trebuie să fie încă activ');

  clock.now = REFERENCE_TIME + 49 * 3600e3;
  orch.ingest('XAUUSD', Object.assign(buildInstitutionalGoldDataset(clock.now)));
  c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(!c.vetoReasons.some((r) => r.startsWith('7A_LOCKOUT')));
});

test('7B: media proastă pe ultimele tranzacții oprește simbolul', async () => {
  const { orch } = goldSetup();
  for (let i = 0; i < 6; i++) orch.stateBus.state.closedTrades.push({ symbol: 'XAUUSD', resultR: -1, outcome: 'BE' });
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('7B_PERFORMANCE_BREAKER')));
});

test('7C: piață haotică (choppy) pe H1 → veto', async () => {
  const data = buildInstitutionalGoldDataset();
  data.h1Candles = data.h1Candles.map((c, i) => {
    const o = 2650 + (i % 2 ? 3 : -3);
    return { timestamp: c.timestamp, open: o, high: o + 3.5, low: o - 3.5, close: 2650 + (i % 2 ? -3 : 3), volume: 1000 };
  });
  const { orch } = makeOrch();
  orch.ingest('XAUUSD', data);
  const c = await orch.evaluateSymbol('XAUUSD');
  assert.ok(c.vetoReasons.some((r) => r.startsWith('7C_CHOPPY')));
});

test('snapshot: tranzacțiile vechi (> maxTradeAgeHours) sunt eliminate la pornire', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apex-')), 'state.json');
  const now = REFERENCE_TIME;
  fs.writeFileSync(file, JSON.stringify({
    activeTrades: {
      EURUSD: { symbol: 'EURUSD', openedAt: now - 100 * 3600e3 },
      XAUUSD: { symbol: 'XAUUSD', openedAt: now - 1 * 3600e3 }
    }
  }));
  const bus = new MarketStateBus(config, { snapshotPath: file, clock: () => now });
  assert.equal(bus.getActiveTrade('EURUSD'), null);
  assert.ok(bus.getActiveTrade('XAUUSD'));
  assert.ok(bus.state.diagnostics.lastErrors.some((e) => e.message.includes('STALE_TRADE_DROPPED_EURUSD')));
});

test('snapshot: salvare + reîncărcare păstrează pozițiile, istoricul și blocajele', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apex-')), 'state.json');
  const now = REFERENCE_TIME;
  const a = new MarketStateBus(config, { snapshotPath: file, clock: () => now });
  a.registerActiveTrade('XAUUSD', { symbol: 'XAUUSD', openedAt: now });
  a.state.closedTrades.push({ symbol: 'EURUSD', resultR: 1 });
  a.setLockout('GBPJPY', now + 3600e3, 'TEST');
  a.saveSnapshot();
  const b = new MarketStateBus(config, { snapshotPath: file, clock: () => now });
  assert.ok(b.getActiveTrade('XAUUSD'));
  assert.equal(b.state.closedTrades.length, 1);
  assert.ok(b.getLockout('GBPJPY'));
});
