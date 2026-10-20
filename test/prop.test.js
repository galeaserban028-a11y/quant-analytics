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
const { runPropCycle, propSummary, dayKeyIn, samePos, shouldFetch, deskStrategies } = require('../src/propLive');
const lab = require('../src/strategies/dailyLab');
const { chooseRisk, pickBest, rankFirms, STRATEGIES } = require('../src/research/propRun');
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
  // ținta atinsă, dar lipsesc zile minime: doar poziții minuscule
  const days = decide(Object.assign({}, base, { balance: 10850, dayStartBalance: 10850, phaseTarget: 0.08, tradingDays: 1 }), rules, { riskPct: 2, safety: 0.8, maxOpen: 5, openCount: 0 });
  assert.equal(days.reason, 'ZILE_MINIME');
  assert.equal(days.riskAmount, 25);
  assert.equal(decide(Object.assign({}, base, { balance: 10850, dayStartBalance: 10850, phaseTarget: 0.08, tradingDays: 3 }), rules, { riskPct: 2, safety: 0.8, maxOpen: 5, openCount: 0 }).reason, 'ȚINTA_ATINSĂ');
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
  const sbar = { timestamp: Date.UTC(2026, 9, 16) }; // Stooq: data la miezul nopții UTC ⇒ ziua bursei = data UTC
  assert.equal(ds.closedDaily([sbar], INSTR.US30, Date.UTC(2026, 9, 16, 20, 5), 'stooq').length, 0);
  assert.equal(ds.closedDaily([sbar], INSTR.US30, Date.UTC(2026, 9, 16, 20, 15), 'stooq').length, 0, 'încă în cele 20 de minute de așteptare');
  assert.equal(ds.closedDaily([sbar], INSTR.US30, Date.UTC(2026, 9, 16, 20, 25), 'stooq').length, 1);
  // instrument fără program de bursă (Forex): regula de 24h pentru Stooq
  assert.equal(ds.closedDaily([sbar], INSTR.EURUSD, Date.UTC(2026, 9, 16, 21), 'stooq').length, 0);
  assert.equal(ds.closedDaily([sbar], INSTR.EURUSD, Date.UTC(2026, 9, 17, 0, 1), 'stooq').length, 1);
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
  config.propDesk = Object.assign({}, config.propDesk, { enabled: true, firm: 'THE5ERS_HIGH_STAKES', accountSize: 10000, riskPct: 3, safety: 0.8, maxOpen: 5, symbols: ['EURUSD'],
    strategies: [{ kind: 'rsi2', name: 'Pullback RSI(2)', params: { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true } }] });
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
  assert.match(msgs[1], /Presupus: 1 lot = 10\.00 \$ pe pip/, 'mesajul arată valoarea pip-ului, de verificat în platformă');

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

