'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyReport } = require('../src/weeklyReport');

test('raportul săptămânii: soldul contului de test, tranzacțiile închise în ultimele 7 zile și antrenamentele', () => {
  const now = Date.UTC(2026, 10, 1, 9);
  const state = {
    prop: { initialized: true, initial: 5000, balance: 5150, positions: { 'GER40|d7': { symbol: 'GER40' } },
      history: [{ sym: 'SPX500', direction: 'LONG', closedAt: now - 2 * 864e5, pnl: 150 }, { sym: 'NAS100', direction: 'LONG', closedAt: now - 20 * 864e5, pnl: -100 }] },
    orb: { trades: [{ resultR: 1 }, { resultR: -0.5 }] },
    gold: { trades: [] }
  };
  const txt = weeklyReport(state, now);
  assert.match(txt, /Sold: <b>5150 \$<\/b> \(\+150 \$ de la pornire, 3\.0%\)/);
  assert.match(txt, /1 închise, 1 pe profit · \+150 \$/);
  assert.match(txt, /SPX500 cumpărare: \+150 \$/);
  assert.doesNotMatch(txt, /NAS100/);
  assert.match(txt, /Deschise acum: GER40/);
  assert.match(txt, /mai sunt 250 \$/);
  assert.match(txt, /Scalping S&P\/Nasdaq \(M15\): 2 tranzacții, 1 pe profit, total \+0\.5R/);
  assert.match(txt, /Aur H4: încă nicio tranzacție/);
});
