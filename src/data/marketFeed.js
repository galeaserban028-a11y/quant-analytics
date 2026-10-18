'use strict';

const sources = require('./sources');
const { aggregate, H1_MS } = require('../core/candles');
const { computeUsdBias } = require('./macro');

async function fetchSpot(spec) {
  if (spec.source === 'swissquote') return sources.swissquoteSpot(spec.id);
  if (spec.source === 'binance') return sources.binanceSpot(spec.id);
  throw new Error(`UNKNOWN_SPOT_SOURCE ${spec.source}`);
}

async function fetchCandles(spec, now) {
  if (spec.source === 'yahoo') return sources.yahooCandles(spec.id, { range: '5d', now });
  if (spec.source === 'binance') return sources.binanceCandles(spec.id, { limit: 600, now });
  throw new Error(`UNKNOWN_CANDLE_SOURCE ${spec.source}`);
}

/**
 * Construiește payload-ul de piață pentru un simbol: spot bid/ask + lumânări M15 închise + H1 agregate.
 * Dacă sursa lumânărilor diferă de cea a prețului spot (ex: aur futures vs aur spot) și `basisAdjust` e activ,
 * lumânările sunt translatate cu diferența (basis), ca nivelurile să fie în prețul brokerului.
 */
async function fetchSymbol(symbol, inst, now = Date.now()) {
  const [spot, rawM15] = await Promise.all([fetchSpot(inst.spot), fetchCandles(inst.candles, now)]);
  let m15 = rawM15;
  let basis = 0;
  if (inst.basisAdjust && m15.length) {
    const mid = (spot.bid + spot.ask) / 2;
    basis = mid - m15[m15.length - 1].close;
    m15 = m15.map((c) => ({ timestamp: c.timestamp, open: c.open + basis, high: c.high + basis, low: c.low + basis, close: c.close + basis, volume: c.volume }));
  }
  return {
    spotBid: spot.bid,
    spotAsk: spot.ask,
    spotMid: (spot.bid + spot.ask) / 2,
    spotTimestamp: spot.timestamp,
    m15Candles: m15,
    h1Candles: aggregate(m15, H1_MS),
    basisApplied: basis
  };
}

/**
 * Preia toate simbolurile + calendarul de știri + indicele USD. Un simbol care eșuează este raportat în `errors`
 * și NU primește date noi (ramura 1A îl va bloca pe motiv de date vechi — fail-closed).
 */
async function fetchAll(config, { now = Date.now(), newsCache } = {}) {
  const instruments = config.instruments;
  const payloads = {};
  const errors = {};
  for (const symbol of Object.keys(instruments)) {
    try {
      payloads[symbol] = await fetchSymbol(symbol, instruments[symbol], now);
    } catch (err) {
      errors[symbol] = err.message;
    }
  }

  let news = { available: false, events: [] };
  if (newsCache && newsCache.events && now - newsCache.fetchedAt < 3600e3) {
    news = { available: true, events: newsCache.events };
  } else {
    try {
      const events = await sources.forexFactoryCalendar();
      news = { available: true, events };
      if (newsCache) Object.assign(newsCache, { events, fetchedAt: now });
    } catch (err) {
      errors.__news = err.message;
    }
  }

  const macroCfg = config.macro || {};
  const h1BySymbol = {};
  for (const [s, p] of Object.entries(payloads)) h1BySymbol[s] = p.h1Candles;
  const macro = computeUsdBias(h1BySymbol, instruments, { lookback: macroCfg.usdBasketLookbackH1 || 20, thresholdPct: macroCfg.usdBiasThresholdPct || 0.1 });

  for (const p of Object.values(payloads)) {
    p.usdBias = macro.usdBias;
    p.usdStrengthPct = macro.usdStrengthPct;
    p.newsFeedAvailable = news.available;
    p.newsEvents = news.events;
  }
  return { payloads, errors, macro, news };
}

module.exports = { fetchSymbol, fetchAll };