test('config: crypto oprit; indicii activi; Academia Forex pornește doar validată', () => {
  const c = loadConfig();
  assert.equal(c.trendDesk.enabled, false);
  assert.equal(c.propDesk.enabled, true, 'indicii trimit semnale reale');
  assert.ok(!c.userDisabledDesks.includes('propDesk'));
  assert.equal(c.fxDesk.enabled, false, 'Academia Forex: fără avantaj dovedit ⇒ oprită');
  assert.ok(PROP_RULES[c.propDesk.firm]);
  assert.ok(c.propDesk.riskPct > 0 && c.propDesk.riskPct <= 4);
  assert.ok(Array.isArray(c.propDesk.strategies) && c.propDesk.strategies.length >= 1);
  for (const st of c.propDesk.strategies) assert.ok(['rsi2', 'down', 'bb', 'd7'].includes(st.kind), st.kind);
  for (const s of c.propDesk.symbols) assert.equal(INSTR[s].category, 'INDEX', `doar indici: ${s}`);
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


// ───────────────────────────── Laboratorul de strategii (v2: indici, 2 strategii) ─────────────────────────────

test('laborator: strategia rsi2 din laborator dă EXACT aceleași tranzacții ca Pullback-ul original', () => {
  const p = { trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true };
  for (const seed of [4, 5]) {
    const bars = randomWalk(1200, seed, { drift: 0.0002 });
    assert.deepEqual(lab.simulateBars('X', bars, INSTR.US30, Object.assign({ kind: 'rsi2' }, p)).map((t) => [t.openedAt, t.closedAt, t.resultR, t.outcome]),
      mr.simulateBars('X', bars, INSTR.US30, p).map((t) => [t.openedAt, t.closedAt, t.resultR, t.outcome]));
  }
});

test('laborator: fără look-ahead pentru TOATE strategiile, la închidere și a doua zi la deschidere', () => {
  const kinds = [
    { kind: 'rsi2', trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true },
    { kind: 'down', trendLen: 100, nDays: 3, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true },
    { kind: 'ibs', trendLen: 0, ibsEntry: 0.2, stopAtr: 2, maxDays: 5, allowShort: true },
    { kind: 'd7', trendLen: 100, lookback: 7, stopAtr: 2, maxDays: 10, allowShort: true },
    { kind: 'tom', trendLen: 0, entryDaysBefore: 1, exitDay: 3, stopAtr: 3, maxDays: 12 }
  ];
  const bars = randomWalk(1000, 21, { drift: 0.0002 });
  for (const p of kinds) {
    for (const execution of ['close', 'nextOpen']) {
      const full = lab.simulateBars('X', bars, INSTR.US30, p, { execution });
      const part = lab.simulateBars('X', bars.slice(0, 600), INSTR.US30, p, { execution }).filter((t) => t.outcome !== 'END_OF_DATA');
      assert.ok(part.length > 3, `${p.kind}: prea puține tranzacții`);
      assert.deepEqual(part, full.slice(0, part.length), `${p.kind}/${execution}`);
    }
  }
});

test('laborator: execuția „a doua zi” intră la deschiderea zilei următoare, nu la închiderea semnalului', () => {
  const bars = pullbackSeries();
  const last = bars[bars.length - 1];
  bars.push({ timestamp: last.timestamp + DAY, open: last.close + 0.004, high: last.close + 0.03, low: last.close + 0.002, close: last.close + 0.025, volume: 0 });
  bars.push({ timestamp: last.timestamp + 2 * DAY, open: last.close + 0.026, high: last.close + 0.03, low: last.close + 0.02, close: last.close + 0.027, volume: 0 });
  const p = { kind: 'rsi2', trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10 };
  const atClose = lab.simulateBars('X', bars, INSTR.US30, p)[0];
  const nextOpen = lab.simulateBars('X', bars, INSTR.US30, p, { execution: 'nextOpen' })[0];
  assert.equal(atClose.entry, last.close + INSTR.US30.typicalSpreadPips * INSTR.US30.pipSize);
  assert.equal(nextOpen.entry, last.close + 0.004 + INSTR.US30.typicalSpreadPips * INSTR.US30.pipSize);
  assert.equal(nextOpen.openedAt, last.timestamp + DAY);
  assert.ok(nextOpen.resultR < atClose.resultR, 'intrarea întârziată e mai scumpă aici');
});

test('laborator: calendarul de sfârșit de lună (zile lucrătoare rămase)', () => {
  assert.equal(lab.weekdaysLeftInMonth(Date.UTC(2026, 9, 30)), 0); // vineri 30 oct → sâmbătă/duminică/luni e noiembrie? 31 e sâmbătă
  assert.equal(lab.weekdaysLeftInMonth(Date.UTC(2026, 9, 29)), 1);
  assert.equal(lab.weekdaysLeftInMonth(Date.UTC(2026, 8, 30)), 0);
  assert.throws(() => lab.simulateBars('X', randomWalk(300, 1), INSTR.US30, { kind: 'nimic' }), /STRATEGIE_NECUNOSCUTĂ/);
});

test('date: ora oficială de închidere, cu ora de vară, pentru fiecare bursă', () => {
  const iso = (t) => new Date(t).toISOString().slice(0, 16);
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 6, 15, 13, 30), INSTR.US30)), '2026-07-15T20:00');
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 0, 15, 14, 30), INSTR.US30)), '2026-01-15T21:00');
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 6, 15, 7, 0), INSTR.GER40)), '2026-07-15T15:30');
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 0, 15, 8, 0), INSTR.GER40)), '2026-01-15T16:30');
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 6, 15, 7, 0), INSTR.UK100)), '2026-07-15T15:30');
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 6, 15, 0, 0), INSTR.JP225)), '2026-07-15T06:30');
  // Sydney: lumânarea de 16 oct are timestamp 15 oct 23:00 UTC (10:00 ora locală)
  assert.equal(iso(ds.sessionCloseUtc(Date.UTC(2026, 9, 15, 23, 0), INSTR.AUS200)), '2026-10-16T05:12');
  for (const [s, i] of Object.entries(INSTR)) if (i && i.category === 'INDEX') assert.ok(i.closeTz && /^\d\d:\d\d$/.test(i.closeTime), s);
});

