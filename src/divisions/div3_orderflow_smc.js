'use strict';

const mtfDir = (bus, symbol) => bus.getBranchReport(symbol, 'MTF').direction;
const none = (data = {}) => ({ status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, veto: false, data });

/** Prețul de referință curent: mid-ul spot, altfel ultimul close. */
function spotOf(md, m15) {
  return Number.isFinite(md.spotMid) ? md.spotMid : m15[m15.length - 1].close;
}

/**
 * 3A — Liquidity sweep: în ultimele 15 lumânări, un fitil a trecut de extrema pool-ului anterior
 * (lumânările [len-35, len-15)) iar lumânarea a ÎNCHIS înapoi în interiorul range-ului.
 * Punctează doar sweep-ul în direcția MTF (sell-side sweep pt LONG, buy-side pt SHORT).
 */
function branch3A_LiquiditySweep({ symbol, marketData: md, stateBus }) {
  const m15 = (md && md.m15Candles) || [];
  if (m15.length < 35) return none({ reason: 'INSUFFICIENT_M15' });
  const len = m15.length;
  const dir = mtfDir(stateBus, symbol);

  let poolLow = Infinity, poolHigh = -Infinity;
  for (let i = len - 35; i < len - 15; i++) { poolLow = Math.min(poolLow, m15[i].low); poolHigh = Math.max(poolHigh, m15[i].high); }

  let bull = null; // { index, extreme }
  let bear = null;
  for (let i = len - 15; i < len; i++) {
    const c = m15[i];
    if (c.low < poolLow && c.close >= poolLow) bull = { index: i, extreme: bull ? Math.min(bull.extreme, c.low) : c.low };
    if (c.high > poolHigh && c.close <= poolHigh) bear = { index: i, extreme: bear ? Math.max(bear.extreme, c.high) : c.high };
  }

  if (dir === 'LONG' && bull) {
    return { status: 'OK', direction: 'LONG', score: 25, approved: true, veto: false, data: { sweepType: 'SELL_SIDE_LIQUIDITY', poolLevel: poolLow, sweepWickExtreme: bull.extreme, sweepCandleIndex: bull.index } };
  }
  if (dir === 'SHORT' && bear) {
    return { status: 'OK', direction: 'SHORT', score: 25, approved: true, veto: false, data: { sweepType: 'BUY_SIDE_LIQUIDITY', poolLevel: poolHigh, sweepWickExtreme: bear.extreme, sweepCandleIndex: bear.index } };
  }
  return none({ sweepType: 'NONE_OR_UNALIGNED', poolLow, poolHigh });
}

function sweepGate(stateBus, symbol) {
  const r = stateBus.getBranchReport(symbol, '3A');
  return r.approved && r.score > 0 ? r : null;
}

/** 3B — Order Block: ultima lumânare opusă înaintea unei lumânări care închide dincolo de ea; prețul retestează zona. */
function branch3B_OrderBlock({ symbol, marketData: md, stateBus }) {
  const r3A = sweepGate(stateBus, symbol);
  if (!r3A) return none({ reason: 'ANTI_INDUCEMENT_NO_SWEEP' });
  const m15 = md.m15Candles || [];
  if (m15.length < 20) return none();
  const len = m15.length;
  const dir = r3A.direction;
  const spot = spotOf(md, m15);

  let zone = null;
  for (let i = len - 15; i < len - 1; i++) {
    const c = m15[i], n = m15[i + 1];
    if (dir === 'LONG' && c.close < c.open && n.close > c.high) zone = { low: c.low, high: c.high, source: 'BEARISH_OB' };
    if (dir === 'SHORT' && c.close > c.open && n.close < c.low) zone = { low: c.low, high: c.high, source: 'BULLISH_OB' };
  }
  if (!zone) {
    const idx = r3A.data.sweepCandleIndex;
    const sc = m15[Math.max(0, Math.min(len - 1, idx))];
    zone = { low: sc.low, high: sc.high, source: 'SWEEP_CANDLE' };
  }
  const tol = Math.max(1e-12, zone.high - zone.low) * 0.35;
  const inZone = spot >= zone.low - tol && spot <= zone.high + tol;
  return { status: 'OK', direction: dir, score: inZone ? 10 : 0, approved: inZone, veto: false, data: { orderBlockLow: zone.low, orderBlockHigh: zone.high, zoneSource: zone.source, inMitigation: inZone } };
}

