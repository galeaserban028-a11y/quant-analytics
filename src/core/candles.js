'use strict';

/**
 * Utilitare pentru lumânări OHLCV. Toate funcțiile sunt pure (fără efecte secundare).
 * Format normalizat: { timestamp(ms), open, high, low, close, volume }.
 */

function toNum(v, fallback = NaN) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Acceptă obiecte {open,high,...} / {o,h,l,c,v} sau array-uri Binance/Kraken. */
function parseCandle(c) {
  if (!c) return { timestamp: 0, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 };
  if (Array.isArray(c)) {
    const ts = toNum(c[0], 0);
    return {
      timestamp: ts < 1e12 ? ts * 1000 : ts,
      open: toNum(c[1]),
      high: toNum(c[2]),
      low: toNum(c[3]),
      close: toNum(c[4]),
      // Kraken: [t,o,h,l,c,vwap,volume,count]; Binance: [t,o,h,l,c,volume,...]
      volume: toNum(c.length >= 8 ? c[6] : c[5], 0)
    };
  }
  return {
    timestamp: toNum(c.timestamp !== undefined ? c.timestamp : c.time, 0),
    open: toNum(c.open !== undefined ? c.open : c.o),
    high: toNum(c.high !== undefined ? c.high : c.h),
    low: toNum(c.low !== undefined ? c.low : c.l),
    close: toNum(c.close !== undefined ? c.close : c.c),
    volume: toNum(c.volume !== undefined ? c.volume : c.v, 0)
  };
}

function isValidCandle(c) {
  return c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= c.low && c.high >= Math.min(c.open, c.close) && c.low <= Math.max(c.open, c.close);
}

/** Normalizează, elimină lumânările invalide și sortează cronologic (fără duplicate). */
function normalizeCandles(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const r of raw) {
    const c = parseCandle(r);
    if (isValidCandle(c) && c.timestamp > 0) seen.set(c.timestamp, c);
  }
  return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/** EMA standard, inițializată cu SMA pe primele `period` valori. */
function computeEMA(candles, period) {
  if (!Array.isArray(candles) || period <= 0 || candles.length < period) return NaN;
  let sma = 0;
  for (let i = 0; i < period; i++) sma += candles[i].close;
  let ema = sma / period;
  const k = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
  return ema;
}

function trueRange(curr, prev) {
  if (!prev) return curr.high - curr.low;
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
}

/** ATR simplu (media TR) pe ultimele `period` lumânări. */
function computeATR(candles, period) {
  if (!Array.isArray(candles) || candles.length < period + 1) return NaN;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) sum += trueRange(candles[i], candles[i - 1]);
  return sum / period;
}

/** Kaufman Efficiency Ratio: |mișcare netă| / suma mișcărilor. 1 = trend curat, 0 = zgomot. */
function efficiencyRatio(candles, lookback) {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return NaN;
  const end = candles.length - 1;
  const net = Math.abs(candles[end].close - candles[end - lookback].close);
  let path = 0;
  for (let i = end - lookback + 1; i <= end; i++) path += Math.abs(candles[i].close - candles[i - 1].close);
  return path > 0 ? net / path : 0;
}

/**
 * Fractali 5-bar (swing high/low) confirmați: un swing la index i e confirmat doar când există i+2.
 */
function extractSwingStructure(candles, lookback = 30) {
  const len = candles.length;
  const start = Math.max(2, len - lookback);
  const highs = [];
  const lows = [];
  for (let i = start; i < len - 2; i++) {
    const c = candles[i];
    if (c.high >= candles[i - 1].high && c.high >= candles[i - 2].high && c.high >= candles[i + 1].high && c.high >= candles[i + 2].high) highs.push(c.high);
    if (c.low <= candles[i - 1].low && c.low <= candles[i - 2].low && c.low <= candles[i + 1].low && c.low <= candles[i + 2].low) lows.push(c.low);
  }
  if (highs.length >= 2 && lows.length >= 2) {
    return { prevHigh: highs[highs.length - 2], lastHigh: highs[highs.length - 1], prevLow: lows[lows.length - 2], lastLow: lows[lows.length - 1], method: 'FRACTAL' };
  }
  // Fallback: extreme pe cele două jumătăți ale ferestrei
  const mid = Math.floor((start + len) / 2);
  let h1 = -Infinity, h2 = -Infinity, l1 = Infinity, l2 = Infinity;
  for (let i = start; i < mid; i++) { h1 = Math.max(h1, candles[i].high); l1 = Math.min(l1, candles[i].low); }
  for (let i = mid; i < len; i++) { h2 = Math.max(h2, candles[i].high); l2 = Math.min(l2, candles[i].low); }
  return { prevHigh: h1, lastHigh: h2, prevLow: l1, lastLow: l2, method: 'HALF_WINDOW' };
}

/**
 * Agregă lumânări M15 în H1. Ultima lumânare H1 poate fi parțială (conține doar M15 deja închise) —
 * exact ce s-ar vedea live la momentul respectiv, deci fără look-ahead.
 */
function aggregate(candles, periodMs) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const bucket = Math.floor(c.timestamp / periodMs) * periodMs;
    if (!cur || cur.timestamp !== bucket) {
      cur = { timestamp: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume || 0;
    }
  }
  return out;
}

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;

module.exports = {
  parseCandle,
  isValidCandle,
  normalizeCandles,
  computeEMA,
  computeATR,
  trueRange,
  efficiencyRatio,
  extractSwingStructure,
  aggregate,
  M15_MS,
  H1_MS
};