test('live: descarcă date doar după închiderea bursei sau o dată pe oră (rulare din 5 în 5 minute)', () => {
  const acct = { lastFetch: {}, lastBarClose: {} };
  const close = Date.UTC(2026, 9, 16, 20, 0); // US30, 16 oct (ora de vară NY)
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close), true, 'prima dată mereu');
  acct.lastFetch.US30 = close - 5 * 60e3;
  acct.lastBarClose.US30 = close - DAY;
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 5 * 60e3), false, 'înainte de +20 minute');
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 12 * 60e3), false, 'prețul de închidere încă se poate corecta');
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 22 * 60e3), true, 'lumânarea nouă e gata');
  acct.lastFetch.US30 = close + 12 * 60e3;
  acct.lastBarClose.US30 = close;
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 27 * 60e3), false, 'deja procesată');
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 70 * 60e3), true, 'verificarea orară');
  acct.lastBarClose.US30 = close - DAY; // Yahoo încă nu a actualizat: mai încercăm la fiecare rulare în fereastră
  acct.lastFetch.US30 = close + 12 * 60e3;
  assert.equal(shouldFetch(acct, 'US30', INSTR.US30, close + 27 * 60e3), true);
});

test('live: două strategii pe același indice → două poziții separate, lot GER40 cu conversie EUR→USD', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  config.propDesk.symbols = ['GER40'];
  config.propDesk.strategies = [
    { kind: 'rsi2', name: 'Pullback RSI(2)', params: { trendLen: 200, entryRsi: 2, exitLen: 3, stopAtr: 2, maxDays: 10 } }, // RSI ≈ 9 → 3 → 1,4: pragul 2 se atinge abia în ziua 3
    { kind: 'down', name: '3 zile de scădere', params: { trendLen: 200, nDays: 3, exitLen: 3, stopAtr: 2, maxDays: 10 } }
  ];
  // trend ascendent, apoi 3 zile de scădere (declanșează ambele strategii); prețuri ca la DAX
  const base = pullbackSeries().map((b) => ({ timestamp: b.timestamp + 7 * 3600e3, open: b.open * 15000, high: b.high * 15000, low: b.low * 15000, close: b.close * 15000, volume: 0 }));
  const lastB = base[base.length - 1];
  const third = { timestamp: lastB.timestamp + DAY, open: lastB.close, high: lastB.close + 10, low: lastB.close - 160, close: lastB.close - 150, volume: 0 };
  const bars = base.concat([third]);
  const eur = Array.from({ length: 5 }, (_, k) => ({ timestamp: T0 + k * DAY, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 0 }));
  const fetch = async (sym, inst, n) => (sym === 'EURUSD' ? { candles: eur } : { candles: (fetch.n || bars).map((b) => Object.assign({}, b)) });
  fetch.n = bars.slice(0, -2);
  const closeLast = ds.sessionCloseUtc(third.timestamp, INSTR.GER40);
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch, now: closeLast - 2 * DAY + 20 * 60e3, env: {} });
  assert.equal(bus.state.prop.initialized, true);
  fetch.n = bars;
  const r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch, now: closeLast + 15 * 60e3, env: {} });
  const entries = r.events.filter((e) => e.event === 'ENTRY');
  assert.equal(entries.length, 2, JSON.stringify(r.events));
  assert.deepEqual(Object.keys(bus.state.prop.positions).sort(), ['GER40|down', 'GER40|rsi2']);
  const sig = msgs.filter((m) => /SEMNAL PROP: GER40/.test(m));
  assert.equal(sig.length, 1, 'doi traderi pe același indice deodată ⇒ UN singur semnal');
  assert.ok(/2 traderi de acord: .*Tudor \(3 zile de scădere\)/.test(sig[0]), sig[0]);
  const lots = Object.values(bus.state.prop.positions).reduce((t, p) => t + p.lots, 0);
  assert.ok(sig[0].includes(`Lot TOTAL: <b>${lots.toFixed(2)}</b>`) || /poziții separate/.test(sig[0]), sig[0]);
  assert.ok(/puncte<\/b> SUB/.test(sig[0]));
  const totalRisk = Object.values(bus.state.prop.positions).reduce((s, p) => s + p.riskUsd, 0);
  assert.ok(totalRisk <= 10000 * 0.05 * 0.8 + 1e-6, 'Gardianul împarte bugetul zilnic între poziții');
  assert.equal(bus.state.prop.fxRates.EURUSD, 1.1);
});

