'use strict';

/**
 * Teste pentru DEPARTAMENTUL PROP (Forex / aur / indici): strategia Pullback, Gardianul, simulatorul de examen,
 * calculul lotului, sursele de date zilnice și ciclul live complet (cu date injectate, fără internet).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mr = require('../src/strategies/meanRevDesk');
const { decide } = require('../src/prop/guardian');
const { simulateChallenges, runAccount } = require('../src/prop/challengeSim');
const { PROP_RULES } = require('../src/prop/rules');
const { lotsFor, quoteToUsd } = require('../src/prop/lots');
const ds = require('../src/data/dailySources');
const { cleanSpikes } = require('../src/core/candles');
const { rng } = require('../src/backtest/metrics');
const { runPropCycle, propSummary, dayKeyIn, samePos } = require('../src/propLive');
const MarketStateBus = require('../src/core/MarketStateBus');
const { loadConfig } = require('../src/config');
const INSTR = require('../config/forex_instruments.json');

const DAY = 864e5;
const T0 = Date.UTC(2020, 0, 1);

/** Mers aleator zilnic, fără gap-uri (open = close-ul anterior). */
function randomWalk(n, seed, { start = 1.2, vol = 0.006, drift = 0 } = {}) {
  const r = rng(seed);
  const out = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = open * (1 + drift + vol * (r() + r() + r() - 1.5) * 1.4);
    const high = Math.max(open, close) * (1 + vol * 0.4 * r());
    const low = Math.min(open, close) * (1 - vol * 0.4 * r());
    out.push({ timestamp: T0 + i * DAY, open, high, low, close, volume: 0 });
    px = close;
  }
  return out;
}

/** Trend ascendent constant, apoi două zile de scădere bruscă (semnal LONG garantat pe ultima lumânare). */
function pullbackSeries(n = 300) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const close = 1.0 + 0.001 * i;
    out.push({ timestamp: T0 + i * DAY, open: close - 0.001, high: close + 0.002, low: close - 0.003, close, volume: 0 });
  }
  for (let k = 1; k <= 2; k++) {
    const prev = out[out.length - 1].close;
    const close = prev - 0.01;
    out.push({ timestamp: T0 + (n + k - 1) * DAY, open: prev, high: prev + 0.001, low: close - 0.001, close, volume: 0 });
  }
  return out;
}

const naiveSma = (xs, i, len) => (i < len - 1 ? NaN : xs.slice(i - len + 1, i + 1).reduce((s, v) => s + v, 0) / len);

// ───────────────────────────── Strategia Pullback ─────────────────────────────

test('pullback: SMA corectă și RSI(2) în [0,100]; serie strict crescătoare ⇒ RSI 100', () => {
  const xs = randomWalk(300, 3).map((b) => b.close);
  const sma = mr.smaSeries(xs, 20);
  for (const i of [0, 18, 19, 50, 299]) {
    if (Number.isNaN(naiveSma(xs, i, 20))) assert.ok(Number.isNaN(sma[i]));
    else assert.ok(Math.abs(sma[i] - naiveSma(xs, i, 20)) < 1e-12);
  }
  const rsi = mr.rsiSeries(xs, 2);
  assert.ok(rsi.slice(2).every((v) => v >= 0 && v <= 100));
  assert.ok(mr.rsiSeries([1, 2, 3, 4, 5, 6], 2).slice(2).every((v) => v === 100));
  // două scăderi după urcări mici ⇒ RSI foarte mic
  const rs = mr.rsiSeries([1, 1.001, 1.002, 1.003, 0.993, 0.983], 2);
  assert.ok(rs[5] < 5, `RSI=${rs[5]}`);
});

test('pullback: fără look-ahead — tranzacțiile închise pe date trunchiate sunt identice cu cele pe istoria completă', () => {
  const p = { trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true };
  for (const seed of [1, 2, 3]) {
    const bars = randomWalk(900, seed, { drift: seed === 2 ? -0.0003 : 0.0003 });
    const full = mr.simulateBars('X', bars, INSTR.EURUSD, p);
    for (const cut of [400, 650]) {
      const part = mr.simulateBars('X', bars.slice(0, cut), INSTR.EURUSD, p).filter((t) => t.outcome !== 'END_OF_DATA');
      assert.ok(part.length > 0, 'trebuie să existe tranzacții');
      assert.deepEqual(part, full.slice(0, part.length));
    }
  }
});

