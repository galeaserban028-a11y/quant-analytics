'use strict';

/** Generator pseudo-aleator determinist (mulberry32), ca rezultatele să fie reproductibile. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Interval de încredere 95% pentru expectancy, prin bootstrap (reeșantionare cu înlocuire). */
function bootstrapCI(values, iterations = 2000, seed = 42) {
  if (values.length < 2) return [null, null];
  const r = rng(seed);
  const means = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) s += values[Math.floor(r() * values.length)];
    means.push(s / values.length);
  }
  means.sort((x, y) => x - y);
  return [means[Math.floor(0.025 * iterations)], means[Math.floor(0.975 * iterations)]];
}

function round(v, d = 3) { return v === null || !Number.isFinite(v) ? v : Number(v.toFixed(d)); }

/**
 * Statistici pe o listă de tranzacții închise (fiecare cu resultR).
 */
function computeMetrics(trades) {
  const r = trades.map((t) => t.resultR);
  const wins = r.filter((v) => v > 0);
  const losses = r.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = -losses.reduce((s, v) => s + v, 0);

  let equity = 0, peak = 0, maxDD = 0, streak = 0, maxStreak = 0;
  for (const v of r) {
    equity += v;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    streak = v <= 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }

  const outcomes = {};
  for (const t of trades) outcomes[t.outcome] = (outcomes[t.outcome] || 0) + 1;

  const sd = std(r);
  const tStat = sd > 0 ? mean(r) / (sd / Math.sqrt(r.length)) : null;
  const [ciLow, ciHigh] = bootstrapCI(r);

  return {
    trades: r.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: r.length ? round((wins.length / r.length) * 100, 1) : null,
    avgWinR: round(mean(wins)),
    avgLossR: round(-mean(losses)),
    expectancyR: r.length ? round(mean(r)) : null,
    expectancyCI95: [round(ciLow), round(ciHigh)],
    tStat: round(tStat, 2),
    totalR: round(equity, 2),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? Infinity : null),
    maxDrawdownR: round(maxDD, 2),
    maxLosingStreak: maxStreak,
    outcomes
  };
}

/**
 * Verdict onest, pe baza dovezilor statistice — nu pe baza win rate-ului.
 */
function verdict(m) {
  if (!m.trades || m.trades < 30) return 'INSUFICIENT: sub 30 de tranzacții, rezultatul nu înseamnă nimic statistic. Mai multe date (CSV pe ani) sau mai multe simboluri.';
  const [lo, hi] = m.expectancyCI95;
  if (lo > 0) return 'EDGE POZITIV SEMNIFICATIV: și limita de jos a intervalului de încredere 95% e peste 0. Următorul pas: forward-test pe demo câteva săptămâni.';
  if (hi < 0) return 'EDGE NEGATIV: strategia pierde semnificativ după costuri. Nu o folosi cu bani reali.';
  if (m.expectancyR > 0) return 'NEDOVEDIT: expectancy pozitiv, dar intervalul de încredere include 0. Poate fi noroc. Ai nevoie de mai multe date.';
  return 'FĂRĂ EDGE: expectancy ≤ 0 după costuri. Nu o folosi cu bani reali.';
}

module.exports = { computeMetrics, verdict, bootstrapCI, rng, mean, std };