test('cercetare: alegerea riscului respectă pragul de 5% șanse de a pica; strategiile candidate sunt definite', () => {
  const r = rng(3);
  const trades = dailyTrades(900, () => (r() < 0.6 ? 0.8 : -1), ['A', 'B', 'C']);
  const { best, table } = chooseRisk(trades, PROP_RULES.THE5ERS_HIGH_STAKES, { risks: [2, 6], safeties: [0.7, 0.95], maxOpens: [3], orderSeeds: 2 });
  assert.ok(table.length === 4);
  if (table.some((x) => x.failPct <= 5)) assert.ok(best.failPct <= 5);
  assert.deepEqual(Object.keys(STRATEGIES).sort(), ['bb', 'd7', 'down', 'rsi2']);
  for (const st of Object.values(STRATEGIES)) assert.ok(st.grid.length >= 16 && st.grid.every((p) => p.stopAtr > 0));
  assert.equal(deskStrategies({ params: { trendLen: 200 } })[0].kind, 'rsi2', 'compatibil cu configurația veche');
});

test('cercetare: nu alege niciodată o variantă cu peste 5% șanse de a pica, chiar dacă are valoare așteptată mai mare', () => {
  const t = [{ riskPct: 6, failPct: 12, expectedValuePerAttempt: 900 }, { riskPct: 3, failPct: 4, expectedValuePerAttempt: 300 }, { riskPct: 2, failPct: 1, expectedValuePerAttempt: 200 }];
  assert.equal(pickBest(t).riskPct, 3);
  assert.equal(pickBest([{ riskPct: 6, failPct: 12, expectedValuePerAttempt: 900 }, { riskPct: 5, failPct: 9, expectedValuePerAttempt: 950 }]).riskPct, 5, 'fără variante sigure: cea mai bună dintre toate');
});

test('cercetare: la valoare practic egală (≤5% diferență) alege varianta la care treci mai repede; nu sacrifică valoare mare pentru viteză', () => {
  const t = [
    { riskPct: 2, failPct: 4, expectedValuePerAttempt: 383, passWithin365Pct: 27, passWithin180Pct: 14 },
    { riskPct: 3, failPct: 3.7, expectedValuePerAttempt: 376, passWithin365Pct: 31, passWithin180Pct: 17 },
    { riskPct: 4, failPct: 4.8, expectedValuePerAttempt: 340, passWithin365Pct: 33, passWithin180Pct: 19 },
    { riskPct: 5, failPct: 7, expectedValuePerAttempt: 390, passWithin365Pct: 40, passWithin180Pct: 25 }
  ];
  assert.equal(pickBest(t).riskPct, 3, 'risc 3%: aproape aceeași valoare, mai rapid; 4% pierde prea multă valoare; 5% pică prea des');
  assert.equal(pickBest(t, 5, 0).riskPct, 2, 'fără toleranță: strict cea mai bună valoare');
});

test('laborator: „3 zile de scădere” cere scăderi stricte; zile egale nu declanșează', () => {
  const up = Array.from({ length: 260 }, (_, i) => ({ timestamp: T0 + i * DAY, open: 100 + i * 0.1, high: 100.5 + i * 0.1, low: 99.5 + i * 0.1, close: 100 + i * 0.1, volume: 0 }));
  const mk = (closes) => up.concat(closes.map((c, k) => ({ timestamp: T0 + (260 + k) * DAY, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 0 })));
  const p = { kind: 'down', trendLen: 200, nDays: 3, exitLen: 3, stopAtr: 3, maxDays: 10 };
  const last = up[up.length - 1].close;
  assert.ok(lab.liveState('X', mk([last - 0.3, last - 0.6, last - 0.9]), INSTR.US30, p).position, 'trei scăderi ⇒ semnal');
  assert.equal(lab.liveState('X', mk([last - 0.3, last - 0.3, last - 0.6]), INSTR.US30, p).position, null, 'o zi egală ⇒ fără semnal');
});

