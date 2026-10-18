'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateBars, liveState, currentSignal, updateVotes, H4_MS } = require('../src/strategies/trendDesk');
const { generateRandomWalk } = require('../src/backtest/synthetic');
const { computeMetrics } = require('../src/backtest/metrics');
const { aggregate } = require('../src/core/candles');
const MarketStateBus = require('../src/core/MarketStateBus');
const { runTrendCycle } = require('../src/trendLive');
const config = require('../config/agents_config.json');

const inst = config.instruments.BTCUSD;
const params = { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: true };

/** Serie H4 sintetică: random walk agregat la 4h (fără edge). */
function h4Walk(seed, days = 600) {
  const m15 = generateRandomWalk({ seed, days, startPrice: 30000, pipSize: 1, baseVolPips: 60, weekdaysOnly: false });
  return aggregate(m15, H4_MS);
}

/** Serie H4 cu trend clar ascendent, pentru teste deterministe de comportament. */
function h4Trend(n = 400, start = Date.UTC(2024, 0, 1)) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const drift = i < 200 ? (i % 7 === 0 ? -0.6 : 0.1) : 0.8; // întâi lateral, apoi trend puternic
    const o = p; const c = p + drift;
    out.push({ timestamp: start + i * H4_MS, open: o, high: Math.max(o, c) + 0.3, low: Math.min(o, c) - 0.3, close: c, volume: 1 });
    p = c;
  }
  return out;
}

test('trend: fără look-ahead — modificarea viitorului nu schimbă tranzacțiile închise înainte', () => {
  const h4 = h4Walk(3);
  const base = simulateBars('BTCUSD', h4, inst, params);
  const cut = h4[Math.floor(h4.length * 0.6)].timestamp;
  const mutated = h4.map((b) => (b.timestamp >= cut ? { ...b, open: b.open * 1.2, high: b.high * 1.3, low: b.low * 1.1, close: b.close * 1.2 } : b));
  const alt = simulateBars('BTCUSD', mutated, inst, params);
  const before = (t) => t.filter((x) => x.closedAt <= cut).map((x) => JSON.stringify(x));
  assert.ok(before(base).length > 5);
  assert.deepEqual(before(alt), before(base));
});

test('trend: pe random walk nu apare edge semnificativ (test de sănătate)', () => {
  const all = [];
  for (let s = 1; s <= 6; s++) all.push(...simulateBars('BTCUSD', h4Walk(s), inst, params));
  const m = computeMetrics(all);
  assert.ok(m.trades > 100);
  assert.ok(m.expectancyCI95[0] <= 0, JSON.stringify(m));
});

test('trend: într-un trend ascendent clar intră LONG și câștigă', () => {
  const trades = simulateBars('BTCUSD', h4Trend(), inst, { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false });
  const longs = trades.filter((t) => t.direction === 'LONG');
  assert.ok(longs.length >= 1);
  assert.ok(longs.reduce((s, t) => s + t.resultR, 0) > 0);
  assert.ok(trades.every((t) => t.direction === 'LONG'), 'allowShort=false nu deschide SHORT');
});

test('trend: stopul de trailing nu coboară niciodată pentru o poziție LONG deschisă; costurile sunt scăzute', () => {
  const h4 = h4Trend();
  const p = { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false };
  let prev = null;
  let checks = 0;
  for (let cut = 220; cut <= h4.length; cut++) {
    const { position } = liveState('BTCUSD', h4.slice(0, cut), inst, p);
    if (position && prev && prev.openedAt === position.openedAt) {
      assert.ok(position.stop >= prev.stop - 1e-12, `stopul a coborât: ${prev.stop} → ${position.stop}`);
      checks += 1;
    }
    prev = position;
  }
  assert.ok(checks > 50, 'testul trebuie să urmărească poziția pe multe lumânări');
  for (const t of simulateBars('BTCUSD', h4, inst, p)) assert.ok(t.costR > 0);
});

test('trend: starea live = starea simulatorului și nu depinde de lungimea ferestrei', () => {
  const h4 = h4Walk(5, 900);
  for (const cut of [2000, 3000, 4000, h4.length]) {
    const part = h4.slice(0, cut);
    const a = liveState('BTCUSD', part, inst, params);
    const b = liveState('BTCUSD', part.slice(-700), inst, params);
    assert.deepEqual(a.position, b.position);
  }
});

test('trend: semnalul curent și voturile Donchian', () => {
  const h4 = h4Trend();
  const sig = currentSignal(h4, params);
  assert.equal(sig.ready, true);
  assert.equal(sig.direction, 'LONG');
  const votes = updateVotes([{ high: 1, low: 0, close: 0.5 }, { high: 1, low: 0, close: 2 }], 1, [1], null);
  assert.deepEqual(votes, [1]);
});

