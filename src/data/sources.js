'use strict';

const { getJson } = require('./http');
const { M15_MS } = require('../core/candles');

/**
 * Adaptoare pentru surse publice gratuite. Fiecare funcție întoarce date normalizate sau aruncă eroare.
 * Lumânările întoarse sunt DOAR cele ÎNCHISE la momentul `now` (lumânarea în formare este eliminată),
 * exact ca în backtest — altfel live și backtest ar vedea date diferite.
 */

function closedOnly(candles, now) {
  return candles.filter((c) => c.timestamp + M15_MS <= now);
}

// ------------------------------------------------------------------ Swissquote (spot FX & aur, bid/ask)
async function swissquoteSpot(instrumentId) {
  const data = await getJson(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${instrumentId}`);
  if (!Array.isArray(data) || !data.length) throw new Error(`SWISSQUOTE_EMPTY ${instrumentId}`);
  // Alegem cel mai strâns spread disponibil (profilul cel mai apropiat de un cont ECN)
  let best = null;
  for (const platform of data) {
    for (const p of platform.spreadProfilePrices || []) {
      if (Number.isFinite(p.bid) && Number.isFinite(p.ask) && p.ask >= p.bid && (!best || p.ask - p.bid < best.ask - best.bid)) {
        best = { bid: p.bid, ask: p.ask, ts: platform.ts };
      }
    }
  }
  if (!best) throw new Error(`SWISSQUOTE_NO_PRICES ${instrumentId}`);
  return { bid: best.bid, ask: best.ask, timestamp: Number.isFinite(best.ts) ? best.ts : Date.now() };
}

// ------------------------------------------------------------------ Binance (crypto: spot + lumânări)
/**
 * Adrese Binance pentru date publice, în ordinea preferinței. api.binance.com e blocat din unele țări
 * (ex. serverele GitHub din SUA, HTTP 451); data-api.binance.vision este endpoint-ul oficial doar pentru
 * date de piață. Se reține ultima adresă care a funcționat.
 */
const BINANCE_HOSTS = (process.env.BINANCE_HOSTS || 'https://api.binance.com,https://data-api.binance.vision,https://api1.binance.com,https://api.binance.us')
  .split(',').map((h) => h.trim()).filter(Boolean);
let binanceHostIdx = 0;

async function binanceGet(pathAndQuery) {
  let lastErr;
  for (let k = 0; k < BINANCE_HOSTS.length; k++) {
    const idx = (binanceHostIdx + k) % BINANCE_HOSTS.length;
    try {
      const res = await getJson(`${BINANCE_HOSTS[idx]}${pathAndQuery}`, { retries: 1 });
      binanceHostIdx = idx;
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function binanceSpot(symbol) {
  const d = await binanceGet(`/api/v3/ticker/bookTicker?symbol=${symbol}`);
  const bid = parseFloat(d.bidPrice), ask = parseFloat(d.askPrice);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error(`BINANCE_BAD_TICKER ${symbol}`);
  return { bid, ask, timestamp: Date.now() };
}

function binanceRowsToCandles(rows) {
  return rows.map((r) => ({ timestamp: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
}

async function binanceCandles(symbol, { limit = 500, now = Date.now() } = {}) {
  const rows = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=15m&limit=${Math.min(1000, limit)}`);
  return closedOnly(binanceRowsToCandles(rows), now);
}

/** Istoric lung, paginat înapoi în timp (pentru backtest). */
async function binanceHistory(symbol, days, now = Date.now()) {
  const target = Math.ceil(days * 96);
  let endTime = now;
  let all = [];
  while (all.length < target) {
    const rows = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=15m&limit=1000&endTime=${endTime}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = binanceRowsToCandles(rows).concat(all);
    endTime = rows[0][0] - 1;
    if (rows.length < 1000) break;
  }
  return closedOnly(all, now);
}

/** Lumânări pe orice interval (ex. '4h'), de la startTs până acum, paginat. Doar lumânări închise. */
async function binanceKlines(symbol, interval, { startTs, limit = 1000, now = Date.now() } = {}) {
  const ms = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 }[interval];
  let all = [];
  if (startTs === undefined) {
    const rows = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    all = binanceRowsToCandles(rows);
  } else {
    let start = startTs;
    for (let p = 0; p < 200; p++) {
      const rows = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${start}`);
      if (!Array.isArray(rows) || !rows.length) break;
      all = all.concat(binanceRowsToCandles(rows));
      start = rows[rows.length - 1][0] + 1;
      if (rows.length < 1000) break;
    }
  }
  return all.filter((c) => c.timestamp + ms <= now);
}

// ------------------------------------------------------------------ Yahoo Finance (FX & aur: lumânări)
async function yahooCandles(ticker, { range = '5d', now = Date.now() } = {}) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=15m&range=${range}`);
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !Array.isArray(res.timestamp)) throw new Error(`YAHOO_EMPTY ${ticker}`);
  const q = res.indicators.quote[0];
  const out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      out.push({ timestamp: res.timestamp[i] * 1000, open: o, high: h, low: l, close: c, volume: q.volume && Number.isFinite(q.volume[i]) ? q.volume[i] : 0 });
    }
  }
  return closedOnly(out, now);
}

// ------------------------------------------------------------------ ForexFactory (calendar economic)
async function forexFactoryCalendar() {
  const d = await getJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  if (!Array.isArray(d)) throw new Error('FF_CALENDAR_INVALID');
  return d
    .filter((e) => e && e.impact === 'High')
    .map((e) => ({ title: e.title, currency: e.country, impact: 'HIGH', timestamp: Date.parse(e.date) }))
    .filter((e) => Number.isFinite(e.timestamp));
}

module.exports = { binanceGet, BINANCE_HOSTS, binanceKlines, swissquoteSpot, binanceSpot, binanceCandles, binanceHistory, yahooCandles, forexFactoryCalendar, closedOnly };
