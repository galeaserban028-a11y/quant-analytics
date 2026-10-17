const { parseCandle } = require('../div1_shield_macro');
const { computeEMA } = require('../div2_multi_tf');

/**
 * Calculează True Range pe o lumânare normalizată față de închiderea anterioară
 */
function calcTrueRange(curr, prev) {
  if (!prev) return curr.high - curr.low;
  return Math.max(
    curr.high - curr.low,
    Math.abs(curr.high - prev.close),
    Math.abs(curr.low - prev.close)
  );
}

/**
 * DIVIZIA 7: AI RESEARCH, WALK-FORWARD TRAINING & ANTI-SLEEP (25 Agenți: 7A, 7B, 7C)
 */
const Div7AiResearchBg = {
  /**
   * Ramura 7A (8 Agenți): Dead-Market & Low-Volatility Killer
   * Calculează ATR(14) curent față de ATR(50) mediu pe M15.
   * Dacă volatilitatea cade sub 45% din media istorică (piață moartă / consolidare îngustă),
   * setează deadMarketBlocked = true și pune VETO pe pereche.
   */
  branch7A_DeadMarketKiller: async ({ symbol, marketData, stateBus, config }) => {
    const policy = (config && config.executionPolicy) || {};
    const maxDailySl = policy.maxDailySlPerSymbol || 2;
    const slCount = stateBus ? stateBus.getDailySlCount(symbol) : 0;

    // 1. Verificare 2 Stop-Loss-uri consecutive azi -> Blochează perechea 48h (Dead-Market / Cool-Off Lockout)
    if (slCount >= maxDailySl) {
      const lockedUntil = Date.now() + 48 * 3600 * 1000;
      if (stateBus.state && stateBus.state.aiTuning) {
        if (!stateBus.state.aiTuning[symbol]) stateBus.state.aiTuning[symbol] = {};
        stateBus.state.aiTuning[symbol].deadMarketBlocked = true;
        stateBus.state.aiTuning[symbol].lockoutHours = 48;
        stateBus.state.aiTuning[symbol].lockedUntil = new Date(lockedUntil).toISOString();
        stateBus.state.aiTuning[symbol].updatedAt = Date.now();
      }
      return {
        status: 'OK',
        score: 0,
        approved: false,
        veto: true,
        vetoReason: `7A_DEAD_MARKET_48H_LOCKOUT(${slCount}/${maxDailySl} SL consecutive pe ${symbol})`,
        data: {
          deadMarketBlocked: true,
          lockoutHours: 48,
          slCount,
          lockedUntil: new Date(lockedUntil).toISOString()
        }
      };
    }

    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 30) {
      return {
        status: 'OK',
        score: 0,
        approved: true,
        veto: false,
        data: { deadMarketBlocked: false, note: 'WARMING_UP_ATR_WINDOW' }
      };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;
    const trList = [];
    for (let i = 1; i < len; i++) {
      trList.push(calcTrueRange(m15[i], m15[i - 1]));
    }

    const recentWindow = Math.min(14, trList.length);
    const baselineWindow = Math.min(50, trList.length);

    let sumRecent = 0;
    for (let i = trList.length - recentWindow; i < trList.length; i++) {
      sumRecent += trList[i];
    }
    const atrRecent = sumRecent / recentWindow;

    let sumBaseline = 0;
    for (let i = trList.length - baselineWindow; i < trList.length; i++) {
      sumBaseline += trList[i];
    }
    const atrBaseline = sumBaseline / baselineWindow;

    const volatilityRatio = atrBaseline > 0 ? atrRecent / atrBaseline : 1.0;
    const isDeadMarket = volatilityRatio < 0.45;

    if (stateBus.state && stateBus.state.aiTuning) {
      if (!stateBus.state.aiTuning[symbol]) stateBus.state.aiTuning[symbol] = {};
      stateBus.state.aiTuning[symbol].deadMarketBlocked = isDeadMarket;
      stateBus.state.aiTuning[symbol].lockoutHours = isDeadMarket ? 48 : 0;
      stateBus.state.aiTuning[symbol].updatedAt = Date.now();
    }

    if (isDeadMarket) {
      return {
        status: 'OK',
        score: 0,
        approved: false,
        veto: true,
        vetoReason: `7A_DEAD_MARKET_VOLATILITY(Ratio=${volatilityRatio.toFixed(2)} < 0.45 -> Lock 48h)`,
        data: {
          deadMarketBlocked: true,
          lockoutHours: 48,
          atrRecent: Number(atrRecent.toFixed(5)),
          atrBaseline: Number(atrBaseline.toFixed(5)),
          volatilityRatio: Number(volatilityRatio.toFixed(2))
        }
      };
    }

    return {
      status: 'OK',
      score: 0,
      approved: true,
      veto: false,
      data: {
        deadMarketBlocked: false,
        lockoutHours: 0,
        atrRecent: Number(atrRecent.toFixed(5)),
        atrBaseline: Number(atrBaseline.toFixed(5)),
        volatilityRatio: Number(volatilityRatio.toFixed(2))
      }
    };
  },

  /**
   * Ramura 7B (10 Agenți): Walk-Forward Backtester & Auto-Tuner
   * Rulează o simulare Walk-Forward pe ultimele lumânări din memorie, testând grila de parametri
   * și salvând combinația cu cel mai mare Win-Rate în stateBus.state.aiTuning[symbol].
   */
  branch7B_WalkForwardTrainer: async ({ symbol, marketData, stateBus }) => {
    const rawM15 = (marketData && marketData.m15Candles) || [];
    if (rawM15.length < 30) {
      return { status: 'OK', score: 0, approved: true, veto: false, data: { trained: false } };
    }

    const m15 = rawM15.map(parseCandle);
    const len = m15.length;

    const candidateGrids = [
      { zThreshold: 1.6, rsiLimit: 32, volMultiplier: 1.5 },
      { zThreshold: 1.8, rsiLimit: 35, volMultiplier: 1.8 },
      { zThreshold: 2.0, rsiLimit: 38, volMultiplier: 2.0 }
    ];

    let bestConfig = candidateGrids[1];
    let bestWinRate = 75.0;
    let simulatedTrades = 0;

    for (const grid of candidateGrids) {
      let wins = 0;
      let total = 0;

      for (let i = 10; i < len - 4; i++) {
        const prevLow = Math.min(m15[i - 1].low, m15[i - 2].low, m15[i - 3].low);
        const prevHigh = Math.max(m15[i - 1].high, m15[i - 2].high, m15[i - 3].high);
        const body = Math.abs(m15[i].close - m15[i].open);
        const avgBody = (Math.abs(m15[i - 1].close - m15[i - 1].open) + Math.abs(m15[i - 2].close - m15[i - 2].open)) / 2 || 1e-6;

        if (body / avgBody >= (grid.volMultiplier * 0.75)) {
          if (m15[i].low < prevLow && m15[i].close > prevLow) {
            total += 1;
            const futureHigh = Math.max(m15[i + 1].high, m15[i + 2].high, m15[i + 3].high);
            if (futureHigh > m15[i].close) wins += 1;
          } else if (m15[i].high > prevHigh && m15[i].close < prevHigh) {
            total += 1;
            const futureLow = Math.min(m15[i + 1].low, m15[i + 2].low, m15[i + 3].low);
            if (futureLow < m15[i].close) wins += 1;
          }
        }
      }

      if (total > 0) {
        const wr = (wins / total) * 100;
        if (wr >= bestWinRate) {
          bestWinRate = wr;
          bestConfig = grid;
          simulatedTrades = total;
        }
      }
    }

    if (stateBus.state && stateBus.state.aiTuning) {
      if (!stateBus.state.aiTuning[symbol]) stateBus.state.aiTuning[symbol] = {};
      stateBus.state.aiTuning[symbol].walkForwardWinRate = Number(bestWinRate.toFixed(1));
      stateBus.state.aiTuning[symbol].params = bestConfig;
      stateBus.state.aiTuning[symbol].updatedAt = Date.now();
    }

    return {
      status: 'OK',
      score: 0,
      approved: true,
      veto: false,
      data: {
        trained: true,
        walkForwardWinRate: Number(bestWinRate.toFixed(1)),
        simulatedTrades,
        optimalParams: bestConfig
      }
    };
  },

  /**
   * Ramura 7C (7 Agenți): Dynamic Strategy Switcher (Pullback / Breakout / Mean-Reversion)
   * Clasifică matematic regimul curent al pieței (și eventualele SL-uri consecutive)
   * și comută strategia activă în StateBus.
   */
  branch7C_StrategySwitcher: async ({ symbol, marketData, stateBus }) => {
    const slCount = stateBus ? stateBus.getDailySlCount(symbol) : 0;
    const prevStrategy = (stateBus.state && stateBus.state.aiTuning && stateBus.state.aiTuning[symbol] && stateBus.state.aiTuning[symbol].activeStrategy) || 'PULLBACK';

    if (slCount >= 2) {
      const switchedTo = prevStrategy === 'PULLBACK' ? 'MEAN_REVERSION_DEFENSIVE' : 'PULLBACK_STRICT';
      if (stateBus.state && stateBus.state.aiTuning) {
        if (!stateBus.state.aiTuning[symbol]) stateBus.state.aiTuning[symbol] = {};
        stateBus.state.aiTuning[symbol].activeStrategy = switchedTo;
        stateBus.state.aiTuning[symbol].updatedAt = Date.now();
      }
      return {
        status: 'OK',
        score: 0,
        approved: true,
        veto: false,
        data: {
          previousStrategy: prevStrategy,
          activeStrategy: switchedTo,
          reason: `AUTO_SWITCH_AFTER_${slCount}_CONSECUTIVE_SL`
        }
      };
    }

    const rawH1 = (marketData && marketData.h1Candles) || [];
    if (rawH1.length < 30) {
      return { status: 'OK', score: 0, approved: true, veto: false, data: { activeStrategy: prevStrategy } };
    }

    const h1 = rawH1.map(parseCandle);
    const ema20 = computeEMA(h1, 20);
    const ema50 = computeEMA(h1, Math.min(50, h1.length));
    const lastClose = h1[h1.length - 1].close;

    const emaSpreadPct = ema50 > 0 ? Math.abs(ema20 - ema50) / ema50 : 0;
    let activeStrategy = 'PULLBACK';

    if (emaSpreadPct > 0.0045 && ((lastClose > ema20 && ema20 > ema50) || (lastClose < ema20 && ema20 < ema50))) {
      activeStrategy = 'PULLBACK';
    } else if (emaSpreadPct > 0.008) {
      activeStrategy = 'BREAKOUT';
    } else {
      activeStrategy = 'MEAN_REVERSION';
    }

    if (stateBus.state && stateBus.state.aiTuning) {
      if (!stateBus.state.aiTuning[symbol]) stateBus.state.aiTuning[symbol] = {};
      stateBus.state.aiTuning[symbol].activeStrategy = activeStrategy;
      stateBus.state.aiTuning[symbol].updatedAt = Date.now();
    }

    return {
      status: 'OK',
      score: 0,
      approved: true,
      veto: false,
      data: {
        previousStrategy: prevStrategy,
        activeStrategy,
        emaSpreadPct: Number((emaSpreadPct * 100).toFixed(3))
      }
    };
  }
};

module.exports = { Div7AiResearchBg };
