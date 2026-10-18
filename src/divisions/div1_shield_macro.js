'use strict';

const { M15_MS } = require('../core/candles');

const ok = (extra = {}) => Object.assign({ status: 'OK', approved: true, veto: false, score: 0 }, extra);
const veto = (reason, data = {}) => ({ status: 'OK', approved: false, veto: true, vetoReason: reason, score: 0, data });

function spreadPipsOf(md, inst) {
  if (Number.isFinite(md.spotAsk) && Number.isFinite(md.spotBid)) return (md.spotAsk - md.spotBid) / inst.pipSize;
  if (Number.isFinite(md.spreadPips)) return md.spreadPips;
  return NaN;
}

/** 1A — preț spot prezent, spread acceptabil, date proaspete (tick + lumânări). */
function branch1A_SpotSpreadGuard({ marketData: md, inst, config, now }) {
  const policy = config.executionPolicy || {};
  if (!md || !Number.isFinite(md.spotMid)) return veto('1A_MISSING_SPOT_PRICE');

  const spreadPips = spreadPipsOf(md, inst);
  if (!Number.isFinite(spreadPips) || spreadPips < 0) return veto('1A_INVALID_SPREAD', { spreadPips });

  const maxLatency = policy.maxSpotLatencyMs || 15000;
  const latencyMs = Math.max(0, now - (md.spotTimestamp || 0));
  if (latencyMs > maxLatency) return veto(`1A_SPOT_STALE(${latencyMs}ms > ${maxLatency}ms)`, { latencyMs });

  const m15 = md.m15Candles || [];
  if (m15.length === 0) return veto('1A_NO_CANDLES');
  const lastClose = m15[m15.length - 1].timestamp + M15_MS;
  const staleMin = (now - lastClose) / 60000;
  const maxStale = policy.maxCandleStalenessMinutes || 35;
  if (staleMin > maxStale) return veto(`1A_CANDLES_STALE(${staleMin.toFixed(0)}min > ${maxStale}min)`, { staleMin });

  if (spreadPips > inst.maxSpreadPips) {
    return veto(`1A_SPREAD_TOO_HIGH(${spreadPips.toFixed(2)} > ${inst.maxSpreadPips} pips)`, { spreadPips });
  }
  return ok({ data: { spotBid: md.spotBid, spotAsk: md.spotAsk, spotMid: md.spotMid, spreadPips: Number(spreadPips.toFixed(2)), latencyMs } });
}

/** 1B — doar în sesiunile lichide. FX/aur: Londra 07:00–11:30, NY 12:00–21:00 UTC, luni–vineri. Crypto: 06–23 UTC. */
function branch1B_SessionKillzoneFilter({ inst, now }) {
  const d = new Date(now);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const day = d.getUTCDay(); // 0 = duminică, 6 = sâmbătă
  const crypto = inst.category === 'INDICES_CRYPTO';

  if (crypto) {
    if (h >= 6 && h <= 23) return ok({ data: { session: 'CRYPTO_ACTIVE', utcHour: Number(h.toFixed(2)) } });
    return veto(`1B_CRYPTO_LOW_LIQUIDITY(UTC=${h.toFixed(2)})`, { utcHour: h });
  }
  if (day === 0 || day === 6) return veto('1B_FX_WEEKEND_CLOSED', { day });
  if (h >= 7 && h <= 11.5) return ok({ data: { session: 'LONDON_KILLZONE', utcHour: Number(h.toFixed(2)) } });
  if (h >= 12 && h <= 21) return ok({ data: { session: 'NEW_YORK_KILLZONE', utcHour: Number(h.toFixed(2)) } });
  return veto(`1B_OUTSIDE_KILLZONE(UTC=${h.toFixed(2)})`, { utcHour: h });
}

/**
 * 1C — blochează ±N minute în jurul știrilor cu impact mare pe valutele perechii (USD afectează tot).
 * Dacă feed-ul de știri e indisponibil (newsFeedAvailable === false) pe FX/aur → VETO (fail-closed).
 * newsFeedAvailable === undefined (backtest fără calendar istoric) → trece, marcat explicit în raport.
 */
function branch1C_RedFolderNewsBlocker({ marketData: md, inst, config, now }) {
  const policy = config.executionPolicy || {};
  const crypto = inst.category === 'INDICES_CRYPTO';
  if (md && md.newsFeedAvailable === false && !crypto && policy.requireNewsFeedForFx !== false) {
    return veto('1C_NEWS_FEED_UNAVAILABLE');
  }
  const events = (md && Array.isArray(md.newsEvents)) ? md.newsEvents : [];
  const windowMs = (policy.newsBlockMinutes || 30) * 60000;
  for (const ev of events) {
    const high = ev.impact === 'HIGH' || ev.impact === 'RED' || ev.impact === 'High';
    const affects = ev.currency === inst.baseCurrency || ev.currency === inst.quoteCurrency || ev.currency === 'USD';
    const diff = Math.abs(now - Number(ev.timestamp));
    if (high && affects && diff <= windowMs) {
      return veto(`1C_NEWS_BLOCK(${ev.title || ev.currency} în ${Math.round(diff / 60000)}m)`, { event: ev });
    }
  }
  return ok({ data: { newsChecked: events.length, newsFeed: md && md.newsFeedAvailable === undefined ? 'NOT_PROVIDED' : 'OK' } });
}

/**
 * 1D — Busola macro: direcția susținută de indicele USD sintetic (coș din perechile majore).
 * Fără date macro → NEUTRAL, 0 puncte (nu mai există puncte "gratis").
 * Punctele contează în scor DOAR dacă direcția susținută = direcția MTF (verificat în MarketStateBus).
 */
function branch1D_MacroUsdCompass({ marketData: md, inst }) {
  const bias = md && md.usdBias;
  let direction = 'NEUTRAL';
  if (bias === 'BULLISH_USD' || bias === 'BEARISH_USD') {
    if (inst.quoteCurrency === 'USD') direction = bias === 'BEARISH_USD' ? 'LONG' : 'SHORT';
    else if (inst.baseCurrency === 'USD') direction = bias === 'BULLISH_USD' ? 'LONG' : 'SHORT';
  }
  const supported = direction !== 'NEUTRAL';
  return {
    status: 'OK',
    direction,
    approved: supported,
    veto: false,
    score: supported ? 15 : 0,
    data: { usdBias: bias || 'UNKNOWN', usdStrengthPct: md && Number.isFinite(md.usdStrengthPct) ? md.usdStrengthPct : null, supportedDirection: direction }
  };
}

module.exports = {
  branch1A_SpotSpreadGuard,
  branch1B_SessionKillzoneFilter,
  branch1C_RedFolderNewsBlocker,
  branch1D_MacroUsdCompass,
  spreadPipsOf
};
