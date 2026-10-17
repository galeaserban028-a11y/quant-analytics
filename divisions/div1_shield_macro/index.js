const BaseForexAgent = require('../../core/BaseForexAgent');

/**
 * Helper universal pentru extragerea campurilor OHLCV (suporta atat obiecte {open,high,low,close,volume,timestamp}
 * cat si array-uri Kraken/Binance [timestamp, open, high, low, close, vwap, volume]).
 */
function parseCandle(c) {
  if (!c) return { timestamp: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };
  if (Array.isArray(c)) {
    return {
      timestamp: Number(c[0]) * (Number(c[0]) < 1e12 ? 1000 : 1),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[6] !== undefined ? c[6] : c[5] || 0)
    };
  }
  return {
    timestamp: Number(c.timestamp || c.time || 0),
    open: parseFloat(c.open !== undefined ? c.open : c.o),
    high: parseFloat(c.high !== undefined ? c.high : c.h),
    low: parseFloat(c.low !== undefined ? c.low : c.l),
    close: parseFloat(c.close !== undefined ? c.close : c.c),
    volume: parseFloat(c.volume !== undefined ? c.volume : c.v || 0)
  };
}

/**
 * DIVIZIA 1: SCUT & MACRO (40 Agenti: Ramurile 1A, 1B, 1C, 1D)
 */
