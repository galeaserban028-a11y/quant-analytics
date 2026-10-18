'use strict';

/**
 * ECHIPA: fiecare combinație strategie × indice e un „trader” cu nume, fișă și rezultate proprii.
 *
 * Viața unui trader:
 *  - LUCREAZĂ non-stop: semnalele lui ajung la tine după închiderea bursei lui;
 *  - merge la ȘCOALĂ o dată pe lună: cercetarea lunară re-alege parametrii strategiei pe ultimii 3 ani;
 *  - stă pe BANCĂ dacă în ultimii 3 ani a pierdut clar (> 0,05R pe tranzacție, din cel puțin 10 tranzacții);
 *    revine automat când rezultatele lui din ultimii 3 ani își revin.
 *
 * Regula băncii a fost testată walk-forward (decizia luată doar cu datele de până atunci): ajută puțin, dar constant
 * (trecerea examenului +2 puncte procentuale, picarea −0,5 puncte). Efectul e mic și îl spunem ca atare.
 */
const { computeMetrics } = require('../backtest/metrics');

const YEAR = 365.25 * 864e5;
const DAY = 864e5;
const BENCH_MIN_TRADES = 10;
const BENCH_BELOW_R = -0.05;

/** Numele traderilor: câte unul pentru fiecare indice, pe echipe (strategii). */
const NAMES = {
  rsi2: { US30: 'Andrei', NAS100: 'Maria', SPX500: 'Mihai', US2000: 'Elena', GER40: 'Radu', UK100: 'Ioana', FRA40: 'Vlad', EU50: 'Ana', JP225: 'Cristi', AUS200: 'Diana' },
  down: { US30: 'Bogdan', NAS100: 'Irina', SPX500: 'Alex', US2000: 'Raluca', GER40: 'Tudor', UK100: 'Bianca', FRA40: 'Matei', EU50: 'Sara', JP225: 'Ștefan', AUS200: 'Larisa' }
};

const STAFF = [
  { id: 'guardian', name: 'Victor', role: 'Gardianul', job: 'Verifică fiecare semnal față de regulile firmei; împarte bugetul zilnic de risc; oprește intrările când ținta e atinsă.' },
  { id: 'research', name: 'Sofia', role: 'Profesoara (cercetare)', job: 'O dată pe lună re-antrenează strategiile pe ultimii 3 ani, decide cine stă pe bancă, refă simularea examenelor.' },
  { id: 'courier', name: 'Dan', role: 'Curierul', job: 'Trimite pe Telegram semnalele, închiderile și verificarea de la ora 9.' },
  { id: 'accountant', name: 'Paul', role: 'Contabilul', job: 'Ține soldul estimat, faza examenului, zilele de tranzacționare și fișele traderilor.' },
  { id: 'data', name: 'Nelu', role: 'Paznicul datelor', job: 'Descarcă datele la 10 minute după închiderea fiecărei burse; trece pe sursa de rezervă când Yahoo cade.' }
];

function nameFor(kind, sym) {
  return (NAMES[kind] && NAMES[kind][sym]) || `${sym}-${kind}`;
}

const agentId = (sym, kind) => `${sym}|${kind}`;

/** Stă pe bancă? (doar din tranzacțiile din antrenare, adică trecutul) */
function benchDecision(trainTrades) {
  const m = computeMetrics(trainTrades);
  const benched = m.trades >= BENCH_MIN_TRADES && m.expectancyR < BENCH_BELOW_R;
  return { benched, trades: m.trades, expectancyR: m.expectancyR };
}

function sliceBars(data, from, to) {
  const o = {};
  for (const [s, bs] of Object.entries(data)) {
    const x = bs.filter((c) => c.timestamp >= from && c.timestamp < to);
    if (x.length) o[s] = x;
  }
  return o;
}

/**
 * Walk-forward al ECHIPEI: pentru fiecare an de test și fiecare strategie, parametrii se aleg pe cei 3 ani de dinainte,
 * apoi fiecare trader decide (tot pe acei 3 ani) dacă lucrează sau stă pe bancă. Tranzacțiile out-of-sample sunt doar
 * ale celor care lucrau atunci.
 * @param {object} data { SYM: bars }
 * @param {object} instruments
 * @param {object} strategies { kind: { name, grid } }
 * @param {Function} sim simulatorul (data, inst, params, opts) → trades
 */
