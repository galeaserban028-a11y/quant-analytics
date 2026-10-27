'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('gardian: cu minRiskFrac nu deschide poziții minuscule când bugetul zilei e aproape plin', () => {
  const { decide } = require('../src/prop/guardian');
  const rules = { dailyLoss: 0.05, maxLoss: 0.08, maxLossType: 'static' };
  const acct = { initial: 5000, balance: 5000, dayStartBalance: 5000, openRisk: 195.38, highestEod: 5000, phaseTarget: 0.08, tradingDays: 1 };
  const loose = decide(acct, rules, { riskPct: 4, safety: 0.8 });
  assert.ok(loose.allow && loose.riskAmount < 5, 'fără prag: ~4,6 $');
  const strict = decide(acct, rules, { riskPct: 4, safety: 0.8, minRiskFrac: 0.25 });
  assert.equal(strict.allow, false);
  assert.equal(strict.reason, 'LIMITA_ZILNICĂ');
});
