'use strict';

const { spreadPipsOf } = require('./div1_shield_macro');
const { computeATR } = require('../core/candles');

const mtfDir = (bus, symbol) => bus.getBranchReport(symbol, 'MTF').direction;

/**
 * 4A — Geometria tranzacției (execuție la piață):
 *  - intrare: LONG la ASK, SHORT la BID;
 *  - SL dincolo de fitilul sweep-ului (3A) + spread + buffer, minim `minRiskPips`;
 *  - TP1/Trailing/TP2 la multipli R din config;
 *  - Protected BE = intrare ± (comision + extra) — acoperă costurile reale;
 *  4A doar CALCULEAZĂ. Judecata asupra costurilor e separată în 4E (ca să poată fi evaluată independent).
 */
function branch4A_RiskGeometry({ symbol, marketData: md, stateBus, config, inst }) {
  const policy = config.executionPolicy || {};
  const dir = mtfDir(stateBus, symbol);
  const m15 = (md && md.m15Candles) || [];
  if (m15.length < 15 || (dir !== 'LONG' && dir !== 'SHORT') || !Number.isFinite(md.spotMid)) {
    return { status: 'OK', direction: dir, score: 0, approved: false, veto: true, vetoReason: '4A_NO_DIRECTION_OR_SPOT' };
  }
  const pip = inst.pipSize;
  const dec = inst.decimals;
  const spreadPips = spreadPipsOf(md, inst);
  const spread = (Number.isFinite(spreadPips) ? spreadPips : inst.typicalSpreadPips || 0) * pip;
  const bid = Number.isFinite(md.spotBid) ? md.spotBid : md.spotMid - spread / 2;
  const ask = Number.isFinite(md.spotAsk) ? md.spotAsk : md.spotMid + spread / 2;
  const entry = dir === 'LONG' ? ask : bid;

  const r3A = stateBus.getBranchReport(symbol, '3A');
  let extreme = Number.isFinite(r3A.data && r3A.data.sweepWickExtreme) ? r3A.data.sweepWickExtreme : null;
  if (extreme === null) {
    extreme = dir === 'LONG' ? Infinity : -Infinity;
    for (let i = m15.length - 10; i < m15.length; i++) extreme = dir === 'LONG' ? Math.min(extreme, m15[i].low) : Math.max(extreme, m15[i].high);
  }

  const buffer = (policy.slBufferPips != null ? policy.slBufferPips : 1.5) * pip;
  // LONG: SL e nivel BID (sub fitil). SHORT: SL e nivel ASK (fitil BID + spread deasupra).
  let stopLoss = dir === 'LONG' ? extreme - buffer : extreme + spread + buffer;
  // Stop minim: max(minRiskPips, minRiskAtr × ATR14 M15). Un stop prea strâns face costurile să domine.
  const atr = computeATR(m15, 14);
  const minRisk = Math.max((policy.minRiskPips || 5) * pip, Number.isFinite(atr) ? (policy.minRiskAtr || 0) * atr : 0);
  if (dir === 'LONG' && entry - stopLoss < minRisk) stopLoss = entry - minRisk;
  if (dir === 'SHORT' && stopLoss - entry < minRisk) stopLoss = entry + minRisk;

  const risk = Math.abs(entry - stopLoss);
  const riskPips = risk / pip;
  const spreadToRisk = spread / risk;
  const sign = dir === 'LONG' ? 1 : -1;
  const commission = (inst.commissionPips || 0) * pip + (inst.commissionPct || 0) * entry;
  const costR = commission / risk;
  const totalCostToRisk = (spread + commission) / risk;
  const beOffset = commission + (policy.breakEvenExtraPips != null ? policy.breakEvenExtraPips : 0.5) * pip;
  const rr1 = policy.tp1RiskReward || 1.5;
  const rrTrail = policy.trailingLockRiskReward || 2.2;
  const rr2 = policy.tp2RiskReward || 3.0;
  const round = (v) => Number(v.toFixed(dec));

  return {
    status: 'OK',
    direction: dir,
    score: 0,
    approved: true,
    veto: false,
    data: {
      entry: round(entry),
      stopLoss: round(stopLoss),
      protectedBreakEven: round(entry + sign * beOffset),
      tp1: round(entry + sign * risk * rr1),
      trailingLock: round(entry + sign * risk * rrTrail),
      tp2: round(entry + sign * risk * rr2),
      riskPips: Number(riskPips.toFixed(1)),
      spreadPips: Number((spread / pip).toFixed(2)),
      spreadToRiskPct: Number((spreadToRisk * 100).toFixed(1)),
      spreadToRisk,
      totalCostToRisk,
      costR: Number(costR.toFixed(4)),
      rrTp1: rr1,
      rrTrail,
      rrTp2: rr2,
      sweepWickExtreme: extreme,
      spreadPrice: spread
    }
  };
}

