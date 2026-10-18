'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrade, evaluateTradeOnBar, forceClose } = require('../src/core/tradeManager');

const base = () => createTrade({ symbol: 'EURUSD', direction: 'LONG', entry: 1.1000, stopLoss: 1.0990, tp1: 1.1015, trailingLock: 1.1022, tp2: 1.1030, protectedBreakEven: 1.1001, openedAt: 0, partialPct: 0.5, costR: 0.1 });
const bar = (o, h, l, c, t = 1) => ({ timestamp: t, open: o, high: h, low: l, close: c });
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('SL simplu → -1R minus costuri', () => {
  const { trade, closed } = evaluateTradeOnBar(base(), bar(1.0995, 1.0996, 1.0985, 1.0988));
  assert.equal(closed, true);
  assert.equal(trade.outcome, 'SL');
  assert.ok(close(trade.resultR, -1.1));
});

test('gap peste stop → umplere la open (mai rău decât stop-ul)', () => {
  const { trade } = evaluateTradeOnBar(base(), bar(1.0980, 1.0982, 1.0975, 1.0978));
  assert.ok(close(trade.exitPrice, 1.0980));
  assert.ok(close(trade.resultR, -2 - 0.1));
});

test('lumânare care atinge și SL și TP → pesimist: SL', () => {
  const { trade } = evaluateTradeOnBar(base(), bar(1.1000, 1.1040, 1.0980, 1.1035));
  assert.equal(trade.outcome, 'SL');
});

test('TP1 → încasare 50% + SL la BE protejat; apoi BE → rezultat 0.75R + rest la BE', () => {
  let r = evaluateTradeOnBar(base(), bar(1.1005, 1.1016, 1.1004, 1.1012));
  assert.equal(r.closed, false);
  assert.equal(r.trade.tp1Hit, true);
  assert.ok(close(r.trade.currentStopLoss, 1.1001));
  assert.ok(close(r.trade.realizedR, 0.75));
  r = evaluateTradeOnBar(r.trade, bar(1.1008, 1.1009, 1.0999, 1.1000, 2));
  assert.equal(r.trade.outcome, 'BE');
  assert.ok(close(r.trade.resultR, 0.75 + 0.5 * 0.1 - 0.1));
});

test('traseu complet: TP1 → trailing → TP2', () => {
  let r = evaluateTradeOnBar(base(), bar(1.1005, 1.1016, 1.1004, 1.1012));
  r = evaluateTradeOnBar(r.trade, bar(1.1012, 1.1023, 1.1011, 1.1020, 2));
  assert.equal(r.trade.trailHit, true);
  assert.ok(close(r.trade.currentStopLoss, 1.1015));
  r = evaluateTradeOnBar(r.trade, bar(1.1020, 1.1031, 1.1018, 1.1030, 3));
  assert.equal(r.trade.outcome, 'TP2');
  assert.ok(close(r.trade.resultR, 0.75 + 1.5 - 0.1));
});

test('SHORT: ieșirile se verifică pe ASK (bid + spread)', () => {
  const t = createTrade({ symbol: 'EURUSD', direction: 'SHORT', entry: 1.1000, stopLoss: 1.1010, tp1: 1.0985, trailingLock: 1.0978, tp2: 1.0970, protectedBreakEven: 1.0999, openedAt: 0 });
  // bid high 1.1009 + spread 0.0002 = ask 1.1011 ≥ SL
  const { trade } = evaluateTradeOnBar(t, bar(1.1005, 1.1009, 1.1003, 1.1006), 0.0002);
  assert.equal(trade.outcome, 'SL');
  // bid low 1.0984 + spread = ask 1.0986 > TP1 1.0985 → TP1 nu e atins
  const r2 = evaluateTradeOnBar(t, bar(1.0990, 1.0992, 1.0984, 1.0986), 0.0002);
  assert.equal(r2.trade.tp1Hit, false);
});

test('inputul nu este modificat (funcție pură)', () => {
  const t = base();
  const snap = JSON.stringify(t);
  evaluateTradeOnBar(t, bar(1.1005, 1.1016, 1.1004, 1.1012));
  assert.equal(JSON.stringify(t), snap);
});

test('închidere forțată la piață', () => {
  const t = forceClose(base(), 1.1005, 0, 'MAX_AGE', 5);
  assert.equal(t.outcome, 'MAX_AGE');
  assert.ok(close(t.resultR, 0.5 - 0.1));
});

test('risc invalid este respins', () => {
  assert.throws(() => createTrade({ symbol: 'X', direction: 'LONG', entry: 1, stopLoss: 1, tp1: 2, trailingLock: 2, tp2: 3, protectedBreakEven: 1, openedAt: 0 }));
});