test('laborator: Pullback iese când închiderea trece de media scurtă de AZI (inclusiv ziua curentă)', () => {
  // după intrare, ziua următoare închide peste media pe 3 zile calculată cu ea inclusă, dar sub media de ieri
  const bars = pullbackSeries();
  const L = bars[bars.length - 1].close; // ultimele închideri: L+0.02 (ziua 0), L+0.01, L
  const p = { kind: 'rsi2', trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 4, maxDays: 10 };
  // SMA3 azi cu x: (L+0.01 + L + x)/3 < x ⇔ x > L+0.005; SMA3 de ieri = L+0.01 ⇒ x = L+0.007 iese doar cu media de azi
  const x = L + 0.007;
  const nb = bars.concat([{ timestamp: bars[bars.length - 1].timestamp + DAY, open: L, high: x + 0.0005, low: L - 0.0005, close: x, volume: 0 }]);
  const st = lab.liveState('X', nb, INSTR.EURUSD, p);
  assert.equal(st.position, null);
  assert.equal(st.lastClosed.outcome, 'TARGET');
});

test('live: un semnal început cu o zi înainte (ratat) nu e trimis ca intrare nouă', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  const bars = pullbackSeries(); // semnal pe ultima lumânare
  const last = bars[bars.length - 1];
  // ziua următoare: tot sub media scurtă (poziția rămâne deschisă), fără stop
  const more = bars.concat([{ timestamp: last.timestamp + DAY, open: last.close, high: last.close + 0.001, low: last.close - 0.002, close: last.close - 0.001, volume: 0 }]);
  const tMore = more[more.length - 1].timestamp + DAY;
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tMore - 2 * DAY + 3600e3, env: {} });
  // sistemul „a dormit” peste ziua semnalului și vede direct ziua următoare
  const r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(more), now: tMore + 3600e3, env: {} });
  assert.deepEqual(r.events, []);
  assert.equal(msgs.length, 1, 'doar mesajul de pornire');
  assert.equal(Object.keys(bus.state.prop.positions).length, 0);
});

test('stare: nu rescrie fișierul dacă nimic nu s-a schimbat (rulare din 5 în 5 minute fără commit-uri inutile)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-snap-'));
  const snap = path.join(dir, 'state.json');
  const clock = { t: Date.UTC(2026, 9, 18, 12) };
  const bus = new MarketStateBus(loadConfig(), { snapshotPath: snap, clock: () => clock.t });
  bus.state.prop = { v: 2, balance: 10000 };
  bus.saveSnapshot();
  const first = fs.readFileSync(snap, 'utf8');
  clock.t += 5 * 60e3;
  bus.saveSnapshot();
  assert.equal(fs.readFileSync(snap, 'utf8'), first, 'doar ora s-ar fi schimbat');
  bus.state.prop.balance = 10100;
  bus.saveSnapshot();
  assert.notEqual(fs.readFileSync(snap, 'utf8'), first);
  assert.equal(JSON.parse(fs.readFileSync(snap, 'utf8')).prop.balance, 10100);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────────────────────── Echipa și scenariile ─────────────────────────────
const team = require('../src/research/team');
const scen = require('../src/research/scenario');

test('echipa: 40 de traderi cu nume unice, câte unul pe fiecare indice și strategie; 5 oameni în personal', () => {
  const names = Object.values(team.NAMES).flatMap((m) => Object.values(m));
  assert.equal(names.length, 40);
  assert.equal(new Set(names).size, 40);
  for (const s of team.STAFF) assert.ok(!names.includes(s.name), `${s.name} e și trader, și personal`);
  for (const kind of ['rsi2', 'down', 'bb', 'd7']) for (const [s, i] of Object.entries(INSTR)) if (i && i.category === 'INDEX') assert.ok(team.NAMES[kind][s], `${kind}/${s} fără nume`);
  assert.equal(team.nameFor('down', 'GER40'), 'Tudor');
  assert.equal(team.STAFF.length, 5);
});