test('pullback: stop OBLIGATORIU pe partea corectă; fără gap-uri, pierderea nu depășește 1R + costuri', () => {
  const p = { trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true };
  const trades = [1, 2, 3, 4].flatMap((s) => mr.simulateBars('X', randomWalk(1200, s * 11), INSTR.EURUSD, p));
  assert.ok(trades.length > 50);
  for (const t of trades) {
    assert.ok(Number.isFinite(t.initialStopLoss));
    if (t.direction === 'LONG') assert.ok(t.initialStopLoss < t.entry); else assert.ok(t.initialStopLoss > t.entry);
    assert.ok(t.resultR >= -1 - t.costR - 1e-4, `${t.resultR} < -1R`); // R e rotunjit la 4 zecimale
    assert.ok(['STOP', 'TARGET', 'TIME', 'END_OF_DATA'].includes(t.outcome));
    assert.ok(t.closedAt > t.openedAt);
    assert.ok((t.closedAt - t.openedAt) / DAY <= p.maxDays + 1e-9, 'ține poziția peste maxDays');
  }
});

test('pullback: costurile (spread + swap) scad rezultatul, niciodată nu îl cresc', () => {
  const p = { trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: false };
  const bars = randomWalk(1500, 9, { drift: 0.0002 });
  const free = Object.assign({}, INSTR.EURUSD, { typicalSpreadPips: 0, swapRatePct: 0 });
  const a = mr.simulateBars('X', bars, free, p);
  const b = mr.simulateBars('X', bars, INSTR.EURUSD, p);
  const sum = (ts) => ts.reduce((s, t) => s + t.resultR, 0);
  assert.ok(b.every((t) => t.costR > 0));
  assert.ok(sum(b) < sum(a));
});

test('pullback: pe mers aleator fără tendință și fără costuri, avantajul e ~0 (nu „inventează” profit)', () => {
  const p = { trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 3, maxDays: 10, allowShort: true };
  const free = Object.assign({}, INSTR.EURUSD, { typicalSpreadPips: 0, swapRatePct: 0 });
  const trades = [];
  for (let s = 1; s <= 30; s++) trades.push(...mr.simulateBars('X', randomWalk(1500, 1000 + s), free, p));
  const e = trades.reduce((s, t) => s + t.resultR, 0) / trades.length;
  assert.ok(trades.length > 500);
  assert.ok(Math.abs(e) < 0.06, `E=${e}`);
});

test('pullback: starea live = poziția deschisă din simulator; semnalul apare pe lumânarea corectă', () => {
  const bars = pullbackSeries();
  const params = { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true };
  const st = mr.liveState('EURUSD', bars, INSTR.EURUSD, params);
  assert.ok(st.position, 'trebuie să existe semnal LONG');
  assert.equal(st.position.direction, 'LONG');
  assert.equal(st.position.openedAt, bars[bars.length - 1].timestamp + DAY);
  assert.ok(st.position.stop < st.position.entry);
  // fără ultima zi de scădere: încă nu e semnal
  assert.equal(mr.liveState('EURUSD', bars.slice(0, -1), INSTR.EURUSD, params).position, null);
  // revenire peste media de 3 zile ⇒ ieșire TARGET
  const last = bars[bars.length - 1];
  const up = bars.concat([{ timestamp: last.timestamp + DAY, open: last.close, high: last.close + 0.03, low: last.close - 0.001, close: last.close + 0.025, volume: 0 }]);
  const st2 = mr.liveState('EURUSD', up, INSTR.EURUSD, params);
  assert.equal(st2.position, null);
  assert.equal(st2.lastClosed.outcome, 'TARGET');
  assert.ok(st2.lastClosed.resultR > 0);
});

test('pullback: ieșire forțată după exact maxDays zile dacă prețul nu revine (și stopul nu e atins)', () => {
  const bars = pullbackSeries();
  const params = { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: false };
  let px = bars[bars.length - 1].close;
  for (let k = 1; k <= 14; k++) { // scădere lentă: sub media scurtă, dar departe de stop
    const open = px; px -= 0.0003;
    bars.push({ timestamp: bars[bars.length - 1].timestamp + DAY, open, high: open + 0.0002, low: px - 0.0002, close: px, volume: 0 });
  }
  const t = mr.simulateBars('EURUSD', bars, INSTR.EURUSD, params).find((x) => x.outcome !== 'END_OF_DATA');
  assert.ok(t, 'trebuie să existe tranzacția');
  assert.equal(t.outcome, 'TIME');
  assert.equal(Math.round((t.closedAt - t.openedAt) / DAY), 10);
  assert.ok(t.resultR < 0 && t.resultR > -1);
});