function teamWalkForward(data, instruments, strategies, sim, opts = {}) {
  const trainYears = opts.trainYears || 3;
  const minTrades = opts.minTrades || 40;
  const log = opts.log || (() => {});
  let start = Infinity, end = -Infinity;
  for (const b of Object.values(data)) { start = Math.min(start, b[0].timestamp); end = Math.max(end, b[b.length - 1].timestamp); }

  const byStrategy = {};
  for (const kind of Object.keys(strategies)) byStrategy[kind] = { folds: [], oos: [], oosAll: [], latest: null };

  for (let ts = start + trainYears * YEAR; ts < end - 30 * DAY; ts += YEAR) {
    const te = Math.min(end + 1, ts + YEAR);
    const train = sliceBars(data, ts - trainYears * YEAR, ts);
    const test = sliceBars(data, ts - 220 * DAY, te);
    for (const [kind, st] of Object.entries(strategies)) {
      let best = null;
      for (const p of st.grid) {
        const m = computeMetrics(sim(train, instruments, p, { barMs: DAY }));
        const obj = m.trades >= minTrades ? m.expectancyR * Math.sqrt(m.trades) : -Infinity;
        if (!best || obj > best.obj) best = { obj, params: p, metrics: m };
      }
      const S = byStrategy[kind];
      const fold = { testFrom: new Date(ts).toISOString().slice(0, 10), testTo: new Date(te).toISOString().slice(0, 10), params: best.params, trading: best.obj > 0, benched: [] };
      if (best.obj > 0) {
        const trainTrades = sim(train, instruments, best.params, { barMs: DAY });
        const oos = sim(test, instruments, best.params, { barMs: DAY, tradeFromTs: ts, tradeUntilTs: te });
        S.oosAll.push(...oos);
        for (const sym of Object.keys(data)) {
          const b = benchDecision(trainTrades.filter((t) => t.symbol === sym));
          if (b.benched) fold.benched.push(sym);
          else S.oos.push(...oos.filter((t) => t.symbol === sym));
        }
      }
      fold.oos = computeMetrics(S.oos.filter((t) => t.openedAt >= ts && t.openedAt < te));
      log(`${st.name} ${fold.testFrom}: ${JSON.stringify(best.params)} | pe bancă: ${fold.benched.join(', ') || '–'} | E=${fold.oos.expectancyR}R (${fold.oos.trades})`);
      S.folds.push(fold);
      S.latest = { params: best.params, trainMetrics: best.metrics };
    }
  }

  // Starea de ACUM: parametrii celei mai recente școli și banca pe ultimii 3 ani
  const now = end + DAY;
  const recent = sliceBars(data, now - trainYears * YEAR, now);
  const agents = [];
  for (const [kind, st] of Object.entries(strategies)) {
    const S = byStrategy[kind];
    if (!S.latest) continue;
    const recentTrades = sim(recent, instruments, S.latest.params, { barMs: DAY });
    for (const sym of Object.keys(data)) {
      const mine = S.oosAll.filter((t) => t.symbol === sym);
      const m = computeMetrics(mine);
      const years = new Map();
      for (const t of mine) { const y = new Date(t.openedAt).getUTCFullYear(); years.set(y, (years.get(y) || 0) + t.resultR); }
      const last12 = computeMetrics(mine.filter((t) => t.openedAt >= now - YEAR));
      const b = benchDecision(recentTrades.filter((t) => t.symbol === sym));
      agents.push({
        id: agentId(sym, kind),
        name: nameFor(kind, sym),
        strategy: kind,
        strategyName: st.name,
        symbol: sym,
        status: b.benched ? 'BANCĂ' : 'LUCREAZĂ',
        why: b.benched
          ? `În ultimii 3 ani: ${b.expectancyR.toFixed(3)}R pe tranzacție din ${b.trades} (sub ${BENCH_BELOW_R}R). Revine când își revine.`
          : `În ultimii 3 ani: ${b.trades ? `${b.expectancyR >= 0 ? '+' : ''}${b.expectancyR.toFixed(3)}R pe tranzacție din ${b.trades}` : 'prea puține tranzacții pentru o judecată'}.`,
        last3y: { trades: b.trades, expectancyR: b.expectancyR },
        record: {
          trades: m.trades, winRatePct: m.winRatePct, expectancyR: m.expectancyR, totalR: m.totalR,
          maxLosingStreak: m.maxLosingStreak,
          yearsPositive: Array.from(years.values()).filter((v) => v > 0).length, years: years.size,
          last12m: { trades: last12.trades, totalR: last12.totalR }
        }
      });
    }
  }
  const oosTrades = Object.values(byStrategy).flatMap((S) => S.oos);
  return { byStrategy, agents, oosTrades };
}

module.exports = { teamWalkForward, benchDecision, nameFor, agentId, NAMES, STAFF, BENCH_BELOW_R, BENCH_MIN_TRADES };
