'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/strategies/openingBreakout');
const { runOrbCycle, MIN_TRADES } = require('../src/academy/orbLive');
const INSTR = require('../config/forex_instruments.json');

const M = 900e3, DAY = 864e5;
// marți 20 oct. 2026: New York e pe ora de vară (UTC−4), deci 09:30 NY = 13:30 UTC
const open = (y, m, d) => Date.UTC(y, m, d, 13, 30);

/** O sesiune de 26 de lumânări (09:30–16:00 NY); primele două formează intervalul [lo, hi]. */
function session(t0, { lo = 100, hi = 104, after = [] } = {}) {
  const out = [{ t: t0, o: 102, h: hi, l: 101, c: 102 }, { t: t0 + M, o: 102, h: 103, l: lo, c: 102 }];
  for (let k = 2; k < 26; k++) out.push(Object.assign({ t: t0 + k * M }, after[k - 2] || { o: 102, h: 103, l: 101, c: 102 }));
  return out;
}
function history(nDays, beforeT0) {
  const out = [];
  let k = 1, made = 0;
  while (made < nDays) {
    const t0 = beforeT0 - k * DAY; k++;
    const wd = new Date(t0).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let j = 0; j < 26; j++) out.push({ t: t0 + j * M, o: 100, h: j === 5 ? 115 : 101, l: j === 9 ? 95 : 99, c: 100 });
    made++;
  }
  return out;
}

test('spargerea deschiderii: interval din primele 30 de minute, intrare la spargere, ieșire la 14:00 New York cu costuri', () => {
  const t0 = open(2026, 9, 20);
  const after = [{ o: 103, h: 105, l: 102.5, c: 104.5 }];
  for (let i = 1; i < 24; i++) after.push({ o: 106, h: 107, l: 105, c: 106 });
  const bars = session(t0, { after });
  const days = O.sessionDays(bars);
  const today = days.get('2026-10-20');
  assert.equal(today.length, 26);
  const plan = O.planDay(today, 20);
  assert.equal(plan.hi, 104); assert.equal(plan.lo, 100);
  const t = O.settleDay(today, plan, { costPts: 1 });
  assert.equal(t.direction, 'LONG');
  assert.equal(t.outcome, 'TIME');
  assert.ok(Math.abs(t.resultR - (106 - 104 - 1) / 4) < 1e-9, String(t.resultR)); // ieșire la deschiderea lumânării de 14:00
  assert.equal(O.planDay(today, 100).skip, 'INTERVAL_PREA_ÎNGUST');
  assert.equal(O.planDay(today, 5).skip, 'INTERVAL_PREA_LARG');
});

test('spargerea deschiderii: ambele părți în aceeași lumânare → fără intrare; stop atins → −1R minus costuri', () => {
  const t0 = open(2026, 9, 20);
  const both = O.sessionDays(session(t0, { after: [{ o: 102, h: 105, l: 99, c: 102 }] })).get('2026-10-20');
  assert.equal(O.settleDay(both, O.planDay(both, 20), { costPts: 1 }), null);
  const stop = O.sessionDays(session(t0, { after: [{ o: 103, h: 105, l: 103, c: 104.5 }, { o: 104, h: 104, l: 99, c: 99.5 }] })).get('2026-10-20');
  const t = O.settleDay(stop, O.planDay(stop, 20), { costPts: 1 });
  assert.equal(t.outcome, 'STOP');
  assert.ok(Math.abs(t.resultR - (-4 - 1) / 4) < 1e-9);
});

test('scalping live: pe hârtie după închiderea bursei, o dată pe zi; fără mesaje până la absolvire; apoi ordine la ~17:00', async () => {
  const t0 = open(2026, 9, 20);
  const after = [{ o: 103, h: 105, l: 102.5, c: 104.5 }];
  for (let i = 1; i < 24; i++) after.push({ o: 106, h: 107, l: 105, c: 106 });
  const bars = history(25, t0).concat(session(t0, { after }));
  const bus = { state: {} }, msgs = [];
  const notify = async (x) => { msgs.push(x); };
  const fetchBars = async () => bars;
  await runOrbCycle({ bus, instruments: INSTR, fetchBars, notify, now: t0 + 3 * 3600e3, syms: ['SPX500'] });
  assert.equal(bus.state.orb.trades.length, 0, 'înainte de închidere nimic');
  await runOrbCycle({ bus, instruments: INSTR, fetchBars, notify, now: t0 + 7 * 3600e3, syms: ['SPX500'] });
  await runOrbCycle({ bus, instruments: INSTR, fetchBars, notify, now: t0 + 8 * 3600e3, syms: ['SPX500'] });
  assert.equal(bus.state.orb.trades.length, 1, 'o singură dată pe zi');
  assert.equal(msgs.length, 0, 'fără mesaje înainte de absolvire');
  const book = bus.state.orb;
  for (let k = 0; k < MIN_TRADES; k++) book.trades.push({ resultR: k % 2 ? 1.2 : -0.8 });
  const t1 = t0 + DAY; // miercuri
  const bars2 = bars.concat(session(t1));
  await runOrbCycle({ bus, instruments: INSTR, fetchBars: async () => bars2, notify, now: t1 + 40 * 60e3, syms: ['SPX500'], env: { ORB_RISK_PCT: '0.5', ORB_ACCOUNT: '5000' } });
  assert.ok(book.graduated, 'absolvit');
  assert.ok(msgs.some((x) => /absolvit/.test(x)));
  await runOrbCycle({ bus, instruments: INSTR, fetchBars: async () => bars2, notify, now: t1 + 45 * 60e3, syms: ['SPX500'], env: { ORB_RISK_PCT: '0.5', ORB_ACCOUNT: '5000' } });
  assert.ok(msgs.some((x) => /BUY STOP: <b>104\.0<\/b>/.test(x) && /SELL STOP: <b>100\.0<\/b>/.test(x)), msgs.join('\n---\n'));
  assert.ok(msgs.some((x) => /Lot: <b>6\.25<\/b>/.test(x)), 'risc 25 $ pe 4 puncte ⇒ 6,25 loturi');
  const n = msgs.length;
  await runOrbCycle({ bus, instruments: INSTR, fetchBars: async () => bars2, notify, now: t1 + 4.6 * 3600e3, syms: ['SPX500'] });
  assert.equal(msgs.length, n + 1);
  assert.match(msgs[n], /închide ACUM/);
});