test('echipa: regula băncii — doar pierderi clare (sub −0,05R) și cu destule tranzacții', () => {
  const tr = (n, r) => Array.from({ length: n }, (_, k) => ({ resultR: r, openedAt: k, closedAt: k + 1 }));
  assert.equal(team.benchDecision(tr(12, -0.2)).benched, true);
  assert.equal(team.benchDecision(tr(12, -0.04)).benched, false, 'sub prag: lucrează');
  assert.equal(team.benchDecision(tr(5, -1)).benched, false, 'prea puține tranzacții pentru o judecată');
  assert.equal(team.benchDecision([]).benched, false);
});

test('echipa: walk-forward fără look-ahead — banca se decide doar din trecut; tranzacțiile celor de pe bancă nu intră', () => {
  // indice „bun” (trend cu scăderi) și indice „rău” (scade)
  const good = randomWalk(2200, 31, { drift: 0.0006, start: 100 });
  const bad = randomWalk(2200, 32, { drift: -0.0006, start: 100 });
  const data = { US30: good, GER40: bad };
  const strategies = { rsi2: { name: 'Pullback RSI(2)', grid: [{ kind: 'rsi2', trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true }] } };
  // GER40 pierde mereu (rezultat forțat), deci trebuie să stea pe bancă în fiecare an după primul antrenament
  const sim = (d, i, p, o) => lab.simulate(d, i, p, o).map((t) => (t.symbol === 'GER40' ? Object.assign({}, t, { resultR: -0.5 }) : Object.assign({}, t, { resultR: Math.abs(t.resultR) + 0.1 })));
  const r = team.teamWalkForward(data, INSTR, strategies, sim, { trainYears: 2, minTrades: 5 });
  const S = r.byStrategy.rsi2;
  assert.ok(S.folds.length >= 3);
  assert.ok(S.folds.every((f) => f.benched.includes('GER40')), 'GER40 pe bancă în fiecare an');
  assert.ok(!S.oos.some((t) => t.symbol === 'GER40'), 'tranzacțiile celor de pe bancă nu intră');
  assert.ok(S.oos.some((t) => t.symbol === 'US30'));
  assert.equal(r.agents.find((a) => a.symbol === 'GER40').status, 'BANCĂ');
  for (const f of S.folds) {
    const inOos = S.oos.filter((t) => t.openedAt >= Date.parse(f.testFrom) && t.openedAt < Date.parse(f.testTo) + DAY);
    for (const sym of f.benched) assert.ok(!inOos.some((t) => t.symbol === sym), `${sym} era pe bancă în ${f.testFrom}`);
  }
  assert.equal(r.agents.length, 2);
  assert.ok(r.agents.every((a) => ['LUCREAZĂ', 'BANCĂ'].includes(a.status) && a.record && a.why));
});

test('scenariu: luna și drumul pe 12 luni sunt coerente (procente care însumează 100, plăți doar după finanțare)', () => {
  const r = rng(11);
  const trades = dailyTrades(1500, () => (r() < 0.62 ? 0.7 : -1), ['A', 'B']);
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES;
  const cfg = { riskPct: 3, safety: 0.7, maxOpen: 3 };
  const m = scen.monthDistribution(trades, rules, cfg, { target: 0.08, stepDays: 30 });
  assert.ok(m.months > 10 && m.p10 <= m.p25 && m.p25 <= m.median && m.median <= m.p75 && m.p75 <= m.p90);
  assert.ok(m.positivePct >= 0 && m.positivePct <= 100);
  const j = scen.journey(trades, rules, cfg, { months: 12, stepDays: 30, fee: 95 });
  for (const x of j.byMonth) {
    const sum = x.phase1Pct + x.phase2Pct + x.fundedPct + x.failedPct + x.lostFundedPct;
    assert.ok(Math.abs(sum - 100) < 0.6, `luna ${x.month}: ${sum}`);
    if (x.fundedPct === 0 && x.lostFundedPct === 0) assert.equal(x.cumPayoutAvg, 0, 'plăți fără cont finanțat');
  }
  for (let i = 1; i < j.byMonth.length; i++) assert.ok(j.byMonth[i].cumPayoutAvg >= j.byMonth[i - 1].cumPayoutAvg, 'încasările cumulate nu scad');
  assert.ok(j.byMonth[0].phase1Pct >= j.byMonth[11].phase1Pct);
});

