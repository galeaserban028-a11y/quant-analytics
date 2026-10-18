'use strict';

/**
 * Evaluarea anuală de performanță a fiecărui agent („performance review”), pe tranzacțiile-umbră.
 *
 * Pentru agenții de SCOR: lift = E[R | agentul a votat DA] − E[R | agentul a votat NU].
 * Pentru FILTRE: diferența dintre tranzacțiile lăsate să treacă și cele blocate de filtru.
 * Toate diferențele vin cu interval de încredere 95% (bootstrap), ca să nu promovăm noroc.
 *
 * Grade:
 *   PROMOVAT       — contribuție pozitivă semnificativă (limita de jos a IC > 0)
 *   RETROGRADAT    — contribuție negativă semnificativă (limita de sus a IC < 0)
 *   STABIL         — fără efect demonstrat în nicio direcție
 *   DATE_PUTINE    — sub pragul minim de observații; rămâne pe poziție
 */
const { rng, mean } = require('../backtest/metrics');
const { SCORING_AGENTS, FEATURE_KEY, FILTER_AGENTS, PROTECTED_FILTERS, weightsOf } = require('../core/scoring');

const AGENT_NAMES = {
  MTF: 'Multi-Timeframe H1+M15', '3A': 'Liquidity Sweep', '3B': 'Order Block', '3C': 'Fair Value Gap', '3E': 'Premium/Discount',
  '3D': 'Displacement', '1D': 'Macro USD Compass', '5B': "Devil's Advocate",
  '7A': 'Dead-Market & Lockout', '7B': 'Performance Breaker', '7C': 'Regime Filter', '1A': 'Spot & Spread Guard',
  '1B': 'Session Killzone', '1C': 'News Blocker', '4A': 'Risk Geometry', '4B': 'Anti-Chase', '4C': 'Correlation Guard',
  '4D': 'Daily Drawdown', '4E': 'Cost Guard'
};

/** IC 95% bootstrap pentru diferența de medii între două grupuri. */
function diffCI(a, b, iterations = 1500, seed = 7) {
  if (a.length < 2 || b.length < 2) return [null, null];
  const r = rng(seed);
  const diffs = [];
  for (let it = 0; it < iterations; it++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(r() * a.length)];
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(r() * b.length)];
    diffs.push(sa / a.length - sb / b.length);
  }
  diffs.sort((x, y) => x - y);
  return [diffs[Math.floor(0.025 * iterations)], diffs[Math.floor(0.975 * iterations)]];
}

const r3 = (v) => (v === null || !Number.isFinite(v) ? v : Number(v.toFixed(3)));

function grade(ci, nA, nB, minN) {
  if (nA < minN || nB < minN) return 'DATE_PUTINE';
  if (ci[0] > 0) return 'PROMOVAT';
  if (ci[1] < 0) return 'RETROGRADAT';
  return 'STABIL';
}

/**
 * @param {Array} shadows tranzacții-umbră închise (cu meta.features)
 * @param {object} config
 * @param {object} [opts] { minN }
 */