// ───────────────────────────── Gardianul Prop ─────────────────────────────

test('gardian: pe 20.000 de conturi aleatoare NU permite niciodată un risc care ar putea încălca limitele', () => {
  const r = rng(42);
  for (const [key, rules] of Object.entries(PROP_RULES)) {
    for (let i = 0; i < 5000; i++) {
      const initial = 10000;
      const balance = initial * (0.88 + r() * 0.24);
      const highestEod = Math.max(initial, balance) + r() * 500;
      const dayStart = balance + (r() - 0.4) * 400;
      const openRisk = r() * 400;
      const safety = [0.7, 0.8, 0.9][i % 3];
      const acct = { initial, balance, dayStartBalance: dayStart, openRisk, highestEod, phaseTarget: i % 4 === 0 ? null : rules.phases[0] };
      const d = decide(acct, rules, { riskPct: 1 + r() * 4, safety, maxOpen: 5, openCount: i % 6 });
      if (!d.allow) continue;
      assert.ok(d.riskAmount > 0);
      const floor = rules.maxLossType === 'trailingEod' ? Math.max(initial, highestEod) - initial * rules.maxLoss : initial * (1 - rules.maxLoss);
      const worstBalance = balance - openRisk - d.riskAmount;
      assert.ok(worstBalance > floor, `${key}: ar sparge limita totală`);
      const lostToday = Math.max(0, dayStart - balance);
      assert.ok(lostToday + openRisk + d.riskAmount <= initial * rules.dailyLoss * safety + 1e-6, `${key}: ar sparge limita zilnică`);
      assert.ok(i % 6 < 5, 'maxOpen depășit');
    }
  }
});

test('gardian: se oprește la țintă, reduce riscul în drawdown, iar contul finanțat folosește riscul normal', () => {
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES;
  const base = { initial: 10000, dayStartBalance: 10000, openRisk: 0, highestEod: 10000 };
  const at = (balance, phaseTarget) => decide(Object.assign({}, base, { balance, dayStartBalance: balance, phaseTarget }), rules, { riskPct: 2, safety: 0.8, maxOpen: 5, openCount: 0 });
  assert.equal(at(10800, 0.08).reason, 'ȚINTA_ATINSĂ');
  assert.equal(at(10000, 0.08).riskAmount, 200);
  assert.equal(at(9500, 0.08).riskAmount, 100); // −5% ⇒ jumătate
  assert.equal(at(9300, 0.08).riskAmount, 50); // −7% ⇒ un sfert
  assert.equal(at(10750, 0.08).riskAmount, 50); // aproape de țintă: nu riscă mai mult decât lipsește
  assert.equal(at(10900, null).riskAmount, 200); // finanțat: fără plafon de țintă
  assert.equal(decide(Object.assign({}, base, { balance: 10000, phaseTarget: 0.08 }), rules, { riskPct: 2, safety: 0.8, maxOpen: 2, openCount: 2 }).reason, 'PREA_MULTE_POZIȚII');
  // după o zi proastă: întâi doar riscul rămas (20 $), apoi blocare completă
  assert.equal(decide(Object.assign({}, base, { balance: 9620, dayStartBalance: 10000, phaseTarget: 0.08 }), rules, { riskPct: 2, safety: 0.8, maxOpen: 5, openCount: 0 }).riskAmount, 20);
  assert.equal(decide(Object.assign({}, base, { balance: 9600, dayStartBalance: 10000, phaseTarget: 0.08 }), rules, { riskPct: 2, safety: 0.8, maxOpen: 5, openCount: 0 }).reason, 'LIMITA_ZILNICĂ');
});

// ───────────────────────────── Simulatorul de examen ─────────────────────────────

function dailyTrades(n, resultFn, symbols = ['A', 'B']) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (const s of symbols) out.push({ symbol: s, openedAt: T0 + i * DAY, closedAt: T0 + i * DAY + 2 * DAY, resultR: resultFn(i, s) });
  }
  return out;
}