test('live: un trader de pe bancă nu deschide poziții; numele lui apare în mesajele celorlalți', async () => {
  const { config, bus, msgs, notify } = liveFixture();
  config.propDesk.benched = ['EURUSD|rsi2'];
  const bars = pullbackSeries();
  const tLast = bars[bars.length - 1].timestamp + DAY;
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env: {} });
  const r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars), now: tLast + 3600e3, env: {} });
  assert.deepEqual(r.events.map((e) => e.reason), ['BANCĂ']);
  assert.equal(Object.keys(bus.state.prop.positions).length, 0);
  assert.equal(msgs.length, 1);
});

test('scenariu: contul finanțat pierdut printr-un gap apare separat; plățile nu numără același profit de două ori', () => {
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES;
  const cfg = { riskPct: 3, safety: 0.7, maxOpen: 1 };
  // câștiguri constante: plata lunară trebuie să rămână aproximativ constantă (nu să crească de la lună la lună)
  const wins = dailyTrades(700, () => 1, ['A']);
  const j = scen.journey(wins, rules, cfg, { months: 12, stepDays: 60 });
  const inc = j.byMonth.map((x, i) => x.cumPayoutAvg - (i ? j.byMonth[i - 1].cumPayoutAvg : 0));
  const paid = inc.filter((v) => v > 0);
  assert.ok(paid.length >= 3);
  assert.ok(Math.max(...paid) <= Math.min(...paid.slice(1)) * 1.5 + 50, `plăți în creștere: ${paid.join(', ')}`);
  // după ~4 luni de câștiguri, un gap de −6R pe zi: contul finanțat se pierde
  const gap = dailyTrades(700, (i) => (i < 120 ? 1 : -6), ['A']);
  const g = scen.journey(gap, rules, { riskPct: 3, safety: 0.9, maxOpen: 1 }, { months: 12, stepDays: 400 });
  assert.ok(g.byMonth.some((x) => x.lostFundedPct > 0), JSON.stringify(g.byMonth.map((x) => [x.fundedPct, x.lostFundedPct, x.failedPct])));
});

test('examen: ținta atinsă în mai puține zile decât minimul firmei nu blochează contul (bug găsit)', () => {
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES; // minim 3 zile
  const wins = dailyTrades(400, () => 1, ['A']);
  const a = runAccount(wins, rules, { riskPct: 3, safety: 0.7, maxOpen: 1 }, { startTs: T0, endTs: T0 + 300 * DAY, target: 0.05 });
  assert.equal(a.outcome, 'PASS');
  assert.ok(a.tradingDays >= rules.minDays);
  const r = simulateChallenges(wins, rules, { riskPct: 3, safety: 0.7, maxOpen: 1 }, { horizonDays: 200, fundedMonths: 2, stepDays: 30, orderSeeds: 1 });
  assert.equal(r.passPct, 100);
});

test('cercetare: la valoare așteptată practic egală, câștigă firma la care treci mai repede', () => {
  const a = { key: 'A', expectedValuePerAttempt: 381, passWithin180Pct: 12, failPct: 3.2 };
  const b = { key: 'B', expectedValuePerAttempt: 377, passWithin180Pct: 12.5, failPct: 3.2 };
  const c = { key: 'C', expectedValuePerAttempt: 250, passWithin180Pct: 20, failPct: 1 };
  assert.deepEqual([a, b, c].sort(rankFirms).map((x) => x.key), ['B', 'A', 'C']);
});

test('frâna de urgență: se declanșează doar la rezultate live clar sub teste sau la 15 pierderi la rând', () => {
  const { breakerCheck } = require('../src/propLive');
  const h = (rs) => rs.map((r) => ({ r }));
  assert.equal(breakerCheck(h([0.5, -1, 0.4, 0.6, -1, 0.3])), null, 'puține tranzacții: nicio judecată');
  const normal = []; for (let i = 0; i < 40; i++) normal.push(i % 3 === 0 ? -1 : 0.55);
  assert.equal(breakerCheck(h(normal)), null, 'rezultate ca în teste: merge mai departe');
  const bad = []; for (let i = 0; i < 30; i++) bad.push(i % 5 === 0 ? 0.4 : -1);
  assert.match(breakerCheck(h(bad)), /mult sub/);
  assert.match(breakerCheck(h(Array(15).fill(-0.8))), /15 pierderi la rând/);
  assert.equal(breakerCheck(h(Array(14).fill(-0.2).concat([0.5]))), null);
});

