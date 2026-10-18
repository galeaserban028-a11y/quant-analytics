'use strict';

/**
 * Managementul unei poziții deschise — O SINGURĂ sursă de adevăr, folosită atât live, cât și în backtest.
 *
 * Convenții de preț:
 *  - Prețurile lumânărilor (bar) sunt BID. ASK = BID + spreadPrice.
 *  - LONG intră la ASK și iese la BID. SHORT intră la BID și iese la ASK.
 *  - Toate nivelurile (SL/TP) sunt exprimate în prețul pe care se închide poziția (BID pt LONG, ASK pt SHORT).
 *
 * Ordinea în interiorul unei lumânări este necunoscută, deci modelul este PESIMIST:
 *  1. Întâi se verifică stop-ul curent (dacă extrema adversă îl atinge → închidere la stop, sau la open dacă e gap).
 *  2. Abia apoi se verifică țintele favorabile (TP1 → BE, Trailing → SL pe TP1, TP2 → închidere).
 *  Un stop mutat în această lumânare se verifică abia de la lumânarea următoare.
 *
 * Rezultatul este măsurat în R (multipli ai riscului inițial entry→SL), cu comisioane scăzute.
 */

function createTrade({ symbol, direction, entry, stopLoss, tp1, trailingLock, tp2, protectedBreakEven, openedAt, partialPct = 0.5, costR = 0, meta = {} }) {
  const riskDistance = Math.abs(entry - stopLoss);
  if (!(riskDistance > 0)) throw new Error('INVALID_RISK_DISTANCE');
  if (direction !== 'LONG' && direction !== 'SHORT') throw new Error('INVALID_DIRECTION');
  return {
    symbol,
    direction,
    entry,
    initialStopLoss: stopLoss,
    currentStopLoss: stopLoss,
    tp1,
    trailingLock,
    tp2,
    protectedBreakEven,
    riskDistance,
    partialPct,
    remaining: 1,
    realizedR: 0,
    costR,
    tp1Hit: false,
    trailHit: false,
    openedAt,
    closedAt: null,
    outcome: null,
    resultR: null,
    meta
  };
}

function rMultiple(trade, exitPrice) {
  const sign = trade.direction === 'LONG' ? 1 : -1;
  return sign * (exitPrice - trade.entry) / trade.riskDistance;
}

function closeTrade(trade, exitPrice, outcome, at) {
  trade.realizedR += trade.remaining * rMultiple(trade, exitPrice);
  trade.remaining = 0;
  trade.closedAt = at;
  trade.outcome = outcome;
  trade.exitPrice = exitPrice;
  trade.resultR = Number((trade.realizedR - trade.costR).toFixed(4));
  return trade;
}

/**
 * Evaluează poziția pe o lumânare (sau pe un tick, cu open=high=low=close=bid).
 * Returnează { trade, events, closed }. Obiectul trade este copiat (nu se modifică inputul).
 */
function evaluateTradeOnBar(inputTrade, bar, spreadPrice = 0) {
  const trade = Object.assign({}, inputTrade);
  const events = [];
  if (trade.closedAt) return { trade, events, closed: true };

  const long = trade.direction === 'LONG';
  // Prețul de ieșire pentru poziție: BID pentru LONG, ASK pentru SHORT
  const exitOpen = long ? bar.open : bar.open + spreadPrice;
  const exitHigh = long ? bar.high : bar.high + spreadPrice;
  const exitLow = long ? bar.low : bar.low + spreadPrice;
  const at = bar.timestamp || Date.now();

  // 1. Stop (pesimist: verificat primul)
  const stop = trade.currentStopLoss;
  const stopHit = long ? exitLow <= stop : exitHigh >= stop;
  if (stopHit) {
    // Gap peste stop → umplere la open (mai rău decât stop-ul)
    const fill = long ? Math.min(stop, exitOpen) : Math.max(stop, exitOpen);
    const outcome = trade.trailHit ? 'TRAIL' : (trade.tp1Hit ? 'BE' : 'SL');
    closeTrade(trade, fill, outcome, at);
    events.push({ type: 'CLOSED', outcome, price: fill, resultR: trade.resultR });
    return { trade, events, closed: true };
  }

  const reached = (level) => (long ? exitHigh >= level : exitLow <= level);

  // 2. TP1 → încasare parțială + SL la Protected Break-Even
  if (!trade.tp1Hit && reached(trade.tp1)) {
    trade.tp1Hit = true;
    const pct = Math.min(1, Math.max(0, trade.partialPct));
    trade.realizedR += pct * rMultiple(trade, trade.tp1);
    trade.remaining = 1 - pct;
    trade.currentStopLoss = trade.protectedBreakEven;
    events.push({ type: 'TP1', price: trade.tp1, newStop: trade.currentStopLoss, partialPct: pct });
    if (trade.remaining <= 0) {
      closeTrade(trade, trade.tp1, 'TP1_FULL', at);
      events.push({ type: 'CLOSED', outcome: 'TP1_FULL', price: trade.tp1, resultR: trade.resultR });
      return { trade, events, closed: true };
    }
  }

  // 3. Trailing lock → SL pe TP1
  if (trade.tp1Hit && !trade.trailHit && reached(trade.trailingLock)) {
    trade.trailHit = true;
    trade.currentStopLoss = trade.tp1;
    events.push({ type: 'TRAIL', price: trade.trailingLock, newStop: trade.currentStopLoss });
  }

  // 4. TP2 → închidere rest
  if (reached(trade.tp2)) {
    closeTrade(trade, trade.tp2, 'TP2', at);
    events.push({ type: 'CLOSED', outcome: 'TP2', price: trade.tp2, resultR: trade.resultR });
    return { trade, events, closed: true };
  }

  return { trade, events, closed: false };
}

/** Închidere forțată la piață (ex: poziție prea veche). */
function forceClose(inputTrade, bidPrice, spreadPrice, outcome, at) {
  const trade = Object.assign({}, inputTrade);
  const exit = trade.direction === 'LONG' ? bidPrice : bidPrice + spreadPrice;
  closeTrade(trade, exit, outcome, at);
  return trade;
}

module.exports = { createTrade, evaluateTradeOnBar, forceClose, rMultiple };
