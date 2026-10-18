'use strict';

/**
 * Formula de confluență — O SINGURĂ implementare, folosită de:
 *  - MarketStateBus (live și backtest),
 *  - laboratorul de cercetare (re-scorare rapidă a tranzacțiilor-umbră cu alte ponderi/praguri).
 *
 * Intrarea este un vector de "features" extras din rapoartele ramurilor:
 *   { direction, points: { mtf, sweep, orderBlock, fvg, premiumDiscount, displacement, macro }, redTeam, vetoes: [branchId...] }
 */

/** Agenții de scor și cheia lor din config.scoringWeights. */
const SCORING_AGENTS = {
  MTF: 'mtfAlignment',
  '3A': 'liquiditySweep',
  '3B': 'orderBlock',
  '3C': 'fairValueGap',
  '3E': 'premiumDiscount',
  '3D': 'displacement',
  '1D': 'macroCompass'
};
const FEATURE_KEY = { MTF: 'mtf', '3A': 'sweep', '3B': 'orderBlock', '3C': 'fvg', '3E': 'premiumDiscount', '3D': 'displacement', '1D': 'macro' };

/** Filtrele (ramuri cu drept de veto). Cele "protejate" nu pot fi trecute pe consultativ: protejează capitalul/datele. */
const FILTER_AGENTS = ['7A', '7B', '7C', '1A', '1B', '1C', '4A', '4B', '4C', '4D', '4E'];
const PROTECTED_FILTERS = new Set(['1A', '4A', '4C', '4D']);
/** Filtre care trebuie să aprobe explicit (nu doar să nu pună veto). */
const APPROVAL_REQUIRED = new Set(['1A', '1B', '1C', '4A', '4B', '4C', '4D', '4E']);

const DEFAULT_WEIGHTS = {
  mtfAlignment: 25,
  liquiditySweep: 25,
  orderBlock: 10,
  fairValueGap: 5,
  premiumDiscount: 5,
  displacement: 15,
  macroCompass: 15,
  devilsAdvocatePenalty: -25
};

function weightsOf(config) {
  return Object.assign({}, DEFAULT_WEIGHTS, (config && config.scoringWeights) || {});
}

/** Construiește features din rapoartele de pe bus (getReport = id => raport). */
function extractFeatures(getReport) {
  const mtf = getReport('MTF');
  const dir = mtf.direction === 'LONG' || mtf.direction === 'SHORT' ? mtf.direction : 'NEUTRAL';
  const same = (r) => Boolean(r.approved && r.direction === dir && dir !== 'NEUTRAL');
  const points = {
    mtf: Boolean(mtf.approved && !mtf.veto && dir !== 'NEUTRAL'),
    sweep: same(getReport('3A')),
    orderBlock: same(getReport('3B')),
    fvg: same(getReport('3C')),
    premiumDiscount: same(getReport('3E')),
    displacement: same(getReport('3D')),
    macro: same(getReport('1D'))
  };
  const vetoes = [];
  const vetoReasons = {};
  for (const id of FILTER_AGENTS.concat(['MTF'])) {
    const r = getReport(id);
    // Fail-closed: un filtru care lipsește sau a dat eroare contează ca veto
    const isVeto = r.veto || r.status === 'MISSING' || r.status === 'ERROR' || (APPROVAL_REQUIRED.has(id) && !r.approved);
    if (isVeto) { vetoes.push(id); vetoReasons[id] = r.vetoReason || `${id}_VETO`; }
  }
  if (!points.mtf && !vetoes.includes('MTF')) { vetoes.push('MTF'); vetoReasons.MTF = mtf.vetoReason || 'MTF_NO_DIRECTION'; }
  const r5B = getReport('5B');
  return { direction: dir, points, redTeam: r5B.score < 0, vetoes, vetoReasons };
}

/**
 * Calculează scorul din features.
 * @returns {{ finalScore, rawTotal, approved, vetoed, activeVetoes, advisoryVetoes, breakdown }}
 */
function scoreFeatures(f, config, extraVetoes = []) {
  const w = weightsOf(config);
  const threshold = ((config && config.executionPolicy) || {}).confluenceThreshold || 85;
  const advisory = new Set(((config && config.advisoryFilters) || []).filter((id) => !PROTECTED_FILTERS.has(id)));
  const antiInducement = !config || config.antiInducement !== false;

  const p = f.points;
  const pts = (flag, key) => (flag ? Math.max(0, w[key] || 0) : 0);
  const mtf = pts(p.mtf, 'mtfAlignment');
  const sweep = pts(p.sweep, 'liquiditySweep');
  const subAllowed = !antiInducement || sweep > 0;
  const ob = subAllowed ? pts(p.orderBlock, 'orderBlock') : 0;
  const fvg = subAllowed ? pts(p.fvg, 'fairValueGap') : 0;
  const pd = subAllowed ? pts(p.premiumDiscount, 'premiumDiscount') : 0;
  const disp = pts(p.displacement, 'displacement');
  const macro = pts(p.macro, 'macroCompass');
  const penalty = f.redTeam ? Math.min(0, w.devilsAdvocatePenalty || 0) : 0;
  const rawTotal = mtf + sweep + ob + fvg + pd + disp + macro + penalty;

  const all = Array.from(new Set(f.vetoes.concat(extraVetoes)));
  const activeVetoes = all.filter((id) => !advisory.has(id));
  const advisoryVetoes = all.filter((id) => advisory.has(id));
  const vetoed = activeVetoes.length > 0;
  const finalScore = vetoed ? 0 : Math.max(0, Math.min(100, rawTotal));
  return {
    finalScore,
    rawTotal,
    threshold,
    approved: !vetoed && f.direction !== 'NEUTRAL' && finalScore >= threshold,
    vetoed,
    activeVetoes,
    advisoryVetoes,
    breakdown: {
      mtfAlignment: mtf,
      liquiditySweep: sweep,
      orderBlock: ob,
      fairValueGap: fvg,
      premiumDiscount: pd,
      obFvgEquilibrium: ob + fvg + pd,
      antiInducementTriggered: antiInducement && sweep === 0,
      displacement: disp,
      macroCompass: macro,
      devilsAdvocatePenalty: penalty
    }
  };
}

module.exports = { SCORING_AGENTS, FEATURE_KEY, FILTER_AGENTS, PROTECTED_FILTERS, DEFAULT_WEIGHTS, weightsOf, extractFeatures, scoreFeatures };