test('examen: câștiguri constante ⇒ trece mereu; pierderi constante ⇒ Gardianul NU lasă contul să pice', () => {
  const rules = PROP_RULES.FTMO_2STEP;
  const opts = { horizonDays: 365, fundedMonths: 3, stepDays: 30, orderSeeds: 2 };
  const win = simulateChallenges(dailyTrades(1200, () => 1), rules, { riskPct: 1, safety: 0.8, maxOpen: 5 }, opts);
  assert.equal(win.passPct, 100);
  assert.equal(win.failPct, 0);
  assert.ok(win.avgPayoutFirstMonths > 0);
  const lose = simulateChallenges(dailyTrades(1200, () => -1), rules, { riskPct: 3, safety: 0.8, maxOpen: 5 }, opts);
  assert.equal(lose.passPct, 0);
  assert.equal(lose.failPct, 0, 'Gardianul trebuie să împiedice încălcarea limitelor');
  assert.ok(lose.expectedValuePerAttempt < 0);
});

test('examen: determinist și independent de ordinea în care primește tranzacțiile', () => {
  const r = rng(7);
  const trades = dailyTrades(900, () => (r() < 0.62 ? 0.6 : -1), ['A', 'B', 'C']);
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES;
  const cfg = { riskPct: 2, safety: 0.8, maxOpen: 3 };
  const opts = { horizonDays: 365, fundedMonths: 2, stepDays: 30, orderSeeds: 3 };
  const a = simulateChallenges(trades, rules, cfg, opts);
  const b = simulateChallenges(trades, rules, cfg, opts);
  const shuffled = trades.slice().reverse();
  const c = simulateChallenges(shuffled, rules, cfg, opts);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(Math.round(a.passPct + a.failPct + a.timeoutPct), 100);
});

test('examen: tranzacție închisă înainte de deschidere nu blochează un loc pentru totdeauna', () => {
  const rules = PROP_RULES.FTMO_2STEP;
  const trades = [
    { symbol: 'A', openedAt: T0 + DAY, closedAt: T0 + DAY, resultR: 1 },
    ...dailyTrades(60, () => 1, ['B']).map((t) => Object.assign(t, { openedAt: t.openedAt + 2 * DAY, closedAt: t.closedAt + 2 * DAY }))
  ];
  const res = runAccount(trades, rules, { riskPct: 1, safety: 0.8, maxOpen: 1 }, { startTs: T0, endTs: T0 + 400 * DAY, target: 0.1 });
  assert.equal(res.outcome, 'PASS');
});

test('examen: contul finanțat pornește cu soldul real (pierderile lunii trecute nu se iartă)', () => {
  const rules = PROP_RULES.FTMO_2STEP;
  const none = runAccount([], rules, { riskPct: 1, safety: 0.8, maxOpen: 5 }, { startTs: T0, endTs: T0 + 30 * DAY, target: null, startBalance: 9200 });
  assert.equal(none.outcome, 'TIMEOUT');
  assert.equal(none.balance, 9200);
  const lose = runAccount([{ symbol: 'A', openedAt: T0 + DAY, closedAt: T0 + 2 * DAY, resultR: -1 }], rules, { riskPct: 1, safety: 0.8, maxOpen: 5 }, { startTs: T0, endTs: T0 + 30 * DAY, target: null, startBalance: 9200 });
  assert.ok(lose.balance < 9200 && lose.balance > 9000, 'riscul e redus lângă limită, dar soldul de start contează');
});

// ───────────────────────────── Calculul lotului ─────────────────────────────

