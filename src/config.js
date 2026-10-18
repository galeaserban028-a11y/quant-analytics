'use strict';

const fs = require('fs');
const path = require('path');

const BASE_PATH = path.join(__dirname, '..', 'config', 'agents_config.json');
const PROMOTIONS_PATH = path.join(__dirname, '..', 'config', 'promotions.json');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/**
 * Aplică peste config deciziile consiliului:
 *   { scoringWeights, advisoryFilters, disabledSymbols, executionPolicy, regimeFilter, smcDesk, trendDesk }
 */
function applyOverrides(config, overrides) {
  const c = clone(config);
  if (!overrides) return c;
  if (overrides.scoringWeights) c.scoringWeights = Object.assign({}, c.scoringWeights, overrides.scoringWeights);
  if (Array.isArray(overrides.advisoryFilters)) c.advisoryFilters = overrides.advisoryFilters.slice();
  if (Array.isArray(overrides.disabledSymbols)) c.disabledSymbols = overrides.disabledSymbols.slice();
  for (const key of ['executionPolicy', 'regimeFilter', 'smcDesk', 'trendDesk']) {
    if (overrides[key]) c[key] = Object.assign({}, c[key], overrides[key]);
  }
  return c;
}

/**
 * Config-ul efectiv = baza + secțiunile VALIDATE din config/promotions.json.
 * Format promotions.json: { smc: { validatedOOS, level, overrides, ... }, trend: { validatedOOS, level, overrides, ... } }
 * Un departament fără validare out-of-sample rămâne pe setările de bază (implicit: dezactivat).
 */
function loadConfig({ basePath = BASE_PATH, promotionsPath = PROMOTIONS_PATH, ignorePromotions = false } = {}) {
  let cfg = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  if (ignorePromotions || !fs.existsSync(promotionsPath)) return cfg;
  try {
    const p = JSON.parse(fs.readFileSync(promotionsPath, 'utf8'));
    for (const section of ['smc', 'trend']) {
      if (p[section] && p[section].validatedOOS && p[section].overrides) cfg = applyOverrides(cfg, p[section].overrides);
    }
    return cfg;
  } catch (_) {
    return cfg;
  }
}

/** Scrie o secțiune în promotions.json păstrând celelalte. */
function writePromotionSection(section, payload, promotionsPath = PROMOTIONS_PATH) {
  let current = {};
  if (fs.existsSync(promotionsPath)) {
    try { current = JSON.parse(fs.readFileSync(promotionsPath, 'utf8')); } catch (_) { current = {}; }
  }
  current[section] = payload;
  fs.writeFileSync(promotionsPath, JSON.stringify(current, null, 2));
  return current;
}

module.exports = { loadConfig, applyOverrides, writePromotionSection, BASE_PATH, PROMOTIONS_PATH };