test('trend: intrarea la open-ul următor (test de latență) e deterministă', () => {
  const h4 = h4Walk(9);
  const a = simulateBars('BTCUSD', h4, inst, params, { entryAtNextOpen: true });
  const b = simulateBars('BTCUSD', h4, inst, params, { entryAtNextOpen: true });
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

test('trend live: intrare → trailing → ieșire, cu mesaje doar la schimbări și persistență', async () => {
  const full = h4Trend(400);
  let now = full[260].timestamp + H4_MS;
  const bus = new MarketStateBus(config, { snapshotPath: null, clock: () => now });
  bus.state.trend.initialized = true; // sistemul rula deja
  const cfg = JSON.parse(JSON.stringify(config));
  cfg.trendDesk.enabled = true;
  cfg.trendDesk.symbols = ['BTCUSD'];
  cfg.trendDesk.params = { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false };
  const msgs = [];
  const notify = async (t) => { msgs.push(t); };
  const fetchH4 = async () => full.filter((b) => b.timestamp + H4_MS <= now);

  await runTrendCycle({ config: cfg, bus, notify, fetchH4, now });
  assert.ok(bus.state.trend.positions.BTCUSD, 'poziție deschisă în trend');
  assert.ok(msgs.some((m) => m.includes('CUMPĂRĂ')));

  const n = msgs.length;
  await runTrendCycle({ config: cfg, bus, notify, fetchH4, now }); // aceeași lumânare → niciun mesaj nou
  assert.equal(msgs.length, n);

  now += 10 * H4_MS;
  await runTrendCycle({ config: cfg, bus, notify, fetchH4, now });
  assert.ok(msgs.some((m) => m.includes('mută stopul')));

  // prăbușire → ieșire
  const crash = full.slice(0, 280).concat(Array.from({ length: 10 }, (_, i) => {
    const t = full[279].timestamp + (i + 1) * H4_MS; const o = full[279].close - i * 20;
    return { timestamp: t, open: o, high: o + 1, low: o - 20, close: o - 19, volume: 1 };
  }));
  now = crash[crash.length - 1].timestamp + H4_MS;
  await runTrendCycle({ config: cfg, bus, notify, fetchH4: async () => crash, now });
  assert.ok(!bus.state.trend.positions.BTCUSD);
  assert.ok(msgs.some((m) => m.includes('IEȘIRE')));
});

test('trend live: limita de risc a portofoliului refuză poziții noi', async () => {
  const full = h4Trend(400);
  const now = full[300].timestamp + H4_MS;
  const bus = new MarketStateBus(config, { snapshotPath: null, clock: () => now });
  bus.state.trend.initialized = true;
  const cfg = JSON.parse(JSON.stringify(config));
  Object.assign(cfg.trendDesk, { enabled: true, symbols: ['BTCUSD', 'ETHUSD'], maxOpen: 1, params: { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false } });
  const msgs = [];
  await runTrendCycle({ config: cfg, bus, notify: async (t) => msgs.push(t), fetchH4: async () => full.filter((b) => b.timestamp + H4_MS <= now), now });
  assert.equal(Object.keys(bus.state.trend.positions).length, 1);
  assert.ok(msgs.some((m) => m.includes('limita de risc')));
});

test('trend live: departament dezactivat → nu face nimic', async () => {
  const bus = new MarketStateBus(config, { snapshotPath: null });
  const res = await runTrendCycle({ config, bus, notify: async () => { throw new Error('nu trebuia'); } });
  assert.equal(res.skipped, 'TREND_DESK_DISABLED');
});

test('trend: când volatilitatea explodează, stopul NU coboară (ATR mai mare nu are voie să slăbească protecția)', () => {
  const h4 = h4Trend(300);
  // după trend: preț aproape plat, dar lumânări foarte mari → ATR crește mult
  const last = h4[h4.length - 1];
  for (let i = 1; i <= 40; i++) {
    const o = last.close + (i % 2 ? 0.2 : -0.2);
    h4.push({ timestamp: last.timestamp + i * H4_MS, open: o, high: o + 6, low: o - 1.5, close: o + 0.1, volume: 1 });
  }
  const p = { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false };
  let prev = null, checks = 0;
  for (let cut = 290; cut <= h4.length; cut++) {
    const { position } = liveState('BTCUSD', h4.slice(0, cut), inst, p);
    if (position && prev && prev.openedAt === position.openedAt) { assert.ok(position.stop >= prev.stop - 1e-12, `stop ${prev.stop} → ${position.stop}`); checks++; }
    prev = position;
  }
  assert.ok(checks > 5);
});

test('trend live: la PRIMA pornire, pozițiile deja în curs sunt preluate fără semnal de intrare', async () => {
  const full = h4Trend(400);
  let now = full[300].timestamp + H4_MS;
  const bus = new MarketStateBus(config, { snapshotPath: null, clock: () => now });
  const cfg = JSON.parse(JSON.stringify(config));
  Object.assign(cfg.trendDesk, { enabled: true, symbols: ['BTCUSD'], params: { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: false } });
  const msgs = [];
  const res = await runTrendCycle({ config: cfg, bus, notify: async (t) => msgs.push(t), fetchH4: async () => full.filter((b) => b.timestamp + H4_MS <= now), now });
  assert.equal(res.adopted.length, 1);
  assert.ok(!msgs.some((m) => m.includes('CUMPĂRĂ')), 'nu cere intrare într-o poziție veche');
  assert.ok(msgs.some((m) => m.includes('a pornit') && m.includes('NU intra')));
  assert.equal(bus.state.trend.initialized, true);
  // următoarea lumânare: doar trailing, fără intrare
  now += H4_MS;
  await runTrendCycle({ config: cfg, bus, notify: async (t) => msgs.push(t), fetchH4: async () => full.filter((b) => b.timestamp + H4_MS <= now), now });
  assert.ok(!msgs.some((m) => m.includes('CUMPĂRĂ')));
});

test('mesaj de intrare: avertisment pentru semnal vechi', () => {
  const { formatTrendEntry } = require('../src/notify/telegram');
  const pos = { symbol: 'BTCUSD', direction: 'LONG', entry: 100, initialStop: 90, stop: 90, openedAt: 0 };
  assert.ok(!formatTrendEntry(pos, inst, 0.5, 30 * 60e3).includes('Semnalul e vechi'));
  assert.ok(formatTrendEntry(pos, inst, 0.5, 10 * 3600e3).includes('Semnalul e vechi'));
});
