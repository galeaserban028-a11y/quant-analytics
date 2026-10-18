'use strict';

/**
 * Walk-forward: cum ar fi lucrat compania în realitate.
 *
 * Pentru fiecare fereastră:
 *   1. ANTRENARE (ex. 120 zile): simulează tranzacții-umbră pentru fiecare variantă de geometrie
 *      (stop minim în ATR, țintă TP2), face evaluarea agenților și propune promovări/retrogradări,
 *      apoi alege pragul de scor și pragul de cost care ar fi mers cel mai bine PE ANTRENARE.
 *      Dacă nicio variantă nu are rezultat pozitiv pe antrenare → compania NU tranzacționează în fereastra următoare.
 *   2. TEST (ex. 60 zile, date pe care selecția nu le-a văzut): rulează motorul real cu configurația aleasă.
 *   3. Se trece la fereastra următoare (se re-antrenează pe datele cele mai noi).
 *
 * Rezultatul out-of-sample (concatenarea ferestrelor de test) este singura cifră onestă despre performanță.
 */
const { runBacktest } = require('../backtest/engine');
const { computeMetrics } = require('../backtest/metrics');
const { scoreFeatures } = require('../core/scoring');
const { reviewAgents, proposePromotions } = require('./review');
const { applyOverrides } = require('../config');

const DAY = 24 * 3600e3;

const DEFAULT_GRID = {
  geometry: [
    { minRiskAtr: 0, tp2RiskReward: 3 },
    { minRiskAtr: 1, tp2RiskReward: 3 },
    { minRiskAtr: 2, tp2RiskReward: 3 },
    { minRiskAtr: 1, tp2RiskReward: 2 },
    { minRiskAtr: 2, tp2RiskReward: 2 }
  ],
  thresholds: [25, 40, 50, 65, 85],
  maxCost: [0.12, 0.18, 0.25]
};

function sliceData(dataBySymbol, from, to) {
  const out = {};
  for (const [s, c] of Object.entries(dataBySymbol)) {
    const part = c.filter((x) => x.timestamp >= from && x.timestamp < to);
    if (part.length > 300) out[s] = part;
  }
  return out;
}

/** Re-scorare rapidă a umbrelor pentru o combinație (prag, cost maxim, propunere). */
function selectShadows(shadows, cfg, maxCost) {
  const disabled = new Set(cfg.disabledSymbols || []);
  return shadows.filter((t) => {
    if (disabled.has(t.symbol)) return false;
    const f = t.meta.features;
    const vetoes = f.vetoes.filter((v) => v !== '4E');
    if (t.meta.costToRisk > maxCost) vetoes.push('4E');
    return scoreFeatures(Object.assign({}, f, { vetoes }), cfg).approved;
  });
}

function objective(m, minTrades) {
  if (!m.trades || m.trades < minTrades) return -Infinity;
  return m.expectancyR * Math.sqrt(m.trades); // ~ t-stat × σ: favorizează edge consistent pe eșantion mare
}

/**
 * @param {object} p
 * @param {Object<string,Array>} p.dataBySymbol lumânări M15 normalizate
 * @param {object} p.config config de bază
 * @param {object} [p.options] { trainDays, testDays, warmupDays, grid, minTrades, log }
 */
