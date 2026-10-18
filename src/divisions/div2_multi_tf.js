'use strict';

const { computeEMA, extractSwingStructure } = require('../core/candles');

/**
 * MTF — Aliniere H1 (EMA50 + structură HH/HL sau LH/LL) cu M15 (BOS după impuls, sau flux peste/sub EMA20).
 * Aliniat → +25 și direcția LONG/SHORT. Conflict sau date insuficiente → VETO.
 */
function branchMTF_Alignment({ marketData: md }) {
  const h1 = (md && md.h1Candles) || [];
  const m15 = (md && md.m15Candles) || [];
  if (h1.length < 50 || m15.length < 25) {
    return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, veto: true, vetoReason: `MTF_INSUFFICIENT_CANDLES(H1=${h1.length},M15=${m15.length})` };
  }

  // H1
  const h1Ema50 = computeEMA(h1, 50);
  const h1Last = h1[h1.length - 1].close;
  const sw = extractSwingStructure(h1, 35);
  const hhhl = sw.lastHigh >= sw.prevHigh && sw.lastLow >= sw.prevLow;
  const lhll = sw.lastHigh <= sw.prevHigh && sw.lastLow <= sw.prevLow;
  let h1Direction = 'NEUTRAL';
  if (h1Last > h1Ema50 && (hhhl || h1Last > sw.prevHigh)) h1Direction = 'LONG';
  else if (h1Last < h1Ema50 && (lhll || h1Last < sw.prevLow)) h1Direction = 'SHORT';

  // M15: fereastra pre-impuls [len-15, len-5) vs impulsul recent [len-5, len)
  const len = m15.length;
  const ema20 = computeEMA(m15, 20);
  const last = m15[len - 1];
  let preHigh = -Infinity, preLow = Infinity;
  for (let i = len - 15; i < len - 5; i++) { preHigh = Math.max(preHigh, m15[i].high); preLow = Math.min(preLow, m15[i].low); }
  let maxClose = -Infinity, minClose = Infinity, minLow = Infinity, maxHigh = -Infinity;
  for (let i = len - 5; i < len; i++) {
    maxClose = Math.max(maxClose, m15[i].close); minClose = Math.min(minClose, m15[i].close);
    minLow = Math.min(minLow, m15[i].low); maxHigh = Math.max(maxHigh, m15[i].high);
  }
  const bullBos = maxClose > preHigh && last.low > minLow && (last.close >= last.open || last.close >= ema20);
  const bearBos = minClose < preLow && last.high < maxHigh && (last.close <= last.open || last.close <= ema20);

  let m15Direction = 'NEUTRAL';
  let m15Structure = 'CONSOLIDATION';
  if (bullBos && !bearBos) { m15Direction = 'LONG'; m15Structure = 'BULLISH_BOS'; }
  else if (bearBos && !bullBos) { m15Direction = 'SHORT'; m15Structure = 'BEARISH_BOS'; }
  else if (last.close > ema20 && last.close >= last.open) { m15Direction = 'LONG'; m15Structure = 'BULLISH_EMA20_FLOW'; }
  else if (last.close < ema20 && last.close <= last.open) { m15Direction = 'SHORT'; m15Structure = 'BEARISH_EMA20_FLOW'; }

  const data = { h1Direction, m15Direction, m15Structure, h1Ema50, m15Ema20: ema20, h1Swings: sw };
  if (h1Direction === 'NEUTRAL' || h1Direction !== m15Direction) {
    return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, veto: true, vetoReason: `MTF_CONFLICT(H1=${h1Direction},M15=${m15Direction})`, data };
  }
  return { status: 'OK', direction: h1Direction, score: 25, approved: true, veto: false, data };
}

module.exports = { branchMTF_Alignment };
