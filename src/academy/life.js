'use strict';

/**
 * VIAȚA AGENȚILOR din Academia Forex — evoluție pe istoria reală, fără să vadă viitorul.
 *
 * La fiecare trimestru (pas de timp T), folosind DOAR ce s-a întâmplat până la T:
 *  1. fiecare agent viu are un palmares „pe hârtie” de la naștere până la T (tranzacții închise până la T);
 *  2. primește un grad:  STAGIAR (învață: primul an sau < 10 tranzacții) → JUNIOR → SENIOR → ELITĂ;
 *     ELITĂ = cel puțin 30 de tranzacții pe hârtie și un avantaj statistic clar (t ≥ 2), fără un ultim an prost;
 *  3. doar agenții ELITĂ la momentul T „trimit semnale reale” în trimestrul următor → acestea sunt tranzacțiile
 *     companiei, măsurate strict după decizie (out-of-sample);
 *  4. cei slabi se pensionează; locul lor îl iau copii ai celor mai buni (ADN cu mici mutații) sau nou-veniți;
 *     orice nou-născut trece un „examen de admitere” pe ultimii 3 ani de dinainte de naștere.
 *
 * Cu 300 de agenți, unii par buni din noroc. De aceea nu ne uităm la cel mai bun agent din trecut, ci la rezultatul
 * COMPANIEI pe trimestrele de după fiecare decizie: dacă selecția nu are valoare, compania iese pe zero sau minus și
 * sistemul rămâne oprit.
 */
const { rng, computeMetrics } = require('../backtest/metrics');
const { randomGenome, mutate, genomeKey, makeNamer } = require('./genome');

const DAY = 864e5;
const YEAR = 365.25 * DAY;

const RULES = {
  stagiarDays: 365, stagiarMinTrades: 10,
  eliteMinTrades: 30, eliteT: 2.0, eliteLast12Min: -0.05,
  seniorMinTrades: 20, seniorT: 1.0,
  entranceYears: 3, entranceMinTrades: 10,
  retireAfterDays: 730, retireMinTrades: 20, retireT: -1.5, retireIdleDays: 4 * 365,
  maxFamilyShare: 0.35, maxPairShare: 0.15 // diversitate: nicio „specie” nu poate acapara populația
};

function forwardStats(trades, from, to, last12From) {
  let n = 0, sum = 0, sum2 = 0, wins = 0, n12 = 0, sum12 = 0;
  for (const t of trades) {
    if (t.openedAt < from || t.closedAt > to || t.outcome === 'END_OF_DATA') continue;
    n++; sum += t.resultR; sum2 += t.resultR * t.resultR; if (t.resultR > 0) wins++;
    if (t.openedAt >= last12From) { n12++; sum12 += t.resultR; }
  }
  const E = n ? sum / n : 0;
  const sd = n > 1 ? Math.sqrt(Math.max(0, (sum2 - n * E * E) / (n - 1))) : 0;
  const tStat = n > 1 && sd > 0 ? E / (sd / Math.sqrt(n)) : 0;
  return { n, E, sd, t: tStat, winRatePct: n ? wins / n * 100 : 0, totalR: sum, n12, E12: n12 ? sum12 / n12 : null };
}

function rankOf(s, ageDays, R = RULES) {
  if (ageDays < R.stagiarDays || s.n < R.stagiarMinTrades) return 'STAGIAR';
  if (s.n >= R.eliteMinTrades && s.t >= R.eliteT && (s.E12 == null || s.n12 < 5 || s.E12 > R.eliteLast12Min)) return 'ELITĂ';
  if (s.n >= R.seniorMinTrades && s.t >= R.seniorT) return 'SENIOR';
  return 'JUNIOR';
}

function shouldRetire(s, ageDays, rank, R = RULES) {
  if (ageDays >= R.retireAfterDays && s.n >= R.retireMinTrades && s.E <= 0) return 'pierdea bani după 2 ani';
  if (s.n >= 15 && s.t <= R.retireT) return 'pierderi clare';
  if (ageDays >= R.retireIdleDays && (rank === 'STAGIAR' || rank === 'JUNIOR')) return 'nu a urcat în grad în 4 ani';
  return null;
}

/**
 * @param {object} data { PAIR: bars zilnice }
 * @param {object} instruments
 * @param {object} opts { sim(dataOne, instruments, params, opts) → trades, populationSize, seed, stepDays, log }
 */
