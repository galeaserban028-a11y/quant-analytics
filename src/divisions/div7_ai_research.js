'use strict';

const { trueRange, efficiencyRatio } = require('../core/candles');

/**
 * 7A — Lockout după limita de SL (aplicat efectiv până la `lockedUntil`) + piață moartă
 * (ATR14 / ATR50 pe M15 < 0.45 → VETO pe ciclul curent).
 */
function branch7A_DeadMarketGuard({ symbol, marketData: md, stateBus }) {
  const lock = stateBus.getLockout(symbol);
  if (lock) {
    return { status: 'OK', approved: false, veto: true, vetoReason: `7A_LOCKOUT_UNTIL_${new Date(lock.until).toISOString()}(${lock.reason})`, data: { lockedUntil: lock.until } };
  }
  const m15 = (md && md.m15Candles) || [];
  if (m15.length < 51) {
    return { status: 'OK', approved: false, veto: true, vetoReason: `7A_WARMUP(M15=${m15.length}<51)` };
  }
  const tr = [];
  for (let i = m15.length - 50; i < m15.length; i++) tr.push(trueRange(m15[i], m15[i - 1]));
  const atr50 = tr.reduce((s, v) => s + v, 0) / 50;
  const atr14 = tr.slice(-14).reduce((s, v) => s + v, 0) / 14;
  const ratio = atr50 > 0 ? atr14 / atr50 : 0;
  const data = { atr14, atr50, volatilityRatio: Number(ratio.toFixed(3)) };
  if (ratio < 0.45) return { status: 'OK', approved: false, veto: true, vetoReason: `7A_DEAD_MARKET(ATR ratio ${ratio.toFixed(2)} < 0.45)`, data };
  return { status: 'OK', approved: true, veto: false, data };
}

/**
 * 7B — Circuit-breaker pe performanță reală: dacă media R a ultimelor N tranzacții ÎNCHISE
 * pe simbol scade sub prag, simbolul e oprit. Aceasta este bucla reală de feedback post-trade.
 */
function branch7B_PerformanceBreaker({ symbol, stateBus, config }) {
  const cfg = config.performanceBreaker || {};
  if (cfg.enabled === false) return { status: 'OK', approved: true, veto: false, data: { enabled: false } };
  const recent = stateBus.recentClosedTrades(symbol, cfg.lookbackTrades || 10);
  const n = recent.length;
  const expectancy = n ? recent.reduce((s, t) => s + (t.resultR || 0), 0) / n : null;
  const data = { tradesConsidered: n, expectancyR: expectancy === null ? null : Number(expectancy.toFixed(3)) };
  if (n >= (cfg.minTrades || 6) && expectancy < (cfg.minExpectancyR != null ? cfg.minExpectancyR : -0.3)) {
    return { status: 'OK', approved: false, veto: true, vetoReason: `7B_PERFORMANCE_BREAKER(E=${expectancy.toFixed(2)}R pe ultimele ${n})`, data };
  }
  return { status: 'OK', approved: true, veto: false, data };
}

/**
 * 7C — Filtru de regim: Kaufman Efficiency Ratio pe H1. Sub prag = piață haotică (choppy) → VETO,
 * fiindcă strategia este de tip pullback în trend.
 */
function branch7C_RegimeFilter({ marketData: md, config }) {
  const cfg = config.regimeFilter || {};
  if (cfg.enabled === false) return { status: 'OK', approved: true, veto: false, data: { enabled: false } };
  const h1 = (md && md.h1Candles) || [];
  const lb = cfg.efficiencyLookbackH1 || 20;
  const er = efficiencyRatio(h1, lb);
  if (!Number.isFinite(er)) return { status: 'OK', approved: false, veto: true, vetoReason: `7C_WARMUP(H1=${h1.length})` };
  const min = cfg.minEfficiencyRatio != null ? cfg.minEfficiencyRatio : 0.12;
  const regime = er >= 0.3 ? 'TRENDING' : (er >= min ? 'MIXED' : 'CHOPPY');
  if (er < min) return { status: 'OK', approved: false, veto: true, vetoReason: `7C_CHOPPY_REGIME(ER=${er.toFixed(2)} < ${min})`, data: { efficiencyRatio: er, regime } };
  return { status: 'OK', approved: true, veto: false, data: { efficiencyRatio: Number(er.toFixed(3)), regime } };
}

module.exports = { branch7A_DeadMarketGuard, branch7B_PerformanceBreaker, branch7C_RegimeFilter };