test('loturi: EURUSD, USDJPY, GER40 (EUR→USD), aur; rotunjire în jos și lot minim', () => {
  const prices = { EURUSD: 1.1, USDJPY: 150 };
  assert.equal(quoteToUsd('USD', prices), 1);
  assert.ok(Math.abs(quoteToUsd('JPY', prices) - 1 / 150) < 1e-12);
  assert.equal(quoteToUsd('EUR', prices), 1.1);
  assert.equal(quoteToUsd('XYZ', prices), null);
  assert.equal(lotsFor(INSTR.EURUSD, 100, 0.005, prices).lots, 0.2);
  assert.equal(lotsFor(INSTR.USDJPY, 100, 0.75, prices).lots, 0.2);
  assert.equal(lotsFor(INSTR.GER40, 100, 100, prices).lots, 0.9);
  assert.equal(lotsFor(INSTR.XAUUSD, 100, 20, prices).lots, 0.05);
  const l = lotsFor(INSTR.EURUSD, 333, 0.0071, prices);
  assert.ok(l.actualRiskUsd <= 333 + 1e-9, 'nu riscă niciodată mai mult decât trebuie');
  assert.equal(lotsFor(INSTR.EURUSD, 1, 0.05, prices).reason, 'LOT_SUB_MINIM');
  assert.equal(lotsFor(INSTR.GER40, 100, 100, { USDJPY: 150 }).reason, 'CONVERSIE_LIPSĂ');
});

// ───────────────────────────── Date zilnice ─────────────────────────────

test('date: parserele Yahoo/Stooq, filtrul OHLC invalid și regula lumânării închise', () => {
  const y = ds.parseYahooChart({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2], close: [1.5, 1.5, 3.5] }] } }] } });
  assert.equal(y.length, 2);
  assert.equal(y[0].timestamp, 1000);
  assert.throws(() => ds.parseYahooChart({}), /YAHOO_EMPTY/);
  const s = ds.parseStooqCsv('Date,Open,High,Low,Close\n2026-10-15,1,2,0.5,1.5\n2026-10-16,1.5,2,1,1.8\n');
  assert.equal(s.length, 2);
  assert.equal(s[1].timestamp, Date.UTC(2026, 9, 16));
  assert.throws(() => ds.parseStooqCsv('<html>'), /STOOQ_INVALID/);
  assert.equal(ds.validOhlc([{ open: 1, high: 0.9, low: 0.8, close: 1 }, { open: 1, high: 1.1, low: 0.9, close: 1 }]).length, 1);

  const bar = { timestamp: Date.UTC(2026, 9, 16, 13, 30) }; // US30: sesiunea începe 13:30 UTC
  assert.equal(ds.closedDaily([bar], INSTR.US30, Date.UTC(2026, 9, 16, 19)).length, 0);
  assert.equal(ds.closedDaily([bar], INSTR.US30, Date.UTC(2026, 9, 16, 21)).length, 1);
  const sbar = { timestamp: Date.UTC(2026, 9, 16) }; // Stooq: data la miezul nopții ⇒ închisă după 24h
  assert.equal(ds.closedDaily([sbar], INSTR.US30, Date.UTC(2026, 9, 16, 21), 'stooq').length, 0);
  assert.equal(ds.closedDaily([sbar], INSTR.US30, Date.UTC(2026, 9, 17, 0, 1), 'stooq').length, 1);
  assert.equal(ds.sessionHours(INSTR.EURUSD), 24);
  assert.equal(ds.sessionHours(INSTR.GER40), 9);
});

test('date: cleanSpikes taie doar fitilele absurde, lumânările normale rămân neatinse', () => {
  const bars = randomWalk(60, 5);
  const spiked = bars.map((b) => Object.assign({}, b));
  spiked[30].low = spiked[30].low * 0.5; // vârf fals de −50%
  const out = cleanSpikes(spiked);
  assert.ok(out[30].low > bars[30].low * 0.97);
  for (let i = 0; i < 60; i++) if (i !== 30) assert.deepEqual(out[i], bars[i]);
});

// ───────────────────────────── Ciclul LIVE complet ─────────────────────────────

function liveFixture(snapshotPath = null) {
  const config = loadConfig();
  config.propDesk = Object.assign({}, config.propDesk, { enabled: true, firm: 'THE5ERS_HIGH_STAKES', accountSize: 10000, riskPct: 3, safety: 0.8, maxOpen: 5, symbols: ['EURUSD'], params: { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true } });
  const bus = new MarketStateBus(config, { snapshotPath });
  const msgs = [];
  const notify = async (t) => { msgs.push(t); return { sent: true }; };
  return { config, bus, msgs, notify };
}

const feedOf = (bars) => async () => ({ candles: bars.map((b) => Object.assign({}, b)) });