function reviewAgents(shadows, config, opts = {}) {
  const minN = opts.minN || 30;
  const all = shadows.filter((t) => t.meta && t.meta.features && Number.isFinite(t.resultR));
  // Evaluare în context: un agent de scor e judecat doar pe tranzacțiile pe care compania le-ar fi putut face
  // (niciun filtru activ nu le-a blocat). Un filtru e judecat pe tranzacțiile neblocate de CELELALTE filtre.
  const advisory = new Set(config.advisoryFilters || []);
  const activeVetoes = (t, except) => t.meta.features.vetoes.filter((v) => v !== except && v !== 'MTF' && !advisory.has(v));
  const contextual = opts.contextual !== false;
  const usable = contextual ? all.filter((t) => activeVetoes(t, null).length === 0) : all;
  const universeFor = (id) => (contextual ? all.filter((t) => activeVetoes(t, id).length === 0) : all);
  const R = (list) => list.map((t) => t.resultR);
  const agents = [];

  // Agenți de scor
  for (const [id, key] of Object.entries(SCORING_AGENTS)) {
    if (id === 'MTF') continue; // toate umbrele au MTF aliniat (e condiția de existență a umbrei)
    const fk = FEATURE_KEY[id];
    const yes = usable.filter((t) => t.meta.features.points[fk]);
    const no = usable.filter((t) => !t.meta.features.points[fk]);
    const ci = diffCI(R(yes), R(no));
    agents.push({
      id, name: AGENT_NAMES[id], department: 'SCOR', weightKey: key,
      nYes: yes.length, nNo: no.length,
      expectancyYes: r3(yes.length ? mean(R(yes)) : null), expectancyNo: r3(no.length ? mean(R(no)) : null),
      lift: r3(yes.length && no.length ? mean(R(yes)) - mean(R(no)) : null), liftCI95: ci.map(r3),
      grade: grade(ci, yes.length, no.length, minN)
    });
  }
  // Red team (penalizare): „lift” = cât de proaste sunt tranzacțiile penalizate față de restul
  {
    const pen = usable.filter((t) => t.meta.features.redTeam);
    const rest = usable.filter((t) => !t.meta.features.redTeam);
    const ci = diffCI(R(rest), R(pen));
    agents.push({
      id: '5B', name: AGENT_NAMES['5B'], department: 'SCOR', weightKey: 'devilsAdvocatePenalty',
      nYes: pen.length, nNo: rest.length,
      expectancyYes: r3(pen.length ? mean(R(pen)) : null), expectancyNo: r3(rest.length ? mean(R(rest)) : null),
      lift: r3(pen.length && rest.length ? mean(R(rest)) - mean(R(pen)) : null), liftCI95: ci.map(r3),
      grade: grade(ci, pen.length, rest.length, minN)
    });
  }
  // Filtre
  for (const id of FILTER_AGENTS) {
    const uni = universeFor(id);
    const blocked = uni.filter((t) => t.meta.features.vetoes.includes(id));
    const passed = uni.filter((t) => !t.meta.features.vetoes.includes(id));
    const ci = diffCI(R(passed), R(blocked));
    agents.push({
      id, name: AGENT_NAMES[id], department: 'FILTRE', protected: PROTECTED_FILTERS.has(id),
      nBlocked: blocked.length, nPassed: passed.length,
      expectancyBlocked: r3(blocked.length ? mean(R(blocked)) : null), expectancyPassed: r3(passed.length ? mean(R(passed)) : null),
      // pozitiv = filtrul blochează tranzacții mai proaste decât cele lăsate să treacă (bun)
      lift: r3(blocked.length && passed.length ? mean(R(passed)) - mean(R(blocked)) : null), liftCI95: ci.map(r3),
      rSavedTotal: r3(-R(blocked).reduce((s, v) => s + v, 0)),
      grade: grade(ci, blocked.length, passed.length, minN)
    });
  }
  // Birourile pe instrumente: performanța tranzacțiilor care trec de filtre, per simbol
  const desks = [];
  const bySym = {};
  for (const t of usable) (bySym[t.symbol] = bySym[t.symbol] || []).push(t.resultR);
  for (const [sym, rs] of Object.entries(bySym)) {
    const others = usable.filter((t) => t.symbol !== sym).map((t) => t.resultR);
    const ci = diffCI(rs, rs.map(() => 0).slice(0, Math.max(2, rs.length)));
    desks.push({ symbol: sym, n: rs.length, expectancy: r3(mean(rs)), ci95: ci.map(r3), vsOthers: r3(others.length ? mean(rs) - mean(others) : null),
      grade: rs.length < minN ? 'DATE_PUTINE' : (ci[1] < 0 ? 'RETROGRADAT' : (ci[0] > 0 ? 'PROMOVAT' : 'STABIL')) });
  }
  return { candidates: all.length, tradable: usable.length, candidateExpectancy: r3(all.length ? mean(R(all)) : null), tradableExpectancy: r3(usable.length ? mean(R(usable)) : null), agents, desks };
}

/**
 * Propunerea „consiliului de administrație”: promovări (pondere ×1.5), retrogradări (pondere 0 → departamentul
 * Observație; filtrele neprotejate → Consultativ). Agenții cu date puține sau stabili rămân neschimbați.
 */
function proposePromotions(review, config) {
  const w = weightsOf(config);
  const weights = Object.assign({}, w);
  const advisory = new Set(config.advisoryFilters || []);
  const moves = [];
  for (const a of review.agents) {
    if (a.department === 'SCOR') {
      const key = a.weightKey;
      const old = w[key];
      if (a.grade === 'PROMOVAT') {
        weights[key] = Math.round(old * 1.5);
        moves.push({ id: a.id, name: a.name, from: old, to: weights[key], action: 'PROMOVAT (pondere ×1.5)' });
      } else if (a.grade === 'RETROGRADAT') {
        weights[key] = 0;
        moves.push({ id: a.id, name: a.name, from: old, to: 0, action: 'RETROGRADAT → departamentul Observație (pondere 0, continuă să fie evaluat)' });
      }
    } else if (a.department === 'FILTRE') {
      if (a.grade === 'RETROGRADAT' && !a.protected && !advisory.has(a.id)) {
        advisory.add(a.id);
        moves.push({ id: a.id, name: a.name, action: 'RETROGRADAT → departamentul Consultativ (veto-ul doar se raportează)' });
      } else if (a.grade === 'PROMOVAT' && advisory.has(a.id)) {
        advisory.delete(a.id);
        moves.push({ id: a.id, name: a.name, action: 'PROMOVAT înapoi în Filtre (veto activ)' });
      }
    }
  }
  const disabled = new Set(config.disabledSymbols || []);
  for (const d of review.desks || []) {
    if (d.grade === 'RETROGRADAT' && !disabled.has(d.symbol)) { disabled.add(d.symbol); moves.push({ id: d.symbol, name: `Biroul ${d.symbol}`, action: 'SUSPENDAT (expectancy negativ semnificativ) → rămâne în Observație' }); }
    if (d.grade === 'PROMOVAT' && disabled.has(d.symbol)) { disabled.delete(d.symbol); moves.push({ id: d.symbol, name: `Biroul ${d.symbol}`, action: 'REACTIVAT' }); }
  }
  return { scoringWeights: weights, advisoryFilters: Array.from(advisory), disabledSymbols: Array.from(disabled), moves };
}

module.exports = { reviewAgents, proposePromotions, diffCI, AGENT_NAMES };
