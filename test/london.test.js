'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/strategies/londonBreakout');
const { runLondonCycle, stats, MIN_TRADES } = require('../src/academy/londonLive');
const INSTR = require('../config/forex_instruments.json');

const H = 3600e3, DAY = 864e5;
const D0 = Date.UTC(2026, 0, 5); // luni

/** O zi de ore: asia între lo și hi, apoi orele date explicit (după ora 7). */
function dayHours(day, { lo = 1.1000, hi = 1.1010, after = [] } = {}) {
  const out = [];
  for (let h = 0; h < 7; h++) out.push({ t: day + h * H, o: lo + 0.0005, h: h === 2 ? hi : lo + 0.0007, l: h === 4 ? lo : lo + 0.0003, c: lo + 0.0005 });
  for (let h = 7; h < 24; h++) {
    const x = after[h - 7] || { o: lo + 0.0005, h: lo + 0.0008, l: lo + 0.0002, c: lo + 0.0005 };
    out.push(Object.assign({ t: day + h * H }, x));
  }
  return out;
}

/** Istoric de `n` zile lucrătoare cu amplitudine zilnică ~50 pips (pentru ATR). */
function history(n, endDay) {
  const out = [];
  let day = endDay - DAY, k = 0;
  while (k < n) {
    const wd = new Date(day).getUTCDay();
    if (wd >= 1 && wd <= 5) {
      for (let h = 0; h < 24; h++) out.push({ t: day + h * H, o: 1.1, h: h === 10 ? 1.1025 : 1.1005, l: h === 15 ? 1.0975 : 1.0995, c: 1.1 });
      k++;
    }
    day -= DAY;
  }
  return out.sort((a, b) => a.t - b.t);
}

test('Londra: spargere în sus → intrare la maximul intervalului, stop la minim, ieșire la 20:00 cu costuri', () => {
  const after = [{ o: 1.1008, h: 1.1016, l: 1.1007, c: 1.1014 }];
  for (let i = 1; i < 17; i++) after.push({ o: 1.1014 + i * 0.0001, h: 1.1016 + i * 0.0001, l: 1.1012 + i * 0.0001, c: 1.1015 + i * 0.0001 });
  const bars = dayHours(D0, { after });
  const plan = L.planDay(bars, 0.0050);
  assert.equal(plan.skip, undefined);
  assert.ok(Math.abs(plan.hi - 1.1010) < 1e-9 && Math.abs(plan.lo - 1.1000) < 1e-9);
  const t = L.settleDay(bars, plan, { pipSize: 0.0001, costPips: 1.2 });
  assert.equal(t.direction, 'LONG');
  assert.equal(t.outcome, 'TIME');
  const exitOpen = bars.find((b) => L.hourOf(b.t) === 20).o;
  assert.ok(Math.abs(t.resultR - (exitOpen - 1.1010 - 0.00012) / 0.0010) < 1e-3, JSON.stringify(t));
});

test('Londra: aceeași oră sparge ambele părți → nicio tranzacție; stop atins → −1R minus costuri', () => {
  const both = dayHours(D0, { after: [{ o: 1.1005, h: 1.1015, l: 1.0995, c: 1.1005 }] });
  assert.equal(L.settleDay(both, L.planDay(both, 0.005), { pipSize: 0.0001 }), null);
  const stop = dayHours(D0, { after: [{ o: 1.1008, h: 1.1012, l: 1.1006, c: 1.1011 }, { o: 1.1011, h: 1.1011, l: 1.0998, c: 1.0999 }] });
  const t = L.settleDay(stop, L.planDay(stop, 0.005), { pipSize: 0.0001, costPips: 1.2 });
  assert.equal(t.outcome, 'STOP');
  assert.ok(Math.abs(t.resultR - (-1 - 0.12)) < 1e-6, String(t.resultR));
});

