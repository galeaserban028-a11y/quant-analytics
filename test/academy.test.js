'use strict';

/** Teste pentru Academia Forex: ADN, viața agenților, controlul pe prețuri aleatoare, ciclul live Forex. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { FAMILIES, randomGenome, mutate, genomeKey, makeNamer, describe } = require('../src/academy/genome');
const { runAcademy, rankOf, shouldRetire, forwardStats, RULES } = require('../src/academy/life');
const lab = require('../src/strategies/dailyLab');
const { rng } = require('../src/backtest/metrics');
const { hoursToUtcDays, eliteToDesk, runFxCycle } = require('../src/fxLive');
const { loadDk } = require('../src/research/academyRun');
const MarketStateBus = require('../src/core/MarketStateBus');
const { loadConfig } = require('../src/config');
const INSTR = require('../config/forex_instruments.json');

const DAY = 864e5;
const T0 = Date.UTC(2003, 0, 1);
const PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD', 'EURGBP', 'NZDUSD'];

function walk(n, seed, drift = 0) {
  const r = rng(seed);
  const out = [];
  let px = 1.2;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = o * (1 + drift + 0.006 * (r() + r() + r() - 1.5) * 1.4);
    out.push({ timestamp: T0 + i * DAY, open: o, high: Math.max(o, c) * (1 + 0.002 * r()), low: Math.min(o, c) * (1 - 0.002 * r()), close: c, volume: 0 });
    px = c;
  }
  return out;
}
const universe = (n, base) => Object.fromEntries(PAIRS.map((p, k) => [p, walk(n, base + k)]));
const sim = (d, i, p, o) => lab.simulate(d, i, p, Object.assign({}, o, { execution: 'nextOpen' }));

test('ADN: genomuri valide, mutații mici în spațiul permis, nume unice pentru 300 de agenți', () => {
  const r = rng(1);
  for (let i = 0; i < 500; i++) {
    const g = randomGenome(r, PAIRS);
    assert.ok(FAMILIES[g.family] && PAIRS.includes(g.pair));
    for (const [k, vals] of Object.entries(FAMILIES[g.family].space)) assert.ok(vals.includes(g.params[k]), `${g.family}.${k}=${g.params[k]}`);
    if (g.family === 'macross') assert.ok(g.params.fast < g.params.slow);
    const c = mutate(g, r, PAIRS);
    assert.equal(c.family, g.family);
    assert.notEqual(genomeKey(c), genomeKey(g) + 'x');
    for (const [k, vals] of Object.entries(FAMILIES[c.family].space)) assert.ok(vals.includes(c.params[k]));
    assert.ok(typeof describe(g) === 'string' && describe(g).length > 10);
  }
  const namer = makeNamer(rng(2));
  const names = Array.from({ length: 300 }, namer);
  assert.equal(new Set(names).size, 300);
});

test('grade: stagiar în primul an, ELITĂ doar cu palmares lung și avantaj statistic, pensionare pentru pierderi', () => {
  const s = (n, E, t, n12 = 0, E12 = null) => ({ n, E, t, n12, E12 });
  assert.equal(rankOf(s(50, 0.3, 4), 200), 'STAGIAR', 'primul an = învățare');
  assert.equal(rankOf(s(5, 0.3, 4), 800), 'STAGIAR', 'prea puține tranzacții');
  assert.equal(rankOf(s(35, 0.2, 2.5), 800), 'ELITĂ');
  assert.equal(rankOf(s(35, 0.2, 2.5, 8, -0.2), 800), 'SENIOR', 'un ultim an prost îl coboară din elită');
  assert.equal(rankOf(s(25, 0.1, 1.2), 800), 'SENIOR');
  assert.equal(rankOf(s(25, 0.02, 0.3), 800), 'JUNIOR');
  assert.ok(shouldRetire(s(25, -0.05, -0.4), 800, 'JUNIOR'));
  assert.ok(shouldRetire(s(16, -0.4, -2), 400, 'JUNIOR'));
  assert.equal(shouldRetire(s(25, 0.1, 1.2), 800, 'SENIOR'), null);
  assert.ok(shouldRetire(s(15, 0.01, 0.2), 1500, 'JUNIOR'), 'nu a urcat în 4 ani');
  const tr = [{ openedAt: 10, closedAt: 20, resultR: 1 }, { openedAt: 30, closedAt: 40, resultR: -1, outcome: 'END_OF_DATA' }, { openedAt: 50, closedAt: 60, resultR: 0.5 }];
  const f = forwardStats(tr, 0, 100, 0);
  assert.equal(f.n, 2, 'pozițiile încă deschise nu intră în palmares');
  assert.equal(f.totalR, 1.5);
});

test('viața agenților: populația rămâne 300, fiecare nou-născut trece admiterea, semnalele companiei vin doar de la ELITĂ', () => {
  const data = universe(4200, 700);
  const res = runAcademy(data, INSTR, { sim, populationSize: 120, seed: 3 });
  const alive = res.agents.filter((a) => !a.retiredAt);
  assert.equal(alive.length, 120);
  assert.ok(res.agents.length > 120, 'au existat pensionări și nașteri');
  assert.ok(res.agents.every((a) => a.entrance.n >= RULES.entranceMinTrades && a.entrance.E > 0));
  assert.ok(res.agents.filter((a) => a.parentId).every((a) => a.generation >= 2));
  // diversitate: nicio familie peste 35%, nicio pereche peste 15% (+1 pentru rotunjire)
  const fam = {}, pr = {};
  for (const a of alive) { fam[a.genome.family] = (fam[a.genome.family] || 0) + 1; pr[a.genome.pair] = (pr[a.genome.pair] || 0) + 1; }
  assert.ok(Math.max(...Object.values(fam)) <= 0.35 * 120 + 1, JSON.stringify(fam));
  const elite = new Set(res.agents.filter((a) => a.eliteQuarters > 0).map((a) => a.id));
  assert.ok(res.companyTrades.every((t) => elite.has(t.agentId)));
  // o singură poziție pe pereche în același timp
  const bySym = {};
  for (const t of res.companyTrades) { assert.ok(!(bySym[t.symbol] > t.openedAt), 'două poziții pe aceeași pereche'); bySym[t.symbol] = t.closedAt; }
});

test('viața agenților: FĂRĂ look-ahead — pe date tăiate, deciziile până la tăietură sunt identice', () => {
  const full = universe(4600, 900);
  const cut = 3600;
  const part = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.slice(0, cut)]));
  const a = runAcademy(full, INSTR, { sim, populationSize: 80, seed: 5 });
  const b = runAcademy(part, INSTR, { sim, populationSize: 80, seed: 5 });
  const limit = T0 + (cut - 120) * DAY;
  const key = (t) => `${t.agentId}|${t.symbol}|${t.openedAt}|${t.closedAt}|${t.resultR}`;
  const fa = a.companyTrades.filter((t) => t.closedAt < limit).map(key);
  const fb = b.companyTrades.filter((t) => t.closedAt < limit).map(key);
  assert.ok(fa.length > 10, 'trebuie să existe semnale de comparat');
  assert.deepEqual(fb, fa);
  const qa = a.quarters.filter((q) => Date.parse(q.at) < limit - 100 * DAY);
  assert.deepEqual(b.quarters.slice(0, qa.length), qa);
});

test('control: pe prețuri complet aleatoare, compania NU arată avantaj dovedit (selecția nu fabrică noroc)', () => {
  for (const seed of [1, 2, 3]) {
    const res = runAcademy(universe(5000, 100 * seed), INSTR, { sim, populationSize: 100, seed });
    const c = res.company;
    assert.ok(!(c.trades >= 100 && c.expectancyCI95[0] > 0), `seed ${seed}: E=${c.expectancyR} IC ${c.expectancyCI95}`);
  }
});

test('date Forex live: orele Yahoo devin zile UTC; sâmbăta dispare, duminica se lipește de luni, azi nu intră', () => {
  const hours = [];
  const start = Date.UTC(2026, 9, 11, 0); // duminică 11 oct 2026
  for (let h = 0; h < 24 * 8; h++) {
    const ts = start + h * 3600e3;
    const wd = new Date(ts).getUTCDay();
    if (wd === 6 || (wd === 0 && new Date(ts).getUTCHours() < 21)) continue; // piața e închisă sâmbătă și duminică până seara
    hours.push({ timestamp: ts, open: 1 + h / 1000, high: 1.001 + h / 1000, low: 0.999 + h / 1000, close: 1 + (h + 1) / 1000 });
  }
  const now = Date.UTC(2026, 9, 17, 10); // sâmbătă 17 oct
  const days = hoursToUtcDays(hours, now);
  assert.deepEqual(days.map((d) => new Date(d.timestamp).getUTCDay()), [1, 2, 3, 4, 5]);
  assert.equal(days[0].open, hours[0].open, 'luni începe cu deschiderea de duminică seara');
  const partial = hoursToUtcDays(hours, Date.UTC(2026, 9, 15, 10));
  assert.equal(new Date(partial[partial.length - 1].timestamp).getUTCDate(), 14, 'ziua în curs nu e folosită');
});

test('istoric Dukascopy: citește .csv.gz și aruncă rândurile imposibile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dk-'));
  const f = path.join(dir, 'EURUSD.csv.gz');
  fs.writeFileSync(f, zlib.gzipSync('timestamp,open,high,low,close,spread\n1000,1.1,1.2,1.0,1.15,0.0001\n2000,1.1,1.0,1.2,1.1,0.0001\n'));
  const bars = loadDk(f);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].spread, 0.0001);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('live Forex: Academia oprită = tăcere; agenții ELITĂ trimit pe perechea lor, o singură poziție pe pereche', async () => {
  const config = loadConfig();
  const bus = new MarketStateBus(config, { snapshotPath: null });
  const msgs = [];
  const notify = async (t) => { msgs.push(t); return { sent: true }; };
  assert.deepEqual(await runFxCycle({ config: Object.assign({}, config, { fxDesk: { enabled: false } }), instruments: INSTR, bus, notify }), { skipped: 'ACADEMIA_OPRITĂ' });

  // două agenți ELITĂ pe aceeași pereche, aceeași regulă: doar primul deschide
  const params = { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: false };
  const fxDesk = { enabled: true, firm: 'THE5ERS_HIGH_STAKES', riskPct: 1, safety: 0.7, maxOpen: 3,
    elite: [{ id: 'A0001', name: 'Andrei Popescu', pair: 'EURUSD', family: 'rsi2', familyName: 'Pullback RSI(2)', params }, { id: 'A0002', name: 'Maria Ionescu', pair: 'EURUSD', family: 'rsi2', familyName: 'Pullback RSI(2)', params }] };
  const d = eliteToDesk(fxDesk);
  assert.deepEqual(d.symbols, ['EURUSD']);
  assert.equal(d.strategies[0].who, 'Andrei Popescu (Pullback RSI(2))');
  const bars = [];
  for (let i = 0; i < 300; i++) { const c = 1 + 0.001 * i; bars.push({ timestamp: T0 + i * DAY, open: c - 0.001, high: c + 0.002, low: c - 0.003, close: c, volume: 0 }); }
  for (let k = 0; k < 2; k++) { const p = bars[bars.length - 1].close; bars.push({ timestamp: bars[bars.length - 1].timestamp + DAY, open: p, high: p + 0.001, low: p - 0.011, close: p - 0.01, volume: 0 }); }
  const cfg = Object.assign({}, config, { fxDesk });
  const feed = (b) => async () => ({ candles: b.map((x) => Object.assign({}, x)) });
  const tLast = bars[bars.length - 1].timestamp + DAY;
  await runFxCycle({ config: cfg, instruments: INSTR, bus, notify, fetch: feed(bars.slice(0, -1)), now: tLast - DAY + 3600e3, env: {} });
  assert.match(msgs[msgs.length - 1], /APEX FOREX a pornit/);
  const r = await runFxCycle({ config: cfg, instruments: INSTR, bus, notify, fetch: feed(bars), now: tLast + 3600e3, env: {} });
  assert.deepEqual(r.events.map((e) => e.event), ['ENTRY', 'SKIP']);
  assert.equal(r.events[1].reason, 'PERECHE_OCUPATĂ');
  assert.match(msgs[msgs.length - 1], /SEMNAL FOREX: EURUSD/);
  assert.match(msgs[msgs.length - 1], /Trader: Andrei Popescu/);
  assert.ok(bus.state.fx && !bus.state.prop, 'starea Forex e separată de cea a indicilor');
});

test('APEX Capital (bani fictivi): contabilitate corectă, risc după grad, limite pe companie și pe trader', () => {
  const { simulateCompany, postMortem } = require('../src/academy/company');
  const res = runAcademy(universe(4200, 1300), INSTR, { sim, populationSize: 120, seed: 2 });
  const v = simulateCompany(res);
  assert.ok(v.trades > 100);
  const sumMonths = v.months.reduce((s, m) => s + m.pnl, 0);
  assert.ok(Math.abs(v.startCapital + sumMonths - v.endCapital) <= v.months.length + 1, 'soldul = start + profitul lunilor');
  assert.equal(v.months[v.months.length - 1].endEquity, v.endCapital);
  // riscul pe tranzacție urmează gradul: |pnl| / |R| / capital ≈ procentul gradului (capitalul se schimbă, deci aproximativ)
  for (const j of v.journal.filter((x) => Math.abs(x.r) > 0.2)) {
    const pct = Math.abs(j.pnl / j.r) / v.startCapital;
    const want = v.policy.riskByRank[j.rank];
    assert.ok(pct > want * 0.3 && pct < want * 3, `${j.rank}: ${pct}`);
  }
  assert.ok(v.maxDrawdownPct >= 0 && v.maxDrawdownPct < 100);
  assert.ok(v.worstTrades.length === 5 && v.worstTrades.every((t) => t.lesson.length > 20));
  // limite mai stricte ⇒ mai multe tranzacții refuzate
  const strict = simulateCompany(res, { maxOpenRisk: 0.005 });
  assert.ok(strict.skippedRisk > v.skippedRisk);
  // trader trimis acasă: cu o limită foarte strictă apar suspendări și tranzacții sărite
  const harsh = simulateCompany(res, { traderLimitR: -1 });
  assert.ok(harsh.suspensions > 0 && harsh.skippedHome > 0);
  assert.match(postMortem({ direction: 'LONG', outcome: 'STOP', exit: 0.9, stop: 1, r: -1.4 }), /gap/);
});

test('costuri reale: o zi cu spread mare (știri) costă mai mult; spread-ul mic nu scade niciodată sub cel obișnuit', () => {
  const bars = walk(1500, 77, 0.0002);
  const p = { kind: 'rsi2', trendLen: 100, entryRsi: 10, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: true };
  const base = lab.simulateBars('EURUSD', bars, INSTR.EURUSD, p);
  const tiny = lab.simulateBars('EURUSD', bars.map((b) => Object.assign({}, b, { spread: 0.00001 })), INSTR.EURUSD, p);
  assert.deepEqual(tiny.map((t) => t.resultR), base.map((t) => t.resultR), 'spread mic ⇒ se păstrează minimul din config');
  const wide = lab.simulateBars('EURUSD', bars.map((b) => Object.assign({}, b, { spread: 0.0010 })), INSTR.EURUSD, p);
  const sum = (ts) => ts.reduce((s, t) => s + t.resultR, 0);
  assert.ok(sum(wide) < sum(base) - 1, 'spread de 10 pips ⇒ rezultate clar mai slabe');
});

test('dobânzi: fără look-ahead (luna anterioară), swap real (primești sau plătești), strategia carry', () => {
  const { parseRates, rateAt, diffAt } = require('../src/data/rates');
  const lines = ['month,USD,EUR,JPY,AUD'];
  for (let y = 2003; y <= 2008; y++) for (let m = 1; m <= 12; m++) lines.push(`${y}-${String(m).padStart(2, '0')},${y < 2006 ? 1 : 5},2,0.1,6`);
  const R = parseRates(lines.join('\n'));
  assert.equal(rateAt(R, 'USD', Date.UTC(2006, 0, 15)), 1, 'în ianuarie 2006 vedem doar decembrie 2005');
  assert.equal(rateAt(R, 'USD', Date.UTC(2006, 1, 15)), 5);
  assert.equal(diffAt(R, 'AUD', 'JPY', Date.UTC(2004, 5, 1)).toFixed(1), '5.9');
  assert.equal(diffAt(R, 'XXX', 'JPY', Date.UTC(2004, 5, 1)), null);
  // AUDJPY: diferență mare de dobândă ⇒ carry cumpără; swap-ul îi aduce bani, iar vânzarea plătește
  const bars = walk(1500, 88, 0.0003).map((b) => Object.assign({}, b, { open: b.open * 80, high: b.high * 80, low: b.low * 80, close: b.close * 80 }));
  const carry = lab.simulateBars('AUDJPY', bars, INSTR.AUDJPY, { kind: 'carry', minDiff: 2, trendLen: 0, stopAtr: 4, maxDays: 250, allowShort: true }, { rates: R });
  assert.ok(carry.length > 0 && carry.every((t) => t.direction === 'LONG'));
  assert.ok(carry.some((t) => t.costR < 0), 'swap pozitiv: costul total devine câștig la ținere lungă');
  assert.equal(lab.simulateBars('AUDJPY', bars, INSTR.AUDJPY, { kind: 'carry', minDiff: 2, trendLen: 0, stopAtr: 4, maxDays: 250 }).length, 0, 'fără dobânzi ⇒ fără semnale carry');
  const p = { kind: 'mom', lookback: 60, stopAtr: 3, maxDays: 250, allowShort: true };
  const withR = lab.simulateBars('AUDJPY', bars, INSTR.AUDJPY, p, { rates: R });
  const longs = withR.filter((t) => t.direction === 'LONG'), shorts = withR.filter((t) => t.direction === 'SHORT');
  if (longs.length && shorts.length) assert.ok(Math.min(...longs.map((t) => t.costR / Math.max(1, (t.closedAt - t.openedAt) / DAY))) < Math.min(...shorts.map((t) => t.costR / Math.max(1, (t.closedAt - t.openedAt) / DAY))));
});

test('APEX Capital live: cei 300 tranzacționează zilnic cu bani fictivi — pornire tăcută, intrare proaspătă, ieșire, risc după grad, acasă după pierderi', async () => {
  const { runVirtualCycle } = require('../src/academy/virtualLive');
  const bus = new MarketStateBus(loadConfig(), { snapshotPath: null });
  const params = { trendLen: 200, entryRsi: 5, exitLen: 3, stopAtr: 2, maxDays: 10, allowShort: false };
  const academy = { generatedAt: '2026-10-01T00:00:00Z', population: [
    { id: 'A1', name: 'Andrei Popescu', rank: 'ELITĂ', pair: 'EURUSD', family: 'rsi2', params },
    { id: 'A2', name: 'Maria Ionescu', rank: 'STAGIAR', pair: 'EURUSD', family: 'rsi2', params: Object.assign({}, params, { stopAtr: 3 }) }
  ] };
  const bars = [];
  for (let i = 0; i < 300; i++) { const c = 1 + 0.001 * i; bars.push({ timestamp: T0 + i * DAY, open: c - 0.001, high: c + 0.002, low: c - 0.003, close: c, volume: 0 }); }
  for (let k = 0; k < 2; k++) { const p = bars[bars.length - 1].close; bars.push({ timestamp: bars[bars.length - 1].timestamp + DAY, open: p, high: p + 0.001, low: p - 0.011, close: p - 0.01, volume: 0 }); }
  const feed = (b) => async () => ({ candles: b.map((x) => Object.assign({}, x)) });
  const tLast = bars[bars.length - 1].timestamp + DAY;
  let r = await runVirtualCycle({ academy, instruments: INSTR, bus, fetch: feed(bars.slice(0, -1)), now: tLast - DAY + 3600e3 });
  assert.equal(r.opened, 0, 'prima rulare: nu intră în tranzacții deja începute');
  assert.equal(bus.state.fxVirtual.initialized, true);
  r = await runVirtualCycle({ academy, instruments: INSTR, bus, fetch: feed(bars), now: tLast + 3600e3 });
  assert.equal(r.opened, 2);
  const pos = bus.state.fxVirtual.positions;
  assert.ok(Math.abs(pos.A1.risk / 1e6 - 0.003) < 1e-9 && Math.abs(pos.A2.risk / 1e6 - 0.0005) < 1e-9, 'risc după grad: elită 0,30%, stagiar 0,05%');
  // aceeași zi, verificată din nou peste 10 minute: nimic nou (o descărcare pe oră)
  r = await runVirtualCycle({ academy, instruments: INSTR, bus, fetch: feed(bars), now: tLast + 3600e3 + 600e3 });
  assert.deepEqual(r.fetched, []);
  // revenire puternică ⇒ ambele ies cu profit; capitalul fictiv crește
  const L = bars[bars.length - 1];
  const up = bars.concat([{ timestamp: L.timestamp + DAY, open: L.close, high: L.close + 0.03, low: L.close - 0.001, close: L.close + 0.025, volume: 0 }]);
  r = await runVirtualCycle({ academy, instruments: INSTR, bus, fetch: feed(up), now: tLast + DAY + 3600e3 });
  assert.equal(r.closed, 2);
  const book = bus.state.fxVirtual;
  assert.ok(book.equity > 1e6);
  assert.ok(book.agents.A1.pnl > book.agents.A2.pnl, 'elita câștigă mai mulți bani pe același semnal');
  assert.equal(book.journal.length, 2);
  // limita trader-ului: după pierderi mari stă acasă; o școală nouă îl readuce
  book.recent.A2 = [{ at: tLast + DAY, r: -9 }];
  book.sentHome.A2 = tLast + DAY;
  await runVirtualCycle({ academy: Object.assign({}, academy, { generatedAt: '2026-11-01T00:00:00Z' }), instruments: INSTR, bus, fetch: feed(up), now: tLast + DAY + 3 * 3600e3 });
  assert.deepEqual(book.sentHome, {}, 'școala nouă: toți revin la lucru');
});