async function walkForward({ dataBySymbol, config, options = {} }) {
  const trainDays = options.trainDays || 120;
  const testDays = options.testDays || 60;
  const warmupDays = options.warmupDays || 5;
  const grid = options.grid || DEFAULT_GRID;
  const minTrades = options.minTrades || 20;
  const log = options.log || (() => {});

  let start = Infinity, end = -Infinity;
  for (const c of Object.values(dataBySymbol)) { start = Math.min(start, c[0].timestamp); end = Math.max(end, c[c.length - 1].timestamp); }

  const folds = [];
  const oosTrades = [];
  const baselineTrades = [];
  let lastChoice = null;

  for (let testStart = start + trainDays * DAY; testStart + 7 * DAY < end; testStart += testDays * DAY) {
    const testEnd = Math.min(end + 1, testStart + testDays * DAY);
    const train = sliceData(dataBySymbol, testStart - trainDays * DAY, testStart);
    const fold = { trainFrom: new Date(testStart - trainDays * DAY).toISOString(), testFrom: new Date(testStart).toISOString(), testTo: new Date(testEnd).toISOString() };
    log(`Fereastra ${folds.length + 1}: antrenare până la ${fold.testFrom.slice(0, 10)}, test până la ${fold.testTo.slice(0, 10)}`);

    // 1. Antrenare
    let best = null;
    for (const geo of grid.geometry) {
      const cfgGeo = applyOverrides(config, { executionPolicy: geo });
      const rep = await runBacktest({ dataBySymbol: train, config: cfgGeo, options: { shadow: true } });
      const review = reviewAgents(rep.shadowTrades, cfgGeo);
      const proposal = proposePromotions(review, cfgGeo);
      for (const th of grid.thresholds) {
        for (const mc of grid.maxCost) {
          const cfg = applyOverrides(cfgGeo, {
            scoringWeights: proposal.scoringWeights,
            advisoryFilters: proposal.advisoryFilters,
            disabledSymbols: proposal.disabledSymbols,
            executionPolicy: { confluenceThreshold: th, maxCostToRiskRatio: mc }
          });
          const m = computeMetrics(selectShadows(rep.shadowTrades, cfg, mc));
          const obj = objective(m, minTrades);
          if (!best || obj > best.obj) best = { obj, geo, th, mc, metrics: m, proposal, review, overrides: { executionPolicy: Object.assign({}, geo, { confluenceThreshold: th, maxCostToRiskRatio: mc }), scoringWeights: proposal.scoringWeights, advisoryFilters: proposal.advisoryFilters, disabledSymbols: proposal.disabledSymbols } };
        }
      }
    }
    const trade = best && best.obj > 0 && best.metrics.expectancyR > 0;
    fold.choice = best ? { geometry: best.geo, threshold: best.th, maxCost: best.mc, trainMetrics: best.metrics, moves: best.proposal.moves } : null;
    fold.decision = trade ? 'TRANZACȚIONEAZĂ' : 'STĂ PE LOC (fără edge pe antrenare)';
    lastChoice = best;

    // 2. Test out-of-sample
    const test = sliceData(dataBySymbol, testStart - warmupDays * DAY, testEnd);
    const testOpts = { tradeFromTs: testStart, tradeUntilTs: testEnd };
    if (trade) {
      const cfg = applyOverrides(config, best.overrides);
      const rep = await runBacktest({ dataBySymbol: test, config: cfg, options: testOpts });
      fold.oos = rep.overall;
      oosTrades.push(...rep.closedTrades);
    } else {
      fold.oos = computeMetrics([]);
    }
    const base = await runBacktest({ dataBySymbol: test, config, options: testOpts });
    fold.baselineOos = base.overall;
    baselineTrades.push(...base.closedTrades);
    log(`   → ${fold.decision}; OOS: ${fold.oos.trades} tranz., E=${fold.oos.expectancyR ?? '-'}R | baseline: ${fold.baselineOos.trades} tranz., E=${fold.baselineOos.expectancyR ?? '-'}R`);
    folds.push(fold);
  }

  return {
    folds,
    oos: computeMetrics(oosTrades),
    baselineOos: computeMetrics(baselineTrades),
    oosTrades,
    latest: lastChoice ? { overrides: lastChoice.overrides, trainMetrics: lastChoice.metrics, review: lastChoice.review, moves: lastChoice.proposal.moves, tradeable: lastChoice.obj > 0 && lastChoice.metrics.expectancyR > 0 } : null
  };
}

/**
 * Nivelul de validare al rezultatului out-of-sample:
 *   LIVE  — IC95% al expectancy-ului complet peste 0, cu ≥100 tranzacții (rar; doar atunci ai un edge demonstrat)
 *   DEMO  — expectancy > 0, peste baseline, cu ≥30 tranzacții → merită forward-test pe cont demo
 *   NIMIC — nu se aplică promovările
 */
function validationLevel(oos, baseline) {
  if (oos.trades >= 100 && oos.expectancyCI95[0] > 0) return 'LIVE';
  if (oos.trades >= 30 && oos.expectancyR > 0 && (baseline.expectancyR === null || oos.expectancyR > baseline.expectancyR)) return 'DEMO';
  return 'NIMIC';
}

module.exports = { walkForward, validationLevel, selectShadows, DEFAULT_GRID };
