const { parseCandle } = require('../div1_shield_macro');

/**
 * Helper pentru obținerea direcției MTF din MarketStateBus (fără apel direct între agenți)
 */
function getMtfDirectionFromBus(stateBus, symbol, config) {
  const inst = (config.instruments && config.instruments[symbol]) || {};
  let branchId = '2D';
  if (inst.category === 'MAJORS') branchId = '2A';
  else if (inst.category === 'CROSSES') branchId = '2B';
  else if (inst.category === 'GOLD_METALS') branchId = '2C';

  const report = stateBus.getBranchReport(symbol, branchId);
  return report && report.direction ? report.direction : 'NEUTRAL';
}

/**
 * DIVIZIA 3: INSTITUTIONAL ORDERFLOW & SMC (90 Agenți: 3A, 3B, 3C, 3D, 3E)
 */
const Div3OrderflowSMC = {
  /**
   * Ramura 3A (25 Agenți): Liquidity Sweep & Stop-Hunt Raiders (+25 Puncte)
   * Verifică dacă în ultimele 10-15 lumânări un fitil (wick) a măturat un Swing High/Low anterior
   * (a luat Stop-Loss-urile retailului) și corpul lumânării a închis înapoi în interiorul range-ului.
   */
  branch3A_LiquiditySweep: async ({ symbol, marketData, stateBus, config }) => {
    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 30) {
      return { status: 'OK', approved: false, score: 0, direction: 'NEUTRAL', data: { reason: 'INSUFFICIENT_M15' } };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const mtfDir = getMtfDirectionFromBus(stateBus, symbol, config);

    // Fereastra recentă de 15 lumânări (unde căutăm fitilul de Stop-Hunt)
    const sweepStart = len - 15;
    // Fereastra anterioară de lichiditate (lumânările [len - 35 ... len - 15])
    const poolStart = Math.max(0, len - 35);
    const poolEnd = sweepStart;

    let priorLiquidityLow = Infinity;
    let priorLiquidityHigh = -Infinity;
    for (let i = poolStart; i < poolEnd; i++) {
      if (m15[i].low < priorLiquidityLow) priorLiquidityLow = m15[i].low;
      if (m15[i].high > priorLiquidityHigh) priorLiquidityHigh = m15[i].high;
    }

    let bullishSweepFound = false;
    let bearishSweepFound = false;
    let sweepCandleIndex = -1;
    let sweepWickExtreme = null;

    for (let i = sweepStart; i < len; i++) {
      const c = m15[i];
      const bodyLow = Math.min(c.open, c.close);
      const bodyHigh = Math.max(c.open, c.close);

      // Bullish Stop-Hunt: fitilul inferior coboară sub priorLiquidityLow, dar corpul/închiderea revine deasupra
      if (c.low < priorLiquidityLow && (c.close >= priorLiquidityLow || bodyLow >= priorLiquidityLow * 0.9995)) {
        bullishSweepFound = true;
        sweepCandleIndex = i;
        sweepWickExtreme = sweepWickExtreme === null ? c.low : Math.min(sweepWickExtreme, c.low);
      }

      // Bearish Stop-Hunt: fitilul superior trece peste priorLiquidityHigh, dar corpul/închiderea revine sub el
      if (c.high > priorLiquidityHigh && (c.close <= priorLiquidityHigh || bodyHigh <= priorLiquidityHigh * 1.0005)) {
        bearishSweepFound = true;
        sweepCandleIndex = i;
        sweepWickExtreme = sweepWickExtreme === null ? c.high : Math.max(sweepWickExtreme, c.high);
      }
    }

    const inst = (config.instruments && config.instruments[symbol]) || { pipSize: 0.0001 };
    const pipSize = inst.pipSize || 0.0001;
    const currentSpot = (marketData && marketData.spotMid) || m15[len - 1].close;

    if (mtfDir === 'LONG' && bullishSweepFound) {
      const sweepDistancePips = Math.abs(currentSpot - sweepWickExtreme) / pipSize;
      return {
        status: 'OK',
        direction: 'LONG',
        score: 25,
        approved: true,
        veto: false,
        data: {
          sweepType: 'SELL_SIDE_LIQUIDITY_SWEEP',
          priorLiquidityLevel: Number(priorLiquidityLow.toFixed(5)),
          sweepWickExtreme: Number(sweepWickExtreme.toFixed(5)),
          sweepDistancePips: Number(sweepDistancePips.toFixed(1)),
          sweepCandleIndex
        }
      };
    }

    if (mtfDir === 'SHORT' && bearishSweepFound) {
      const sweepDistancePips = Math.abs(sweepWickExtreme - currentSpot) / pipSize;
      return {
        status: 'OK',
        direction: 'SHORT',
        score: 25,
        approved: true,
        veto: false,
        data: {
          sweepType: 'BUY_SIDE_LIQUIDITY_SWEEP',
          priorLiquidityLevel: Number(priorLiquidityHigh.toFixed(5)),
          sweepWickExtreme: Number(sweepWickExtreme.toFixed(5)),
          sweepDistancePips: Number(sweepDistancePips.toFixed(1)),
          sweepCandleIndex
        }
      };
    }

    return {
      status: 'OK',
      direction: 'NEUTRAL',
      score: 0,
      approved: false,
      veto: false,
      data: {
        sweepType: 'NONE_DETECTED_OR_UNALIGNED',
        priorLiquidityLow: Number(priorLiquidityLow.toFixed(5)),
        priorLiquidityHigh: Number(priorLiquidityHigh.toFixed(5))
      }
    };
  },

  /**
   * Ramura 3B (20 Agenți): Order Block (OB) & Breaker Validators (+10 Puncte din blocul de 20p)
   * Caută ultima lumânare contrară înainte de impulsul de deplasare și verifică atingerea live.
   * Respectă Regula Anti-Inducement (0 puncte dacă 3A == 0).
   */
  branch3B_OrderBlockValidator: async ({ symbol, marketData, stateBus, config }) => {
    const r3A = stateBus.getBranchReport(symbol, '3A');
    if (!r3A || !r3A.approved || r3A.score <= 0) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: false,
        data: { reason: 'ANTI_INDUCEMENT_3A_ZERO' }
      };
    }

    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 20) {
      return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, data: {} };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const spotPrice = marketData.spotMid || m15[len - 1].close;
    const dir = r3A.direction;

    let obZone = null;
    // Căutăm Order Block-ul instituțional în ultimele 15 lumânări
    for (let i = len - 15; i < len - 1; i++) {
      const c = m15[i];
      const next = m15[i + 1];
      if (dir === 'LONG' && c.close < c.open && next.close > c.high) {
        obZone = { low: c.low, high: Math.max(c.open, c.high), index: i };
      } else if (dir === 'SHORT' && c.close > c.open && next.close < c.low) {
        obZone = { low: Math.min(c.open, c.low), high: c.high, index: i };
      }
    }

    // Dacă nu există lumânare clasică engulfing, folosim baza lumânării de Sweep
    if (!obZone) {
      const sweepIdx = (r3A.data && r3A.data.sweepCandleIndex >= 0) ? r3A.data.sweepCandleIndex : len - 3;
      const sc = m15[Math.max(0, Math.min(len - 1, sweepIdx))];
      obZone = { low: sc.low, high: sc.high, index: sweepIdx };
    }

    const zoneHeight = Math.max(1e-8, obZone.high - obZone.low);
    const tolerance = zoneHeight * 0.35;
    const inMitigation = spotPrice >= (obZone.low - tolerance) && spotPrice <= (obZone.high + tolerance);

    return {
      status: 'OK',
      direction: dir,
      score: inMitigation ? 10 : 0,
      approved: inMitigation,
      veto: false,
      data: {
        orderBlockLow: Number(obZone.low.toFixed(5)),
        orderBlockHigh: Number(obZone.high.toFixed(5)),
        spotPrice: Number(spotPrice.toFixed(5)),
        inMitigation
      }
    };
  },

  /**
   * Ramura 3C (20 Agenți): Fair Value Gap (FVG) & IFVG Snipers (+5 Puncte din blocul de 20p)
   * Detectează matematic FVG-ul între lumânarea i-2 și i și verifică mitigarea la prețul Spot.
   */
  branch3C_FvgSniper: async ({ symbol, marketData, stateBus }) => {
    const r3A = stateBus.getBranchReport(symbol, '3A');
    if (!r3A || !r3A.approved || r3A.score <= 0) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: false,
        data: { reason: 'ANTI_INDUCEMENT_3A_ZERO' }
      };
    }

    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 15) {
      return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, data: {} };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const spotPrice = marketData.spotMid || m15[len - 1].close;
    const dir = r3A.direction;

    let detectedFvg = null;
    for (let i = len - 12; i < len; i++) {
      if (i < 2) continue;
      const cMinus2 = m15[i - 2];
      const cCurr = m15[i];

      // Bullish FVG: minimul lumânării i este peste maximul lumânării i-2
      if (dir === 'LONG' && cCurr.low > cMinus2.high) {
        detectedFvg = { low: cMinus2.high, high: cCurr.low, index: i - 1 };
      }
      // Bearish FVG: maximul lumânării i este sub minimul lumânării i-2
      if (dir === 'SHORT' && cCurr.high < cMinus2.low) {
        detectedFvg = { low: cCurr.high, high: cMinus2.low, index: i - 1 };
      }
    }

    if (!detectedFvg) {
      return {
        status: 'OK',
        direction: dir,
        score: 0,
        approved: false,
        veto: false,
        data: { fvgFound: false }
      };
    }

    const gapSize = Math.max(1e-8, detectedFvg.high - detectedFvg.low);
    const proximityBuffer = gapSize * 1.25;
    const testingFvg = spotPrice >= (detectedFvg.low - proximityBuffer) && spotPrice <= (detectedFvg.high + proximityBuffer);

    return {
      status: 'OK',
      direction: dir,
      score: testingFvg ? 5 : 0,
      approved: testingFvg,
      veto: false,
      data: {
        fvgFound: true,
        fvgLow: Number(detectedFvg.low.toFixed(5)),
        fvgHigh: Number(detectedFvg.high.toFixed(5)),
        testingFvg
      }
    };
  },

  /**
   * Ramura 3D (15 Agenți): Whale Volume Explosion & Displacement (+15 Puncte)
   * Verifică dacă volumul sau corpul lumânării de impuls >= 1.8x media ultimelor 20 lumânări
   * și lumânarea curentă arată rejecție în direcția semnalului.
   */
  branch3D_WhaleVolumeExplosion: async ({ symbol, marketData, stateBus, config }) => {
    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 22) {
      return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, data: {} };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const dir = getMtfDirectionFromBus(stateBus, symbol, config);

    let sumVol = 0;
    let sumBody = 0;
    const avgWindow = 20;
    for (let i = len - 1 - avgWindow; i < len - 1; i++) {
      sumVol += m15[i].volume;
      sumBody += Math.abs(m15[i].close - m15[i].open);
    }
    const avgVol = sumVol / avgWindow;
    const avgBody = sumBody / avgWindow;

    // Căutăm în ultimele 5 lumânări impulsul de balenă (Displacement >= 1.8x media)
    let maxVolRatio = 0;
    let maxBodyRatio = 0;
    for (let i = len - 5; i < len; i++) {
      const vRatio = avgVol > 0 ? m15[i].volume / avgVol : 0;
      const bRatio = avgBody > 0 ? Math.abs(m15[i].close - m15[i].open) / avgBody : 0;
      if (vRatio > maxVolRatio) maxVolRatio = vRatio;
      if (bRatio > maxBodyRatio) maxBodyRatio = bRatio;
    }

    const last = m15[len - 1];
    const hasRejectionOrFlow = dir === 'LONG'
      ? (last.close >= last.open || (Math.min(last.open, last.close) - last.low) > (last.high - Math.max(last.open, last.close)))
      : (last.close <= last.open || (last.high - Math.max(last.open, last.close)) > (Math.min(last.open, last.close) - last.low));

    const whaleConfirmed = (maxVolRatio >= 1.8 || maxBodyRatio >= 1.8) && hasRejectionOrFlow;

    return {
      status: 'OK',
      direction: dir,
      score: whaleConfirmed ? 15 : 0,
      approved: whaleConfirmed,
      veto: false,
      data: {
        maxVolRatio: Number(maxVolRatio.toFixed(2)),
        maxBodyRatio: Number(maxBodyRatio.toFixed(2)),
        hasRejectionOrFlow,
        thresholdRequired: 1.8
      }
    };
  },

  /**
   * Ramura 3E (10 Agenți): Premium / Discount (Fibonacci 50% Equilibrium) (+5 Puncte din blocul de 20p)
   * BUY doar în Discount (< 50% Fibo), SELL doar în Premium (> 50% Fibo).
   */
  branch3E_PremiumDiscountFibo: async ({ symbol, marketData, stateBus }) => {
    const r3A = stateBus.getBranchReport(symbol, '3A');
    if (!r3A || !r3A.approved || r3A.score <= 0) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: false,
        data: { reason: 'ANTI_INDUCEMENT_3A_ZERO' }
      };
    }

    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 25) {
      return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: false, data: {} };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const spotPrice = marketData.spotMid || m15[len - 1].close;
    const dir = r3A.direction;

    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    for (let i = Math.max(0, len - 30); i < len; i++) {
      if (m15[i].high > rangeHigh) rangeHigh = m15[i].high;
      if (m15[i].low < rangeLow) rangeLow = m15[i].low;
    }

    const equilibrium50 = (rangeHigh + rangeLow) / 2;
    const fiboRatio = rangeHigh > rangeLow ? (spotPrice - rangeLow) / (rangeHigh - rangeLow) : 0.5;

    const inOptimalZone = (dir === 'LONG' && spotPrice <= equilibrium50) ||
                          (dir === 'SHORT' && spotPrice >= equilibrium50);

    return {
      status: 'OK',
      direction: dir,
      score: inOptimalZone ? 5 : 0,
      approved: inOptimalZone,
      veto: false,
      data: {
        rangeLow: Number(rangeLow.toFixed(5)),
        rangeHigh: Number(rangeHigh.toFixed(5)),
        equilibrium50: Number(equilibrium50.toFixed(5)),
        fiboRatioPct: Number((fiboRatio * 100).toFixed(1)),
        zone: spotPrice <= equilibrium50 ? 'DISCOUNT' : 'PREMIUM'
      }
    };
  }
};

module.exports = { Div3OrderflowSMC };
