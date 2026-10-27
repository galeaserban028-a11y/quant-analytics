'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runGoldCycle, toH4 } = require('../src/academy/goldLive');
const INSTR = require('../config/forex_instruments.json');

test('aur H4: ore → lumânări de 4 ore; antrenamentul păstrează doar tranzacțiile de după pornire și nu trimite nimic', async () => {
  const t0 = Date.UTC(2024, 0, 1);
  const hours = [];
  for (let i = 0; i < 24 * 400; i++) { const p = 2000 + 300 * Math.sin(i / 600) + i * 0.02; hours.push({ t: t0 + i * 3600e3, o: p, h: p + 2, l: p - 2, c: p + 0.5 }); }
  const h4 = toH4(hours.slice(0, 8));
  assert.equal(h4.length, 2);
  assert.equal(h4[0].open, hours[0].o); assert.equal(h4[0].close, hours[3].c);
  const bus = { state: {} }, msgs = [];
  const startedAt = t0 + 24 * 200 * 3600e3;
  bus.state.gold = { v: 1, startedAt, trades: [], open: null, lastFetch: 0, graduated: null };
  const now = t0 + 24 * 400 * 3600e3;
  const r = await runGoldCycle({ bus, instruments: INSTR, fetchHours: async () => hours, notify: async (m) => msgs.push(m), now });
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(bus.state.gold.trades.every((t) => t.openedAt >= startedAt), 'doar tranzacții de după pornire');
  const again = await runGoldCycle({ bus, instruments: INSTR, fetchHours: async () => hours, notify: async (m) => msgs.push(m), now: now + 60e3 });
  assert.equal(again.skipped, 'DEVREME', 'o dată pe oră');
  assert.equal(msgs.length, 0);
});