/** 4B — Anti-chase: cât a plecat prețul din zona instituțională (OB/FVG) spre TP1. > max → VETO. */
function branch4B_AntiChase({ symbol, stateBus, config }) {
  const policy = config.executionPolicy || {};
  const maxRatio = policy.maxChaseRatioFromZone != null ? policy.maxChaseRatioFromZone : 0.15;
  const r4A = stateBus.getBranchReport(symbol, '4A');
  if (!r4A.approved) return { status: 'OK', approved: false, veto: true, vetoReason: r4A.vetoReason || '4B_NO_RISK_GEOMETRY' };
  const dir = r4A.direction;
  const { entry, tp1 } = r4A.data;
  const r3B = stateBus.getBranchReport(symbol, '3B');
  const r3C = stateBus.getBranchReport(symbol, '3C');
  let anchor = null;
  if (Number.isFinite(r3B.data.orderBlockHigh)) anchor = dir === 'LONG' ? r3B.data.orderBlockHigh : r3B.data.orderBlockLow;
  else if (Number.isFinite(r3C.data.fvgHigh)) anchor = dir === 'LONG' ? r3C.data.fvgHigh : r3C.data.fvgLow;
  if (anchor === null) {
    // Fără zonă instituțională nu avem de unde măsura — nu blocăm aici; scorul oricum va fi insuficient.
    return { status: 'OK', direction: dir, approved: true, veto: false, data: { chaseRatio: 0, anchor: null } };
  }
  const total = Math.max(1e-12, Math.abs(tp1 - anchor));
  const moved = dir === 'LONG' ? Math.max(0, entry - anchor) : Math.max(0, anchor - entry);
  const ratio = moved / total;
  if (ratio > maxRatio) {
    return { status: 'OK', direction: dir, approved: false, veto: true, vetoReason: `4B_ANTI_CHASE(${(ratio * 100).toFixed(1)}% > ${(maxRatio * 100).toFixed(0)}%)`, data: { chaseRatio: ratio, anchor } };
  }
  return { status: 'OK', direction: dir, approved: true, veto: false, data: { chaseRatio: Number(ratio.toFixed(4)), chasePct: Number((ratio * 100).toFixed(2)), anchor } };
}

/** 4C — o singură expunere pe valută (ex. nu EURUSD + GBPUSD simultan). */
function branch4C_CorrelationGuard({ symbol, stateBus }) {
  const check = stateBus.checkCurrencyCorrelationConflict(symbol);
  if (check.conflict) return { status: 'OK', approved: false, veto: true, vetoReason: check.reason, data: check };
  return { status: 'OK', approved: true, veto: false, data: { correlationClear: true } };
}

/** 4D — maxim N stop-loss-uri pe zi pe simbol. */
function branch4D_DailyDrawdown({ symbol, stateBus, config }) {
  const max = (config.executionPolicy || {}).maxDailySlPerSymbol || 2;
  const n = stateBus.getDailySlCount(symbol);
  if (n >= max) return { status: 'OK', approved: false, veto: true, vetoReason: `4D_DAILY_SL_LIMIT(${n}/${max})`, data: { slCount: n, max } };
  return { status: 'OK', approved: true, veto: false, data: { slCount: n, max } };
}

/**
 * 4E — Cost Guard: blochează tranzacțiile unde spread-ul sau costul total (spread + comision) mănâncă
 * prea mult din risc. Un SL strâns pe M15 cu comision de 0.15% poate pierde 30–50% din R doar din costuri.
 */
function branch4E_CostGuard({ symbol, stateBus, config }) {
  const policy = config.executionPolicy || {};
  const r4A = stateBus.getBranchReport(symbol, '4A');
  if (!r4A.approved) return { status: 'OK', approved: false, veto: true, vetoReason: r4A.vetoReason || '4E_NO_RISK_GEOMETRY' };
  const { spreadToRisk, totalCostToRisk } = r4A.data;
  const maxSpread = policy.maxSpreadToRiskRatio || 0.18;
  const maxCost = policy.maxCostToRiskRatio || 0.25;
  const data = { spreadToRisk, totalCostToRisk };
  if (spreadToRisk > maxSpread) return { status: 'OK', approved: false, veto: true, vetoReason: `4E_SPREAD_TO_SL_TOO_HIGH(${(spreadToRisk * 100).toFixed(1)}% > ${(maxSpread * 100).toFixed(0)}%)`, data };
  if (totalCostToRisk > maxCost) return { status: 'OK', approved: false, veto: true, vetoReason: `4E_COST_TO_RISK_TOO_HIGH(${(totalCostToRisk * 100).toFixed(1)}% > ${(maxCost * 100).toFixed(0)}%)`, data };
  return { status: 'OK', approved: true, veto: false, data };
}

module.exports = { branch4E_CostGuard, branch4A_RiskGeometry, branch4B_AntiChase, branch4C_CorrelationGuard, branch4D_DailyDrawdown };