test('live: pornire tăcută → semnal nou cu lot și stop → mesaj de ieșire cu rezultat; soldul se actualizează', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  const bars = pullbackSeries();
  const tLast = bars[bars.length - 1].timestamp + DAY;
  const env = {};

  // 1) prima rulare: fără semnal, doar mesajul de pornire
  let r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env });
  assert.deepEqual(r.events, []);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /APEX PROP a pornit/);
  assert.equal(bus.state.prop.initialized, true);

  // 2) lumânarea nouă dă semnal LONG
  r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars), now: tLast + 3600e3, env });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].event, 'ENTRY');
  assert.ok(r.events[0].lots >= 0.01);
  assert.ok(r.events[0].riskUsd <= 300 + 1e-6, 'riscul nu depășește 3% din cont');
  assert.match(msgs[1], /SEMNAL PROP: EURUSD/);
  assert.match(msgs[1], /CUMPĂRĂ/);
  assert.match(msgs[1], /Lot: <b>\d+\.\d\d<\/b>/);
  assert.match(msgs[1], /pips<\/b> SUB/);
  assert.match(msgs[1], /Gardian:/);

  // 2b) aceeași lumânare din nou (rulare orară): nimic nou
  r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars), now: tLast + 2 * 3600e3, env });
  assert.deepEqual(r.events, []);
  assert.equal(msgs.length, 2);

  // 3) revenire peste media scurtă ⇒ ieșire TARGET, profit
  const last = bars[bars.length - 1];
  const up = bars.concat([{ timestamp: last.timestamp + DAY, open: last.close, high: last.close + 0.03, low: last.close - 0.001, close: last.close + 0.025, volume: 0 }]);
  r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(up), now: tLast + DAY + 3600e3, env });
  assert.equal(r.events[0].event, 'EXIT');
  assert.ok(r.events[0].r > 0);
  assert.ok(bus.state.prop.balance > 10000);
  assert.match(msgs[2], /ÎNCHIDE ACUM/);
  assert.equal(Object.keys(bus.state.prop.positions).length, 0);
});

test('live: un semnal vechi (sistem oprit) NU e trimis; schimbarea sursei de date nu „închide” poziția', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  const bars = pullbackSeries();
  const tLast = bars[bars.length - 1].timestamp + DAY;
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env: {} });
  const r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars), now: tLast + 48 * 3600e3, env: {} });
  assert.deepEqual(r.events, []);
  assert.equal(msgs.length, 1, 'doar mesajul de pornire');

  // poziție deschisă, apoi aceleași zile cu timestamp-uri decalate (alt furnizor) ⇒ fără ieșire falsă
  const f = liveFixture();
  await runPropCycle({ config: f.config, instruments: INSTR, bus: f.bus, notify: f.notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env: {} });
  await runPropCycle({ config: f.config, instruments: INSTR, bus: f.bus, notify: f.notify, fetch: feedOf(bars), now: tLast + 3600e3, env: {} });
  assert.equal(Object.keys(f.bus.state.prop.positions).length, 1);
  const shifted = bars.map((b) => Object.assign({}, b, { timestamp: b.timestamp + 22 * 3600e3 }));
  const r2 = await runPropCycle({ config: f.config, instruments: INSTR, bus: f.bus, notify: f.notify, fetch: feedOf(shifted), now: tLast + 23 * 3600e3, env: {} });
  assert.deepEqual(r2.events, []);
  assert.equal(Object.keys(f.bus.state.prop.positions).length, 1);
});