function runAcademy(data, instruments, opts) {
  const sim = opts.sim;
  const size = opts.populationSize || 300;
  const step = (opts.stepDays || 91) * DAY;
  const R = Object.assign({}, RULES, opts.rules || {});
  const log = opts.log || (() => {});
  const pairs = Object.keys(data).sort();
  const r = rng((opts.seed || 1) * 7907);
  const namer = makeNamer(rng((opts.seed || 1) * 104729));

  const cache = new Map();
  const tradesOf = (g) => {
    const k = genomeKey(g);
    if (!cache.has(k)) cache.set(k, sim({ [g.pair]: data[g.pair] }, instruments, g.params, { barMs: DAY }));
    return cache.get(k);
  };
  let start = Infinity, end = -Infinity;
  for (const b of Object.values(data)) { start = Math.min(start, b[0].timestamp); end = Math.max(end, b[b.length - 1].timestamp + DAY); }
  const t0 = start + R.entranceYears * YEAR + 250 * DAY; // istoric pentru indicatori + examenul de admitere

  const passesEntrance = (g, T) => {
    const s = forwardStats(tradesOf(g), T - R.entranceYears * YEAR, T, T);
    return s.n >= R.entranceMinTrades && s.E > 0 ? s : null;
  };

  const agents = [];
  let nextId = 1;
  const crowded = (g) => {
    const alive = agents.filter((a) => !a.retiredAt);
    const fam = alive.filter((a) => a.genome.family === g.family).length;
    const pr = alive.filter((a) => a.genome.pair === g.pair).length;
    const pairCap = Math.max(R.maxPairShare, 1.5 / pairs.length); // cu puține perechi, plafonul crește ca populația să încapă
    return fam >= R.maxFamilyShare * size || pr >= pairCap * size;
  };
  const birth = (T, parent) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const g = parent && attempt < 25 ? mutate(parent.genome, r, pairs) : randomGenome(r, pairs);
      if (crowded(g)) continue;
      const ent = passesEntrance(g, T);
      if (!ent) continue;
      const a = {
        id: `A${String(nextId++).padStart(4, '0')}`, name: namer(), genome: g,
        bornAt: T, parentId: parent ? parent.id : null, generation: parent ? parent.generation + 1 : 1,
        entrance: { n: ent.n, E: ent.E }, rank: 'STAGIAR', retiredAt: null, retiredWhy: null,
        ranks: [], bestRank: 'STAGIAR', eliteQuarters: 0
      };
      agents.push(a);
      return a;
    }
    return null;
  };

  for (let k = 0; k < size * 3 && agents.length < size; k++) birth(t0, null);

  const ORDER = { STAGIAR: 0, JUNIOR: 1, SENIOR: 2, 'ELITĂ': 3 };
  const quarters = [];
  const company = [];
  for (let T = t0; T < end - 30 * DAY; T += step) {
    const alive = agents.filter((a) => !a.retiredAt);
    const counts = { STAGIAR: 0, JUNIOR: 0, SENIOR: 0, 'ELITĂ': 0 };
    const retiring = [];
    for (const a of alive) {
      const age = (T - a.bornAt) / DAY;
      const s = forwardStats(tradesOf(a.genome), a.bornAt, T, T - YEAR);
      a.stats = s;
      const rk = rankOf(s, age, R);
      if (rk !== a.rank) a.ranks.push({ at: T, rank: rk });
      a.rank = rk;
      if (ORDER[rk] > ORDER[a.bestRank]) a.bestRank = rk;
      counts[rk]++;
      const why = shouldRetire(s, age, rk, R);
      if (why) retiring.push([a, why]);
    }
    // semnalele companiei pentru trimestrul următor: doar de la ELITĂ, decis la T
    const elites = alive.filter((a) => a.rank === 'ELITĂ' && !retiring.some(([x]) => x === a));
    for (const a of elites) {
      a.eliteQuarters++;
      for (const t of tradesOf(a.genome)) if (t.openedAt >= T && t.openedAt < T + step && t.outcome !== 'END_OF_DATA') company.push(Object.assign({}, t, { agentId: a.id }));
    }
    // pensionări și nașteri
    for (const [a, why] of retiring) { a.retiredAt = T; a.retiredWhy = why; }
    const parents = agents.filter((a) => !a.retiredAt && (a.rank === 'ELITĂ' || a.rank === 'SENIOR'));
    const tournament = () => {
      let best = null;
      for (let i = 0; i < 3; i++) { const c = parents[Math.floor(r() * parents.length)]; if (!best || c.stats.t > best.stats.t) best = c; }
      return best;
    };
    let born = 0;
    while (agents.filter((a) => !a.retiredAt).length < size) {
      const parent = parents.length && r() < 0.8 ? tournament() : null;
      if (!birth(T, parent)) break;
      born++;
    }
    // lista de prezență a trimestrului (cine lucrează și cu ce grad) — pentru compania cu bani fictivi
    const roster = alive.filter((a) => !retiring.some(([x]) => x === a)).map((a) => ({ id: a.id, rank: a.rank }));
    quarters.push({ at: new Date(T).toISOString().slice(0, 10), T, counts, elites: elites.length, retired: retiring.length, born, roster });
    if (quarters.length % 8 === 0) log(`${new Date(T).toISOString().slice(0, 10)}: ${JSON.stringify(counts)} · pensionați ${retiring.length} · născuți ${born}`);
  }

  // o singură poziție a companiei pe pereche în același timp (ca live: nu dublăm aceeași pereche)
  company.sort((a, b) => a.openedAt - b.openedAt || a.agentId.localeCompare(b.agentId));
  const busy = {};
  const companyTrades = [];
  for (const t of company) {
    if (busy[t.symbol] && busy[t.symbol] > t.openedAt) continue;
    busy[t.symbol] = t.closedAt;
    companyTrades.push(t);
  }

  // starea finală (acum): palmaresul până la sfârșitul datelor
  for (const a of agents.filter((x) => !x.retiredAt)) {
    const age = (end - a.bornAt) / DAY;
    a.stats = forwardStats(tradesOf(a.genome), a.bornAt, end, end - YEAR);
    a.rank = rankOf(a.stats, age, R);
  }
  return { agents, quarters, companyTrades, company: computeMetrics(companyTrades), rules: R, t0, end, step, tradesOf };
}

module.exports = { runAcademy, forwardStats, rankOf, shouldRetire, RULES };