const Div1ShieldMacro = {
  /**
   * Ramura 1A (10 Agenti): Spot Price & Spread Calibrators (0-Delay)
   * Verifica latenta tick-ului Spot si daca spreadPips <= maxSpreadPips din config.
   */
  branch1A_SpotSpreadGuard: async ({ symbol, marketData, config }) => {
    const inst = (config.instruments && config.instruments[symbol]) || null;
    if (!inst || !marketData || marketData.spotMid === null || marketData.spotMid === undefined) {
      return {
        status: 'OK',
        approved: false,
        veto: true,
        vetoReason: '1A_MISSING_SPOT_PRICE',
        score: 0,
        data: {}
      };
    }

    const now = Date.now();
    const tickTimestamp = marketData.spotTimestamp || marketData.updatedAt || 0;
    const latencyMs = Math.max(0, now - tickTimestamp);
    const maxLatencyMs = 15000;

    const spreadPips = typeof marketData.spreadPips === 'number'
      ? marketData.spreadPips
      : Math.abs((marketData.spotAsk - marketData.spotBid) / inst.pipSize);

    if (latencyMs > maxLatencyMs) {
      return {
        status: 'OK',
        approved: false,
        veto: true,
        vetoReason: `1A_SPOT_DELAY_VETO(${latencyMs}ms > ${maxLatencyMs}ms)`,
        score: 0,
        data: { latencyMs, spreadPips }
      };
    }

    if (spreadPips > inst.maxSpreadPips) {
      return {
        status: 'OK',
        approved: false,
        veto: true,
        vetoReason: `1A_SPREAD_TOO_HIGH(${spreadPips.toFixed(2)} > ${inst.maxSpreadPips} pips)`,
        score: 0,
        data: { latencyMs, spreadPips, maxSpreadPips: inst.maxSpreadPips }
      };
    }

    return {
      status: 'OK',
      approved: true,
      veto: false,
      score: 0,
      data: {
        spotBid: marketData.spotBid,
        spotAsk: marketData.spotAsk,
        spotMid: marketData.spotMid,
        spreadPips: Number(spreadPips.toFixed(2)),
        latencyMs
      }
    };
  },

  /**
   * Ramura 1B (8 Agenti): Killzone & Session Filter (Londra 07:00-11:30 UTC / NY 12:00-21:00 UTC)
   */
  branch1B_SessionKillzoneFilter: async ({ symbol, marketData, config }) => {
    const inst = (config.instruments && config.instruments[symbol]) || {};
    const checkDate = marketData && marketData.referenceTime ? new Date(marketData.referenceTime) : new Date();
    const utcHour = checkDate.getUTCHours() + checkDate.getUTCMinutes() / 60;

    // Londra (07:00 - 11:30 UTC) si New York (12:00 - 21:00 UTC)
    const inLondonKillzone = utcHour >= 7.0 && utcHour <= 11.5;
    const inNyKillzone = utcHour >= 12.0 && utcHour <= 21.0;
    const isCrypto247 = inst.category === 'INDICES_CRYPTO' && (utcHour >= 6.0 && utcHour <= 23.0);

    const activeSession = inLondonKillzone
      ? 'LONDON_KILLZONE'
      : (inNyKillzone ? 'NEW_YORK_KILLZONE' : (isCrypto247 ? 'CRYPTO_ACTIVE_SESSION' : 'ASIA_DEAD_ZONE'));

    if (activeSession === 'ASIA_DEAD_ZONE') {
      return {
        status: 'OK',
        approved: false,
        veto: true,
        vetoReason: `1B_OUTSIDE_KILLZONE(UTC_Hour=${utcHour.toFixed(2)})`,
        score: 0,
        data: { utcHour, activeSession }
      };
    }

    return {
      status: 'OK',
      approved: true,
      veto: false,
      score: 0,
      data: { utcHour: Number(utcHour.toFixed(2)), activeSession }
    };
  },

  /**
   * Ramura 1C (10 Agenti): Red-Folder News Blocker (CPI, NFP, FOMC in +/- 30 minute)
   */
  branch1C_RedFolderNewsBlocker: async ({ symbol, marketData, config }) => {
    const inst = (config.instruments && config.instruments[symbol]) || {};
    const events = (marketData && Array.isArray(marketData.newsEvents)) ? marketData.newsEvents : [];
    const now = (marketData && marketData.referenceTime) ? marketData.referenceTime : Date.now();
    const thirtyMinMs = 30 * 60 * 1000;

    for (const ev of events) {
      const isHighImpact = ev.impact === 'RED' || ev.impact === 'HIGH';
      const affectsPair = ev.currency === inst.baseCurrency || ev.currency === inst.quoteCurrency || ev.currency === 'USD';
      const timeDiff = Math.abs(now - Number(ev.timestamp));

      if (isHighImpact && affectsPair && timeDiff <= thirtyMinMs) {
        return {
          status: 'OK',
          approved: false,
          veto: true,
          vetoReason: `1C_RED_FOLDER_NEWS_BLOCK(${ev.title || ev.currency} in ${Math.round(timeDiff / 60000)}m)`,
          score: 0,
          data: { blockedByEvent: ev }
        };
      }
    }

    return {
      status: 'OK',
      approved: true,
      veto: false,
      score: 0,
      data: { newsClear: true, checkedEvents: events.length }
    };
  },

  /**
   * Ramura 1D (12 Agenti): Macro & DXY Compass (+15 Puncte daca sustine directia)
   */
  branch1D_MacroDxyCompass: async ({ symbol, marketData, config }) => {
    const inst = (config.instruments && config.instruments[symbol]) || {};
    const h1 = (marketData && marketData.h1Candles) || [];
    if (h1.length < 25) {
      return { status: 'OK', approved: false, veto: false, score: 0, data: { reason: 'INSUFFICIENT_H1_FOR_MACRO' } };
    }

    const lastIdx = h1.length - 1;
    const cNow = parseCandle(h1[lastIdx]).close;
    const cPrev10 = parseCandle(h1[lastIdx - 10]).close;
    const cPrev20 = parseCandle(h1[lastIdx - 20]).close;

    // Calculam impulsul macro (DXY / US10Y daca sunt furnizate, sau fluxul institucional H1 pe pereche)
    const dxyBias = marketData.dxyBias || null; // 'BULLISH_USD' | 'BEARISH_USD'
    const pairMomentum = ((cNow - cPrev10) / cPrev10) + ((cNow - cPrev20) / cPrev20);
    const inferredDirection = pairMomentum >= 0 ? 'LONG' : 'SHORT';

    let macroAligned = true;
    if (dxyBias) {
      if (inst.quoteCurrency === 'USD') {
        macroAligned = (inferredDirection === 'LONG' && dxyBias === 'BEARISH_USD') ||
                       (inferredDirection === 'SHORT' && dxyBias === 'BULLISH_USD');
      } else if (inst.baseCurrency === 'USD') {
        macroAligned = (inferredDirection === 'LONG' && dxyBias === 'BULLISH_USD') ||
                       (inferredDirection === 'SHORT' && dxyBias === 'BEARISH_USD');
      }
    }

    const score = macroAligned ? 15 : 0;
    return {
      status: 'OK',
      direction: inferredDirection,
      approved: macroAligned,
      veto: false,
      score,
      data: {
        dxyBias: dxyBias || 'AUTO_FLOW_ALIGNED',
        pairMomentumPct: Number((pairMomentum * 100).toFixed(3)),
        macroDirection: inferredDirection
      }
    };
  }
};

module.exports = { Div1ShieldMacro, parseCandle };