test('live: trecerea fazei, PROP_PHASE nu anulează trecerea automată, starea se salvează și se reîncarcă', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-prop-'));
  const snap = path.join(dir, 'state.json');
  const { config, bus, msgs, notify } = liveFixture(snap);
  const bars = pullbackSeries();
  const now = bars[bars.length - 1].timestamp + DAY + 3600e3;
  const env = { PROP_PHASE: '1' };
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now, env });
  const acct = bus.state.prop;
  assert.equal(acct.phase, 0);
  acct.balance = 10850;
  acct.tradingDays = ['a'];
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: now + 3600e3, env });
  assert.equal(acct.phase, 0, 'zile minime neîndeplinite');
  assert.match(msgs[msgs.length - 1], /minim 3 zile/);
  acct.tradingDays = ['a', 'b', 'c'];
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: now + 2 * 3600e3, env });
  assert.equal(acct.phase, 1);
  assert.equal(acct.balance, 10000);
  assert.match(msgs[msgs.length - 1], /Faza 1 din 2 TRECUTĂ/);
  // aceeași variabilă PROP_PHASE=1 la rularea următoare nu te întoarce în faza 1
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: now + 3 * 3600e3, env });
  assert.equal(bus.state.prop.phase, 1);
  // persistență
  const bus2 = new MarketStateBus(config, { snapshotPath: snap });
  assert.equal(bus2.state.prop.phase, 1);
  assert.equal(bus2.state.prop.initialized, true);
  assert.match(propSummary(bus2.state.prop, config), /Faza 2 din 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('live: alertă la încălcarea limitei, o singură dată; un simbol fără date nu blochează pornirea', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  config.propDesk.symbols = ['EURUSD', 'GBPUSD', 'US30'];
  const bars = pullbackSeries();
  const now = bars[bars.length - 1].timestamp + DAY + 3600e3;
  const fetch = async (sym) => { if (sym === 'US30') throw new Error('DATE_INDISPONIBILE'); return { candles: bars.slice(0, -1) }; };
  const r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch, now, env: {} });
  assert.ok(r.errors.US30);
  assert.equal(bus.state.prop.initialized, true);
  bus.state.prop.balance = 8900;
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch, now: now + 3600e3, env: {} });
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch, now: now + 7200e3, env: {} });
  assert.equal(msgs.filter((m) => /limită atinsă/.test(m)).length, 1);
});

test('live: ziua firmei se resetează în fusul ei orar; identitatea pozițiilor', () => {
  const t = Date.UTC(2026, 9, 16, 22, 30); // 01:30 la Atena, 00:30 la Praga, 22:30 UTC
  assert.equal(dayKeyIn(t, 'Europe/Athens'), '2026-10-17');
  assert.equal(dayKeyIn(t, 'UTC'), '2026-10-16');
  assert.ok(samePos({ direction: 'LONG', openedAt: t }, { direction: 'LONG', openedAt: t + 20 * 3600e3 }));
  assert.ok(!samePos({ direction: 'LONG', openedAt: t }, { direction: 'SHORT', openedAt: t }));
  assert.ok(!samePos({ direction: 'LONG', openedAt: t }, { direction: 'LONG', openedAt: t + 3 * DAY }));
  assert.ok(!samePos(null, { direction: 'LONG', openedAt: t }));
  for (const r of Object.values(PROP_RULES)) assert.ok(r.resetTz && dayKeyIn(t, r.resetTz));
});

test('config: crypto dezactivat, departamentul Prop activ cu parametri validi', () => {
  const c = loadConfig();
  assert.equal(c.trendDesk.enabled, false);
  assert.equal(c.propDesk.enabled, true);
  assert.ok(PROP_RULES[c.propDesk.firm]);
  assert.ok(c.propDesk.riskPct > 0 && c.propDesk.riskPct <= 3);
  for (const s of c.propDesk.symbols) assert.ok(INSTR[s], `instrument lipsă: ${s}`);
  for (const [s, i] of Object.entries(INSTR)) {
    if (s.startsWith('_')) continue;
    assert.ok(i.pipSize > 0 && i.contractSize > 0 && i.quoteCurrency && (i.yahoo || i.stooq), s);
    assert.ok(quoteToUsd(i.quoteCurrency, { EURUSD: 1.1, USDJPY: 150, GBPUSD: 1.3, USDCAD: 1.35, USDCHF: 0.9, AUDUSD: 0.65, NZDUSD: 0.6 }) > 0, s);
  }
});

test('config: un departament oprit de utilizator rămâne oprit chiar dacă cercetarea îl validează', () => {
  const fsx = require('fs');
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'apex-cfg-'));
  const base = path.join(dir, 'base.json'), prom = path.join(dir, 'prom.json');
  fsx.writeFileSync(base, JSON.stringify({ userDisabledDesks: ['trendDesk'], trendDesk: { enabled: false }, propDesk: { enabled: false } }));
  fsx.writeFileSync(prom, JSON.stringify({ trend: { validatedOOS: true, overrides: { trendDesk: { enabled: true } } }, prop: { validatedOOS: true, overrides: { propDesk: { enabled: true } } } }));
  const c = loadConfig({ basePath: base, promotionsPath: prom });
  assert.equal(c.trendDesk.enabled, false);
  assert.equal(c.propDesk.enabled, true);
  fsx.rmSync(dir, { recursive: true, force: true });
});