/** 3C — Fair Value Gap între lumânarea i-2 și i, în ultimele 12 lumânări; prețul îl testează. */
function branch3C_FairValueGap({ symbol, marketData: md, stateBus }) {
  const r3A = sweepGate(stateBus, symbol);
  if (!r3A) return none({ reason: 'ANTI_INDUCEMENT_NO_SWEEP' });
  const m15 = md.m15Candles || [];
  if (m15.length < 15) return none();
  const len = m15.length;
  const dir = r3A.direction;
  const spot = spotOf(md, m15);

  let fvg = null;
  for (let i = len - 12; i < len; i++) {
    const a = m15[i - 2], c = m15[i];
    if (dir === 'LONG' && c.low > a.high) fvg = { low: a.high, high: c.low };
    if (dir === 'SHORT' && c.high < a.low) fvg = { low: c.high, high: a.low };
  }
  if (!fvg) return { status: 'OK', direction: dir, score: 0, approved: false, veto: false, data: { fvgFound: false } };
  const buf = (fvg.high - fvg.low) * 1.25;
  const testing = spot >= fvg.low - buf && spot <= fvg.high + buf;
  return { status: 'OK', direction: dir, score: testing ? 5 : 0, approved: testing, veto: false, data: { fvgFound: true, fvgLow: fvg.low, fvgHigh: fvg.high, testingFvg: testing } };
}

/** 3E — Premium/Discount: LONG doar sub 50% din range-ul ultimelor 30 lumânări, SHORT doar peste. */
function branch3E_PremiumDiscount({ symbol, marketData: md, stateBus }) {
  const r3A = sweepGate(stateBus, symbol);
  if (!r3A) return none({ reason: 'ANTI_INDUCEMENT_NO_SWEEP' });
  const m15 = md.m15Candles || [];
  if (m15.length < 30) return none();
  const len = m15.length;
  const dir = r3A.direction;
  const spot = spotOf(md, m15);
  let hi = -Infinity, lo = Infinity;
  for (let i = len - 30; i < len; i++) { hi = Math.max(hi, m15[i].high); lo = Math.min(lo, m15[i].low); }
  const eq = (hi + lo) / 2;
  const good = (dir === 'LONG' && spot <= eq) || (dir === 'SHORT' && spot >= eq);
  return { status: 'OK', direction: dir, score: good ? 5 : 0, approved: good, veto: false, data: { rangeLow: lo, rangeHigh: hi, equilibrium50: eq, zone: spot <= eq ? 'DISCOUNT' : 'PREMIUM' } };
}

/**
 * 3D — Displacement: în ultimele 5 lumânări, volumul SAU corpul ≥ 1.8× media celor 20 anterioare,
 * iar lumânarea curentă confirmă direcția. Pe FX fără volum real, contează doar corpul.
 */
function branch3D_Displacement({ symbol, marketData: md, stateBus }) {
  const m15 = (md && md.m15Candles) || [];
  if (m15.length < 26) return none();
  const len = m15.length;
  const dir = mtfDir(stateBus, symbol);
  if (dir !== 'LONG' && dir !== 'SHORT') return none({ reason: 'NO_MTF_DIRECTION' });

  let sumVol = 0, sumBody = 0;
  for (let i = len - 25; i < len - 5; i++) { sumVol += m15[i].volume || 0; sumBody += Math.abs(m15[i].close - m15[i].open); }
  const avgVol = sumVol / 20, avgBody = sumBody / 20;
  let maxVol = 0, maxBody = 0;
  for (let i = len - 5; i < len; i++) {
    if (avgVol > 0) maxVol = Math.max(maxVol, (m15[i].volume || 0) / avgVol);
    if (avgBody > 0) maxBody = Math.max(maxBody, Math.abs(m15[i].close - m15[i].open) / avgBody);
  }
  const l = m15[len - 1];
  const lowerWick = Math.min(l.open, l.close) - l.low;
  const upperWick = l.high - Math.max(l.open, l.close);
  const confirms = dir === 'LONG' ? (l.close >= l.open || lowerWick > upperWick) : (l.close <= l.open || upperWick > lowerWick);
  const ok = (maxVol >= 1.8 || maxBody >= 1.8) && confirms;
  return { status: 'OK', direction: dir, score: ok ? 15 : 0, approved: ok, veto: false, data: { maxVolRatio: Number(maxVol.toFixed(2)), maxBodyRatio: Number(maxBody.toFixed(2)), volumeAvailable: avgVol > 0, confirms } };
}

module.exports = {
  branch3A_LiquiditySweep,
  branch3B_OrderBlock,
  branch3C_FairValueGap,
  branch3E_PremiumDiscount,
  branch3D_Displacement
};
