const { parseCandle } = require('../div1_shield_macro');

/**
 * Helper pentru obținerea direcției MTF din MarketStateBus
 */
function getDirectionFromBus(stateBus, symbol, config) {
  const inst = (config.instruments && config.instruments[symbol]) || {};
  let branchId = '2D';
  if (inst.category === 'MAJORS') branchId = '2A';
  else if (inst.category === 'CROSSES') branchId = '2B';
  else if (inst.category === 'GOLD_METALS') branchId = '2C';

  const rMTF = stateBus.getBranchReport(symbol, branchId);
  return (rMTF && rMTF.direction) || 'NEUTRAL';
}

/**
 * DIVIZIA 4: CHIEF RISK OFFICER (CRO) & RISK MANAGEMENT (40 Agenți: 4A, 4B, 4C, 4D)
 */
const Div4CroRisk = {
  /**
   * Ramura 4A (15 Agenți): Dynamic ATR & Spread-Adjusted SL / TP Calculator (Market Execution)
   * Calculează:
   * - marketEntryPrice = Prețul Spot Exact (0-Delay)
   * - stopLoss = dincolo de fitilul Liquidity Sweep (3A) + buffer (spreadPips + 1.5 pips)
   * - tp1 = 1.5 R:R (pentru mutarea SL la Break-Even)
   * - tp2 = 3.0 R:R (ținta principală de lichiditate)
   */
  branch4A_MarketRiskCalculator: async ({ symbol, marketData, stateBus, config }) => {
    const inst = (config.instruments && config.instruments[symbol]) || { pipSize: 0.0001, decimals: 5 };
    const policy = (config && config.executionPolicy) || {};
    const dir = getDirectionFromBus(stateBus, symbol, config);

    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (!marketData || rawM15.length < 15 || (dir !== 'LONG' && dir !== 'SHORT')) {
      return {
        status: 'OK',
        direction: dir,
        score: 0,
        approved: false,
        veto: false,
        data: { reason: 'WAITING_FOR_VALID_DIRECTION_OR_SPOT' }
      };
    }

    const m15 = rawM15.map(parseCandle);
    const decimals = typeof inst.decimals === 'number' ? inst.decimals : 5;
    const pipSize = inst.pipSize || 0.0001;

    // Prețul Spot Exact pentru Market Execution (Buy la Ask/Mid, Sell la Bid/Mid)
    const marketEntryPrice = marketData.spotMid || m15[m15.length - 1].close;
    const spreadPips = typeof marketData.spreadPips === 'number'
      ? marketData.spreadPips
      : Math.abs(((marketData.spotAsk || marketEntryPrice) - (marketData.spotBid || marketEntryPrice)) / pipSize);

    const slBufferPips = typeof policy.slBufferPips === 'number' ? policy.slBufferPips : 1.5;
    const totalBufferPrice = (spreadPips + slBufferPips) * pipSize;

    // Preluăm extremitatea fitilului de Liquidity Sweep din Ramura 3A
    const r3A = stateBus.getBranchReport(symbol, '3A');
    let sweepExtreme = r3A && r3A.data && typeof r3A.data.sweepWickExtreme === 'number'
      ? r3A.data.sweepWickExtreme
      : null;

    if (sweepExtreme === null) {
      sweepExtreme = dir === 'LONG' ? m15[m15.length - 1].low : m15[m15.length - 1].high;
      for (let i = Math.max(0, m15.length - 10); i < m15.length; i++) {
        if (dir === 'LONG' && m15[i].low < sweepExtreme) sweepExtreme = m15[i].low;
        if (dir === 'SHORT' && m15[i].high > sweepExtreme) sweepExtreme = m15[i].high;
      }
    }

    let stopLoss = dir === 'LONG'
      ? sweepExtreme - totalBufferPrice
      : sweepExtreme + totalBufferPrice;

    // Garanție matematică: distanța minimă de SL să fie cel puțin 5 pips * pipSize
    const minRiskDistance = 5 * pipSize;
    if (dir === 'LONG' && (marketEntryPrice - stopLoss) < minRiskDistance) {
      stopLoss = marketEntryPrice - minRiskDistance;
    } else if (dir === 'SHORT' && (stopLoss - marketEntryPrice) < minRiskDistance) {
      stopLoss = marketEntryPrice + minRiskDistance;
    }

    const riskDistance = Math.abs(marketEntryPrice - stopLoss);
    const riskPips = riskDistance / pipSize;

    // PROTECȚIE SCALPING M15 (SPREAD-TO-RISK RATIO GUARD):
    // Dacă spreadPips reprezintă mai mult de 18% din întregul riskPips (SL prea strâns față de spread),
    // activăm automat VETO (SPREAD_TO_SL_RATIO_TOO_HIGH) pentru a nu fi scoși de zgomotul brokerului!
    const spreadToRiskRatio = riskPips > 0 ? (spreadPips / riskPips) : 1.0;
    if (spreadToRiskRatio > 0.18) {
      return {
        status: 'OK',
        direction: dir,
        score: 0,
        approved: false,
        veto: true,
        vetoReason: `SPREAD_TO_SL_RATIO_TOO_HIGH(${(spreadToRiskRatio * 100).toFixed(1)}% > 18.0% max)`,
        data: {
          spreadPips: Number(spreadPips.toFixed(2)),
          riskPips: Number(riskPips.toFixed(2)),
          spreadToRiskRatio: Number(spreadToRiskRatio.toFixed(4))
        }
      };
    }

    const rrTp1 = policy.tp1RiskReward || 1.5;
    const rrTp15 = 2.2; // Prag intermediar Trailing Structure Lock (2.2 R:R -> blochează SL pe TP1)
    const rrTp2 = policy.tp2MinRiskReward || 3.0;

    // Calculăm True Break-Even (Entry + Spread + 0.5 pips pt BUY, sau minus pt SELL)
    const beOffsetPrice = (spreadPips + 0.5) * pipSize;
    const protectedBreakEvenPrice = dir === 'LONG'
      ? marketEntryPrice + beOffsetPrice
      : marketEntryPrice - beOffsetPrice;

    const tp1 = dir === 'LONG'
      ? marketEntryPrice + riskDistance * rrTp1
      : marketEntryPrice - riskDistance * rrTp1;

    const tp15TrailingLock = dir === 'LONG'
      ? marketEntryPrice + riskDistance * rrTp15
      : marketEntryPrice - riskDistance * rrTp15;

    const tp2 = dir === 'LONG'
      ? marketEntryPrice + riskDistance * rrTp2
      : marketEntryPrice - riskDistance * rrTp2;

    return {
      status: 'OK',
      direction: dir,
      score: 0,
      approved: true,
      veto: false,
      data: {
        executionType: 'MARKET_EXECUTION_0_DELAY',
        marketEntryPrice: Number(marketEntryPrice.toFixed(decimals)),
        protectedBreakEvenPrice: Number(protectedBreakEvenPrice.toFixed(decimals)),
        stopLoss: Number(stopLoss.toFixed(decimals)),
        tp1: Number(tp1.toFixed(decimals)),
        tp15TrailingLock: Number(tp15TrailingLock.toFixed(decimals)),
        tp2: Number(tp2.toFixed(decimals)),
        riskPips: Number(riskPips.toFixed(1)),
        spreadPipsIncluded: Number(spreadPips.toFixed(2)),
        spreadToRiskPct: Number((spreadToRiskRatio * 100).toFixed(1)),
        slBufferPipsIncluded: slBufferPips,
        rrTp1,
        rrTp15,
        rrTp2,
        sweepWickExtreme: Number(sweepExtreme.toFixed(decimals))
      }
    };
  },

  /**
   * Ramura 4B (10 Agenți): Anti-Chase Filter (CRITIC PENTRU MARKET EXECUTION)
   * Verifică cât % a plecat prețul Spot curent de la zona de intrare (Order Block / FVG) spre TP1.
   * Dacă chaseRatio > 0.15 (15%) -> VETO INSTANT (interzice Entry-ul întârziat!).
   */
  branch4B_AntiChaseFilter: async ({ symbol, marketData, stateBus, config }) => {
    const policy = (config && config.executionPolicy) || {};
    const maxChaseRatio = typeof policy.maxChaseRatioFromZone === 'number' ? policy.maxChaseRatioFromZone : 0.15;

    const r4A = stateBus.getBranchReport(symbol, '4A');
    const r3B = stateBus.getBranchReport(symbol, '3B');
    const r3C = stateBus.getBranchReport(symbol, '3C');

    if (!r4A || !r4A.approved || !r4A.data || !r4A.data.marketEntryPrice) {
      return {
        status: 'OK',
        approved: false,
        veto: true,
        vetoReason: (r4A && r4A.vetoReason) || '4B_MISSING_4A_RISK_GEOMETRY',
        score: 0,
        data: (r4A && r4A.data) || {}
      };
    }

    const dir = r4A.direction;
    const spotPrice = marketData.spotMid || r4A.data.marketEntryPrice;
    const tp1 = r4A.data.tp1;

    // Determinăm marginea zonei instituționale (Order Block sau FVG)
    let zoneAnchor = spotPrice;
    if (r3B && r3B.data && typeof r3B.data.orderBlockHigh === 'number') {
      zoneAnchor = dir === 'LONG' ? r3B.data.orderBlockHigh : r3B.data.orderBlockLow;
    } else if (r3C && r3C.data && typeof r3C.data.fvgHigh === 'number') {
      zoneAnchor = dir === 'LONG' ? r3C.data.fvgHigh : r3C.data.fvgLow;
    }

    const totalDistanceToTp1 = Math.max(1e-8, Math.abs(tp1 - zoneAnchor));
    let distanceMovedBeyondZone = 0;

    if (dir === 'LONG' && spotPrice > zoneAnchor) {
      distanceMovedBeyondZone = spotPrice - zoneAnchor;
    } else if (dir === 'SHORT' && spotPrice < zoneAnchor) {
      distanceMovedBeyondZone = zoneAnchor - spotPrice;
    }

    const chaseRatio = distanceMovedBeyondZone / totalDistanceToTp1;
    const chasedTooFar = chaseRatio > maxChaseRatio;

    if (chasedTooFar) {
      return {
        status: 'OK',
        direction: dir,
        score: 0,
        approved: false,
        veto: true,
        vetoReason: `4B_ANTI_CHASE_VETO(Moved ${(chaseRatio * 100).toFixed(1)}% > ${(maxChaseRatio * 100).toFixed(0)}% max toward TP1)`,
        data: {
          spotPrice,
          zoneAnchor,
          tp1,
          chaseRatio: Number(chaseRatio.toFixed(4)),
          maxChaseRatio
        }
      };
    }

    return {
      status: 'OK',
      direction: dir,
      score: 0,
      approved: true,
      veto: false,
      data: {
        spotPrice,
        zoneAnchor,
        tp1,
        chaseRatio: Number(chaseRatio.toFixed(4)),
        chasePct: Number((chaseRatio * 100).toFixed(2)),
        maxChaseRatio
      }
    };
  },

  /**
   * Ramura 4C (10 Agenți): Multi-Currency Correlation Guard
   * Apelează stateBus.checkCurrencyCorrelationConflict(symbol, direction)
   * Blochează expunerea dublă pe aceeași valută (ex: EURUSD + GBPUSD simultan).
   */
  branch4C_CorrelationGuard: async ({ symbol, stateBus, config }) => {
    const dir = getDirectionFromBus(stateBus, symbol, config);
    const check = stateBus.checkCurrencyCorrelationConflict(symbol, dir);

    if (check.conflict) {
      return {
        status: 'OK',
        direction: dir,
        score: 0,
        approved: false,
        veto: true,
        vetoReason: check.reason || '4C_CURRENCY_CORRELATION_CONFLICT',
        data: check
      };
    }

    return {
      status: 'OK',
      direction: dir,
      score: 0,
      approved: true,
      veto: false,
      data: { correlationClear: true }
    };
  },

  /**
   * Ramura 4D (5 Agenți): Daily Drawdown & Streak Circuit-Breaker
   * Verifică stateBus.getDailySlCount(symbol) >= 2 -> VETO dacă perechea are 2 SL-uri azi.
   */
  branch4D_DailyDrawdownBreaker: async ({ symbol, stateBus, config }) => {
    const policy = (config && config.executionPolicy) || {};
    const maxDailySl = policy.maxDailySlPerSymbol || 2;
    const slCount = stateBus.getDailySlCount(symbol);

    if (slCount >= maxDailySl) {
      return {
        status: 'OK',
        score: 0,
        approved: false,
        veto: true,
        vetoReason: `4D_DAILY_DRAWDOWN_BREAKER(${slCount}/${maxDailySl} SL today on ${symbol})`,
        data: { slCount, maxDailySl }
      };
    }

    return {
      status: 'OK',
      score: 0,
      approved: true,
      veto: false,
      data: { slCount, maxDailySl }
    };
  }
};

module.exports = { Div4CroRisk };