test('live: frâna oprește intrările noi, PROP_RESUME le reia; mesajul arată valoarea punctului; PROP_CONTRACT_SIZES o corectează', async () => {
  const { applyContractSizes } = require('../src/propLive');
  const fixed = applyContractSizes(INSTR, 'JP225=100, GER40=1, XXX=5, US30=abc');
  assert.equal(fixed.JP225.contractSize, 100);
  assert.equal(fixed.US30.contractSize, INSTR.US30.contractSize, 'valorile invalide se ignoră');
  assert.equal(INSTR.JP225.contractSize, 1, 'configul original nu se modifică');

  const { config, bus, msgs, notify } = liveFixture();
  const bars = pullbackSeries();
  const tLast = bars[bars.length - 1].timestamp + DAY;
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env: {} });
  // istoric live prost ⇒ frână
  bus.state.prop.history = Array.from({ length: 16 }, () => ({ r: -1 }));
  await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars.slice(0, -1)), now: tLast - DAY + 2 * 3600e3, env: {} });
  assert.ok(bus.state.prop.paused);
  assert.match(msgs[msgs.length - 1], /FRÂNĂ DE URGENȚĂ/);
  let r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(bars), now: tLast + 3600e3, env: {} });
  assert.deepEqual(r.events.map((e) => e.reason), ['PAUZĂ']);
  // reluare: evaluarea reîncepe de la zero; semnalul următor (zi nouă) trece
  const L = bars[bars.length - 1];
  const more = bars.concat([{ timestamp: L.timestamp + DAY, open: L.close, high: L.close + 0.001, low: L.close - 0.011, close: L.close - 0.01, volume: 0 }]);
  bus.state.prop.skipped = {};
  r = await runPropCycle({ config, instruments: INSTR, bus, notify, fetch: feedOf(more), now: tLast + DAY + 3600e3, env: { PROP_RESUME: '2026-10-20' } });
  assert.equal(bus.state.prop.paused, null);
  assert.ok(msgs.some((m) => /reluat/.test(m)));
  const entry = msgs.find((m) => /SEMNAL PROP/.test(m));
  if (entry) assert.match(entry, /Presupus: 1 lot = 10\.00 \$ pe pip/, 'EURUSD: 100.000 × 0,0001 = 10 $ pe pip');
});

test('live: ieșirea unui singur trader dintr-un indice ocupat de doi spune exact ce lot închizi și ce rămâne', async () => {
  const { flushSymbol } = require('../src/propLive');
  const msgs = [];
  const acct = { initial: 10000, balance: 10050, dayStart: 10000, highestEod: 10000, phase: 0, tradingDays: ['x'], positions: { 'GER40|down': { lots: 0.4, who: 'Tudor (3 zile de scădere)', riskUsd: 150 } } };
  const rules = PROP_RULES.THE5ERS_HIGH_STAKES;
  await flushSymbol({ sym: 'GER40', inst: INSTR.GER40, acct, rules, label: 'APEX PROP', barClose: Date.UTC(2026, 0, 5, 16, 30), outEntries: [], notify: async (t) => { msgs.push(t); },
    outExits: [{ who: 'Radu (Pullback RSI(2))', prev: { direction: 'LONG', lots: 0.35 }, r: 0.4, pnl: 60, why: 'prețul a revenit', outcome: 'EXIT' }] });
  assert.equal(msgs.length, 1);
  assert.ok(/ÎNCHIDE 0\.35 loturi/.test(msgs[0]), msgs[0]);
  assert.ok(/Rămâne deschis pe GER40: 0\.40 loturi \(Tudor\)/.test(msgs[0]), msgs[0]);
  msgs.length = 0;
  await flushSymbol({ sym: 'GER40', inst: INSTR.GER40, acct: Object.assign({}, acct, { positions: {} }), rules, label: 'APEX PROP', barClose: 0, outEntries: [], notify: async (t) => { msgs.push(t); },
    outExits: [{ who: 'Radu (Pullback RSI(2))', prev: { direction: 'LONG', lots: 0.35 }, r: -1, pnl: -150, why: 'stop-ul a fost atins', outcome: 'STOP' }] });
  assert.ok(!/ÎNCHIDE/.test(msgs[0]) && /Nu faci nimic/.test(msgs[0]), 'la stop nu ai nimic de închis');
});
