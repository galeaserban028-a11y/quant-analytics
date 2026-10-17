const https = require('https');

/**
 * Helper opțional pentru trimiterea mesajelor pe Telegram (Zero-Crash, doar dacă e activat)
 */
function dispatchTelegramMessage(text, enabled = false) {
  return new Promise((resolve) => {
    try {
      const token = process.env.TELEGRAM_TOKEN;
      const chatId = process.env.CHAT_ID;
      if (!enabled || !token || !chatId) {
        return resolve({ sent: false, mode: 'DRY_RUN_READY' });
      }
      const payload = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      });
      const req = https.request(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 5000
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ sent: res.statusCode === 200, statusCode: res.statusCode }));
        }
      );
      req.on('error', () => resolve({ sent: false, mode: 'NETWORK_FALLBACK' }));
      req.write(payload);
      req.end();
    } catch (_) {
      resolve({ sent: false, mode: 'SAFE_FALLBACK' });
    }
  });
}

/**
 * DIVIZIA 6: EXECUTION & LIVE TRADE WATCHDOG (25 Agenți: 6A, 6B, 6C)
 */
const Div6ExecutionWatch = {
  /**
   * Ramura 6A (5 Agenți): Telegram Market Execution Dispatcher (180s Validity)
   * Emite semnalul de intrare pe loc la piață (BUY / SELL BY MARKET NOW @ Spot)
   * doar dacă Ramura 5A și Ramura 5C au aprobat semnalul (>= 85/100).
   */
  branch6A_TelegramMarketDispatcher: async ({ symbol, stateBus, config, context }) => {
    const r5A = stateBus.getBranchReport(symbol, '5A');
    const r5C = stateBus.getBranchReport(symbol, '5C');
    const r4A = stateBus.getBranchReport(symbol, '4A');
    const r4B = stateBus.getBranchReport(symbol, '4B');
    const r1A = stateBus.getBranchReport(symbol, '1A');

    if (!r5A || !r5A.approved || !r5C || !r5C.approved || !r4A || !r4A.approved) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: false,
        veto: false,
        data: { dispatched: false, reason: 'AWAITING_BOARD_APPROVAL_85' }
      };
    }

    const existingTrade = stateBus.getActiveTrade(symbol);
    if (existingTrade) {
      return {
        status: 'OK',
        direction: existingTrade.direction,
        score: r5A.score,
        approved: false,
        veto: false,
        data: { dispatched: false, reason: 'ACTIVE_TRADE_ALREADY_REGISTERED' }
      };
    }

    const dir = r4A.direction;
    const actionVerb = dir === 'LONG' ? '🟢 BUY BY MARKET NOW' : '🔴 SELL BY MARKET NOW';
    const d4 = r4A.data;
    const policy = (config && config.executionPolicy) || {};
    const validitySec = policy.marketSignalValiditySeconds || 180;
    const chasePct = (r4B && r4B.data && typeof r4B.data.chasePct === 'number') ? r4B.data.chasePct : 0;
    const spreadPips = (r1A && r1A.data && typeof r1A.data.spreadPips === 'number')
      ? r1A.data.spreadPips
      : d4.spreadPipsIncluded;

    const telegramMessage = [
      `⚡ *APEX 300-AGENT INSTITUTIONAL DESK* ⚡`,
      `📌 *Instrument:* \`${symbol}\` (0-Delay Spot)`,
      `🎯 * Ordin:* *${actionVerb}*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `📍 *INTRARE PE LOC (SPOT):* \`${d4.marketEntryPrice}\``,
      `🛑 *STOP LOSS (Spread+${d4.slBufferPipsIncluded}p):* \`${d4.stopLoss}\` (\`${d4.riskPips} pips\`)`,
      `🛡️ *PROTECTED BREAK-EVEN (Spread+0.5p):* \`${d4.protectedBreakEvenPrice}\``,
      `💰 *TAKE PROFIT 1 (${d4.rrTp1} R:R - True BE):* \`${d4.tp1}\``,
      `🔒 *TRAILING LOCK (${d4.rrTp15} R:R -> SL @ TP1):* \`${d4.tp15TrailingLock}\``,
      `🚀 *TAKE PROFIT 2 (${d4.rrTp2} R:R - Target):* \`${d4.tp2}\``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `🏛️ *Scor Confluență:* *${r5A.score}/100* (Prag >= 85)`,
      `📏 *Anti-Chase:* \`${chasePct}%\` din max 15% | *Spread:* \`${spreadPips} pips\` (\`${d4.spreadToRiskPct}%\` din SL)`,
      `⏱️ *Valabilitate Fereastră Market:* \`${validitySec} secunde\``
    ].join('\n');

    const registered = stateBus.registerActiveTrade(symbol, {
      direction: dir,
      marketEntryPrice: d4.marketEntryPrice,
      protectedBreakEvenPrice: d4.protectedBreakEvenPrice,
      stopLoss: d4.stopLoss,
      currentStopLoss: d4.stopLoss,
      tp1: d4.tp1,
      tp15TrailingLock: d4.tp15TrailingLock,
      tp2: d4.tp2,
      riskPips: d4.riskPips,
      spreadPips,
      confluenceScore: r5A.score,
      validitySec,
      tp15Hit: false,
      telegramMessage
    });

    const tgResult = await dispatchTelegramMessage(telegramMessage, Boolean(context && context.sendLiveTelegram));

    return {
      status: 'OK',
      direction: dir,
      score: r5A.score,
      approved: true,
      veto: false,
      data: {
        dispatched: true,
        telegramDelivery: tgResult,
        trade: registered,
        telegramMessage
      }
    };
  },

  /**
   * Ramura 6B (12 Agenți): True Break-Even (TP1), Trailing Structure Lock (2.2 R:R) & 180s TTL Watchdog
   * Monitorizează prețul Spot pe trade-urile active:
   * - La TP1 (1.5 R:R): setează SL pe `protectedBreakEvenPrice` = `marketEntryPrice +/- (spreadPips + 0.5 pips)`
   * - La TP1.5 (2.2 R:R): setează SL pe nivelul `TP1` (1.5 R:R profit garantat!)
   * - După 180 secunde (`marketSignalValiditySeconds`): emite `SIGNAL EXPIRED (TTL 180s)`.
   */
  branch6B_BreakEvenWatchdog: async ({ symbol, marketData, stateBus, config }) => {
    const trade = stateBus.getActiveTrade(symbol);
    if (!trade || !marketData || marketData.spotMid === null || marketData.spotMid === undefined || isNaN(marketData.spotMid)) {
      return {
        status: 'OK',
        score: 0,
        approved: false,
        veto: false,
        data: { watching: false }
      };
    }

    const inst = (config.instruments && config.instruments[symbol]) || { pipSize: 0.0001, decimals: 5 };
    const decimals = typeof inst.decimals === 'number' ? inst.decimals : 5;
    const pipSize = inst.pipSize || 0.0001;
    const spot = Number(Number(marketData.spotMid).toFixed(decimals));

    const now = (marketData.referenceTime && marketData.referenceTime > trade.openedAt)
      ? marketData.referenceTime
      : Date.now();
    const elapsedSec = typeof marketData.simulatedElapsedSec === 'number'
      ? marketData.simulatedElapsedSec
      : Math.max(0, Math.round((now - trade.openedAt) / 1000));

    const validitySec = (config.executionPolicy && config.executionPolicy.marketSignalValiditySeconds) || 180;
    const alerts = [];

    // Calculăm protectedBreakEvenPrice = marketEntryPrice +/- (spreadPips + 0.5 pips)
    const spreadPips = typeof trade.spreadPips === 'number'
      ? trade.spreadPips
      : (typeof marketData.spreadPips === 'number' ? marketData.spreadPips : 1.0);
    const beOffset = (spreadPips + 0.5) * pipSize;
    const protectedBreakEvenPrice = typeof trade.protectedBreakEvenPrice === 'number'
      ? trade.protectedBreakEvenPrice
      : Number((trade.direction === 'LONG' ? trade.marketEntryPrice + beOffset : trade.marketEntryPrice - beOffset).toFixed(decimals));

    const riskDist = Math.abs(trade.marketEntryPrice - trade.stopLoss);
    const tp15TrailingLock = typeof trade.tp15TrailingLock === 'number'
      ? trade.tp15TrailingLock
      : Number((trade.direction === 'LONG' ? trade.marketEntryPrice + riskDist * 2.2 : trade.marketEntryPrice - riskDist * 2.2).toFixed(decimals));

    // 1. Verificare atingere TP1 (1.5 R:R) -> Mutare SL la Protected Break-Even (Entry + Spread + 0.5p)
    const hitTp1Now = !trade.tp1Hit && (
      (trade.direction === 'LONG' && spot >= trade.tp1) ||
      (trade.direction === 'SHORT' && spot <= trade.tp1)
    );

    if (hitTp1Now) {
      trade.tp1Hit = true;
      trade.protectedBreakEvenPrice = protectedBreakEvenPrice;
      trade.currentStopLoss = protectedBreakEvenPrice;
      stateBus.saveSnapshot();
      alerts.push(
        `🛡️ [WATCHDOG 6B] ${symbol} TP1 ATINS (${trade.tp1})! Mută SL la Protected Break-Even (@ ${protectedBreakEvenPrice} = Entry + Spread + 0.5p) și încasează 50%!`
      );
    }

    // 2. Verificare atingere Prag Intermediar TP1.5 (2.2 R:R Trailing Structure Lock) -> Mutare SL pe TP1 (1.5 R:R garantat!)
    const hitTp15Now = !trade.tp15Hit && (
      (trade.direction === 'LONG' && spot >= tp15TrailingLock) ||
      (trade.direction === 'SHORT' && spot <= tp15TrailingLock)
    );

    if (hitTp15Now) {
      trade.tp1Hit = true;
      trade.tp15Hit = true;
      trade.tp15TrailingLock = tp15TrailingLock;
      trade.currentStopLoss = trade.tp1;
      stateBus.saveSnapshot();
      alerts.push(
        `🔒 [WATCHDOG 6B] BLOCARE PROFIT (${symbol} @ 2.2 R:R = ${tp15TrailingLock}) -> Mută SL pe nivelul TP1 (${trade.tp1} - 1.5 R:R garantat)!`
      );
    }

    // 3. Verificare expirare fereastră 180s (SIGNAL EXPIRED TTL 180s)
    if (!trade.expiredNotified && elapsedSec >= validitySec) {
      trade.expiredNotified = true;
      stateBus.saveSnapshot();
      alerts.push(
        `⏱️ [WATCHDOG 6B] SIGNAL EXPIRED (TTL ${validitySec}s) pe ${symbol}! Fereastra de ${validitySec}s a expirat — nu mai intrați întârziat!`
      );
    }

    return {
      status: 'OK',
      direction: trade.direction,
      score: 0,
      approved: true,
      veto: false,
      data: {
        watching: true,
        spotPrice: spot,
        protectedBreakEvenPrice,
        tp15TrailingLock,
        currentStopLoss: trade.currentStopLoss || trade.stopLoss,
        tp1Hit: Boolean(trade.tp1Hit),
        tp15Hit: Boolean(trade.tp15Hit),
        expiredNotified: Boolean(trade.expiredNotified),
        elapsedSec,
        alerts
      }
    };
  },

  /**
   * Ramura 6C (8 Agenți): Panic Exit & Post-Trade Feedback Loop
   * Monitorizează atingerea TP2 (Full Target 3.0 R:R), atingerea SL-ului dinamic (SL inițial / Protected BE / Trailing TP1),
   * închide poziția în MarketStateBus și transmite rezultatul către Divizia 7 AI Research.
   */
  branch6C_PanicExitFeedback: async ({ symbol, marketData, stateBus }) => {
    const trade = stateBus.getActiveTrade(symbol);
    if (!trade || !marketData || marketData.spotMid === null || marketData.spotMid === undefined || isNaN(marketData.spotMid)) {
      return {
        status: 'OK',
        score: 0,
        approved: false,
        veto: false,
        data: { activeTradeClosed: false }
      };
    }

    const spot = Number(marketData.spotMid);
    const activeSl = typeof trade.currentStopLoss === 'number'
      ? trade.currentStopLoss
      : (trade.tp1Hit ? (trade.protectedBreakEvenPrice || trade.marketEntryPrice) : trade.stopLoss);

    let outcome = null;
    let closeMessage = null;

    if (trade.direction === 'LONG') {
      if (spot >= trade.tp2) {
        outcome = 'TP2_FULL_WIN';
        closeMessage = `🚀 [6C TARGET HIT] ${symbol} LONG a atins TP2 (${trade.tp2})! Profit complet +3.0 R:R!`;
      } else if (spot <= activeSl) {
        if (trade.tp15Hit) {
          outcome = 'TRAILING_TP1_LOCK_WIN';
          closeMessage = `🔒 [6C TRAILING LOCK] ${symbol} LONG închis pe profit garantat la TP1 (${activeSl} = +1.5 R:R).`;
        } else if (trade.tp1Hit) {
          outcome = 'PROTECTED_BREAK_EVEN_EXIT';
          closeMessage = `🛡️ [6C PROTECTED BE] ${symbol} LONG închis la Protected Break-Even (${activeSl}) cu spread acoperit.`;
        } else {
          outcome = 'SL';
          closeMessage = `🛑 [6C STOP LOSS] ${symbol} LONG a atins SL (${activeSl}). Înregistrat în registrul CRO.`;
        }
      }
    } else if (trade.direction === 'SHORT') {
      if (spot <= trade.tp2) {
        outcome = 'TP2_FULL_WIN';
        closeMessage = `🚀 [6C TARGET HIT] ${symbol} SHORT a atins TP2 (${trade.tp2})! Profit complet +3.0 R:R!`;
      } else if (spot >= activeSl) {
        if (trade.tp15Hit) {
          outcome = 'TRAILING_TP1_LOCK_WIN';
          closeMessage = `🔒 [6C TRAILING LOCK] ${symbol} SHORT închis pe profit garantat la TP1 (${activeSl} = +1.5 R:R).`;
        } else if (trade.tp1Hit) {
          outcome = 'PROTECTED_BREAK_EVEN_EXIT';
          closeMessage = `🛡️ [6C PROTECTED BE] ${symbol} SHORT închis la Protected Break-Even (${activeSl}) cu spread acoperit.`;
        } else {
          outcome = 'SL';
          closeMessage = `🛑 [6C STOP LOSS] ${symbol} SHORT a atins SL (${activeSl}). Înregistrat în registrul CRO.`;
        }
      }
    }

    if (outcome) {
      const closed = stateBus.closeActiveTrade(symbol, outcome);
      return {
        status: 'OK',
        direction: trade.direction,
        score: 0,
        approved: true,
        veto: false,
        data: {
          activeTradeClosed: true,
          outcome,
          closeMessage,
          closedTrade: closed
        }
      };
    }

    return {
      status: 'OK',
      direction: trade.direction,
      score: 0,
      approved: true,
      veto: false,
      data: {
        activeTradeClosed: false,
        statusNote: 'TRADE_RUNNING_NORMALLY',
        currentSpot: spot,
        activeSl
      }
    };
  }
};

module.exports = { Div6ExecutionWatch };