test('Londra: intervalul prea larg sau prea îngust față de ATR → nu tranzacționăm', () => {
  const bars = dayHours(D0);
  assert.equal(L.planDay(bars, 0.0010).skip, 'INTERVAL_PREA_LARG');
  assert.equal(L.planDay(bars, 0.0100).skip, 'INTERVAL_PREA_ÎNGUST');
  assert.ok(Math.abs(L.atrBefore(history(25, D0), D0) - 0.0050) < 1e-9, 'ATR din zilele anterioare');
  assert.equal(L.atrBefore(history(10, D0), D0), null, 'prea puține zile ⇒ fără ATR');
});

test('Londra live: înregistrează pe hârtie doar după 20:00 UTC, o dată pe zi; nu trimite nimic înainte de absolvire', async () => {
  const after = [{ o: 1.1008, h: 1.1016, l: 1.1007, c: 1.1014 }];
  for (let i = 1; i < 17; i++) after.push({ o: 1.1016, h: 1.1018, l: 1.1014, c: 1.1016 });
  const hours = history(25, D0).concat(dayHours(D0, { after }));
  const bus = { state: {} };
  const msgs = [];
  const fetchHours = async () => hours;
  const notify = async (t) => { msgs.push(t); };
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 15 * H, pairs: ['EURUSD'] });
  assert.equal(bus.state.fxLondon.trades.length, 0, 'înainte de 20:00 nimic');
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 21 * H, pairs: ['EURUSD'] });
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 22 * H, pairs: ['EURUSD'] });
  assert.equal(bus.state.fxLondon.trades.length, 1, 'o singură dată pe zi');
  assert.equal(bus.state.fxLondon.trades[0].live, false, 'pe hârtie');
  assert.equal(msgs.length, 0, 'fără mesaje înainte de absolvire');
});

test('Londra live: absolvă doar cu destule tranzacții live și medie clar pozitivă; apoi trimite ordinele la 07:00 UTC', async () => {
  const bus = { state: {} };
  const msgs = [];
  const notify = async (t) => { msgs.push(t); };
  const hours = history(25, D0).concat(dayHours(D0));
  const fetchHours = async () => hours;
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 3 * H, pairs: ['EURUSD'] });
  const book = bus.state.fxLondon;
  for (let k = 0; k < MIN_TRADES - 1; k++) book.trades.push({ resultR: k % 2 ? 1.5 : -0.8 });
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 3 * H, pairs: ['EURUSD'] });
  assert.equal(book.graduated, null, `sub ${MIN_TRADES} tranzacții nu absolvă`);
  book.trades.push({ resultR: 1.5 });
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 3 * H, pairs: ['EURUSD'] });
  assert.ok(book.graduated, 'absolvit');
  assert.ok(msgs.some((m) => /a absolvit/.test(m)));
  msgs.length = 0;
  await runLondonCycle({ bus, instruments: INSTR, fetchHours, notify, now: D0 + 7 * H + 10 * 60e3, pairs: ['EURUSD'], env: { LONDON_RISK_PCT: '1', LONDON_ACCOUNT: '10000' } });
  assert.equal(msgs.length, 1, msgs.join('\n'));
  assert.ok(/BUY STOP la <b>1\.10100<\/b>/.test(msgs[0]) && /SELL STOP la <b>1\.10000<\/b>/.test(msgs[0]), msgs[0]);
  assert.ok(/Lot: <b>1\.00<\/b>/.test(msgs[0]), 'risc 100 $ pe 10 pips ⇒ 1 lot EURUSD');
  const flat = { state: { fxLondon: Object.assign({}, book, { trades: Array.from({ length: 200 }, (_, k) => ({ resultR: k % 2 ? 0.1 : -0.1 })), graduated: null }) } };
  await runLondonCycle({ bus: flat, instruments: INSTR, fetchHours, notify, now: D0 + 3 * H, pairs: ['EURUSD'] });
  assert.equal(flat.state.fxLondon.graduated, null, 'media zero ⇒ nu absolvă');
  assert.equal(stats([{ resultR: 1 }, { resultR: -1 }]).mean, 0);
});
