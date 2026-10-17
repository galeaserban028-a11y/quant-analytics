const { parseCandle } = require('../div1_shield_macro');

/**
 * Calcul EMA (Exponential Moving Average) pe lumânări normalizate OHLCV
 */
function computeEMA(parsedCandles, period) {
  if (!Array.isArray(parsedCandles) || parsedCandles.length < period || period <= 0) {
    return 0;
  }
  const k = 2 / (period + 1);
  let ema = parsedCandles[0].close;
  for (let i = 1; i < parsedCandles.length; i++) {
    ema = parsedCandles[i].close * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Extrage ultimele 2 Swing Highs și 2 Swing Lows (fractal 3-bar / 5-bar)
 * pentru determinarea structurii instituționale HH/HL (Bullish) sau LH/LL (Bearish).
 */
function extractSwingStructure(parsedCandles, lookback = 30) {
  const len = parsedCandles.length;
  const start = Math.max(2, len - lookback);
  const swingHighs = [];
  const swingLows = [];

  for (let i = start; i < len - 2; i++) {
    const prev2 = parsedCandles[i - 2];
    const prev1 = parsedCandles[i - 1];
    const curr = parsedCandles[i];
    const next1 = parsedCandles[i + 1];
    const next2 = parsedCandles[i + 2];

    if (curr.high >= prev1.high && curr.high >= prev2.high && curr.high >= next1.high && curr.high >= next2.high) {
      swingHighs.push({ index: i, price: curr.high, timestamp: curr.timestamp });
    }
    if (curr.low <= prev1.low && curr.low <= prev2.low && curr.low <= next1.low && curr.low <= next2.low) {
      swingLows.push({ index: i, price: curr.low, timestamp: curr.timestamp });
    }
  }

  // Fallback pe maxime/minime pe jumătăți de fereastră dacă piața e în impuls parabolic fără fractali intermediari
  if (swingHighs.length < 2 || swingLows.length < 2) {
    const mid = Math.floor(( start + (len - 1) ) / 2);
    let h1 = -Infinity, h2 = -Infinity, l1 = Infinity, l2 = Infinity;
    for (let i = start; i < mid; i++) {
      if (parsedCandles[i].high > h1) h1 = parsedCandles[i].high;
      if (parsedCandles[i].low < l1) l1 = parsedCandles[i].low;
    }
    for (let i = mid; i < len; i++) {
      if (parsedCandles[i].high > h2) h2 = parsedCandles[i].high;
      if (parsedCandles[i].low < l2) l2 = parsedCandles[i].low;
    }
    return {
      prevHigh: h1,
      lastHigh: h2,
      prevLow: l1,
      lastLow: l2
    };
  }

  return {
    prevHigh: swingHighs[swingHighs.length - 2].price,
    lastHigh: swingHighs[swingHighs.length - 1].price,
    prevLow: swingLows[swingLows.length - 2].price,
    lastLow: swingLows[swingLows.length - 1].price
  };
}

/**
 * Analizează alinierea Multi-Timeframe (H1 Trend + M15 BOS/CHoCH Entry)
 * Acordă +25 puncte dacă H1 și M15 sunt 100% aliniate.
 * Dacă sunt în conflict -> 0 puncte și VETO INSTANT!
 */
async function evaluateMultiTimeframe({ symbol, marketData, branchLabel }) {
  const rawH1 = (marketData && marketData.h1Candles) || [];
  const rawM15 = (marketData && marketData.m15Candles) || [];

  if (rawH1.length < 50 || rawM15.length < 25) {
    return {
      status: 'OK',
      direction: 'NEUTRAL',
      score: 0,
      approved: false,
      veto: true,
      vetoReason: `${branchLabel}_INSUFFICIENT_CANDLES(H1=${rawH1.length},M15=${rawM15.length})`,
      data: { h1Count: rawH1.length, m15Count: rawM15.length }
    };
  }

  const h1 = rawH1.map(parseCandle);
  const m15 = rawM15.map(parseCandle);

  // 1. ANALIZA H1: EMA 50 + Structura HH/HL sau LH/LL
  const h1Ema50 = computeEMA(h1, 50);
  const h1LastClose = h1[h1.length - 1].close;
  const h1Swings = extractSwingStructure(h1, 35);

  const isH1HigherHighs = h1Swings.lastHigh >= h1Swings.prevHigh && h1Swings.lastLow >= h1Swings.prevLow;
  const isH1LowerLows = h1Swings.lastHigh <= h1Swings.prevHigh && h1Swings.lastLow <= h1Swings.prevLow;

  let h1Direction = 'NEUTRAL';
  if (h1LastClose > h1Ema50 && (isH1HigherHighs || h1LastClose > h1Swings.prevHigh)) {
    h1Direction = 'LONG';
  } else if (h1LastClose < h1Ema50 && (isH1LowerLows || h1LastClose < h1Swings.prevLow)) {
    h1Direction = 'SHORT';
  }

  // 2. ANALIZA M15: Break of Structure (BOS) / Change of Character (CHoCH)
  const m15Ema20 = computeEMA(m15, 20);
  const m15Last = m15[m15.length - 1];

  // Calculăm structura internă pre-impuls (fereastra [len - 15 ... len - 5]) vs impulsul recent ([len - 5 ... len - 1])
  let preImpulseHigh = -Infinity;
  let preImpulseLow = Infinity;
  for (let i = Math.max(0, m15.length - 15); i < m15.length - 5; i++) {
    if (m15[i].high > preImpulseHigh) preImpulseHigh = m15[i].high;
    if (m15[i].low < preImpulseLow) preImpulseLow = m15[i].low;
  }

  let recentMaxClose = -Infinity;
  let recentMinClose = Infinity;
  let recentMinLow = Infinity;
  let recentMaxHigh = -Infinity;
  for (let i = Math.max(0, m15.length - 5); i < m15.length; i++) {
    if (m15[i].close > recentMaxClose) recentMaxClose = m15[i].close;
    if (m15[i].close < recentMinClose) recentMinClose = m15[i].close;
    if (m15[i].low < recentMinLow) recentMinLow = m15[i].low;
    if (m15[i].high > recentMaxHigh) recentMaxHigh = m15[i].high;
  }

  // Bullish BOS/CHoCH: impulsul recent a închis peste maximul intern pre-impuls (preImpulseHigh),
  // iar lumânarea curentă de retest (mitigare OB/FVG) respinge bullish și păstrează minimul structurii.
  const bullishBos =
    recentMaxClose > preImpulseHigh &&
    m15Last.low > recentMinLow &&
    (m15Last.close >= m15Last.open || m15Last.close >= m15Ema20);

  // Bearish BOS/CHoCH: impulsul recent a închis sub minimul intern pre-impuls (preImpulseLow),
  // iar lumânarea curentă de retest respinge bearish și păstrează maximul structurii.
  const bearishBos =
    recentMinClose < preImpulseLow &&
    m15Last.high < recentMaxHigh &&
    (m15Last.close <= m15Last.open || m15Last.close <= m15Ema20);

  let m15Direction = 'NEUTRAL';
  let m15StructureType = 'CONSOLIDATION';
  if (bullishBos && !bearishBos) {
    m15Direction = 'LONG';
    m15StructureType = 'BULLISH_BOS_MITIGATION';
  } else if (bearishBos && !bullishBos) {
    m15Direction = 'SHORT';
    m15StructureType = 'BEARISH_BOS_MITIGATION';
  } else if (m15Last.close > m15Ema20 && m15Last.close >= m15Last.open) {
    m15Direction = 'LONG';
    m15StructureType = 'BULLISH_EMA20_FLOW';
  } else if (m15Last.close < m15Ema20 && m15Last.close <= m15Last.open) {
    m15Direction = 'SHORT';
    m15StructureType = 'BEARISH_EMA20_FLOW';
  }

  const aligned = h1Direction !== 'NEUTRAL' && h1Direction === m15Direction;

  if (!aligned) {
    return {
      status: 'OK',
      direction: 'NEUTRAL',
      score: 0,
      approved: false,
      veto: true,
      vetoReason: `${branchLabel}_MTF_CONFLICT(H1=${h1Direction},M15=${m15Direction})`,
      data: {
        h1Direction,
        m15Direction,
        h1Ema50: Number(h1Ema50.toFixed(5)),
        m15Ema20: Number(m15Ema20.toFixed(5)),
        m15StructureType
      }
    };
  }

  return {
    status: 'OK',
    direction: h1Direction,
    score: 25,
    approved: true,
    veto: false,
    vetoReason: null,
    data: {
      h1Direction,
      m15Direction,
      h1Ema50: Number(h1Ema50.toFixed(5)),
      m15Ema20: Number(m15Ema20.toFixed(5)),
      m15StructureType,
      h1Swings,
      m15PreImpulseRange: {
        preImpulseLow: Number(preImpulseLow.toFixed(5)),
        preImpulseHigh: Number(preImpulseHigh.toFixed(5))
      }
    }
  };
}

/**
 * DIVIZIA 2: CARTOGRAFIERE MULTI-TF (60 Agenți: 2A Majors, 2B Crosses, 2C Gold, 2D Indici & Crypto)
 */
const Div2MultiTF = {
  branch2A_MajorsMTF: async (ctx) => evaluateMultiTimeframe(Object.assign({}, ctx, { branchLabel: '2A_MAJORS' })),
  branch2B_CrossesMTF: async (ctx) => evaluateMultiTimeframe(Object.assign({}, ctx, { branchLabel: '2B_CROSSES' })),
  branch2C_GoldMetalsMTF: async (ctx) => evaluateMultiTimeframe(Object.assign({}, ctx, { branchLabel: '2C_GOLD' })),
  branch2D_IndicesCryptoMTF: async (ctx) => evaluateMultiTimeframe(Object.assign({}, ctx, { branchLabel: '2D_INDICES_CRYPTO' })),
  computeEMA,
  extractSwingStructure
};

module.exports = { Div2MultiTF, computeEMA, extractSwingStructure };
