'use strict';

/**
 * DEPARTAMENTUL PULLBACK (mean-reversion în direcția trendului mare), pe lumânări zilnice.
 *
 * Idee (Connors, „RSI(2)”): într-o piață aflată deasupra mediei de 200 de zile, o scădere bruscă de 1–3 zile
 * tinde să fie recuperată. Avantaje pentru prop firms: procent mare de câștig, poziții de câteva zile,
 * scăderi de capital mai mici decât la trend-following.
 *
 * Reguli (decizia la închiderea zilei; fără look-ahead):
 *  - Filtru de trend: LONG doar dacă close > SMA(trendLen); SHORT (dacă e permis) doar dacă close < SMA(trendLen).
 *  - Intrare LONG: RSI(2) < entryRsi. Intrare SHORT: RSI(2) > 100 − entryRsi.
 *  - Ieșire: close > SMA(exitLen) pentru LONG (close < SMA(exitLen) pentru SHORT), SAU după maxDays zile.
 *  - Stop de protecție OBLIGATORIU (cerință prop): intrare ∓ stopAtr × ATR(14). Verificat pe high/low, cu gap la open.
 *  - Rezultat în R (față de distanța până la stop), cu spread/comision și swap scăzute.
 */
const { computeATR } = require('../core/candles');

const DAY_MS = 864e5;
const DEFAULT_PARAMS = { trendLen: 200, entryRsi: 10, exitLen: 5, stopAtr: 3, maxDays: 10, allowShort: false };

/** RSI Wilder pe ultimele `period` variații, calculat incremental pentru eficiență. */
function rsiSeries(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  let avgG = 0, avgL = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= period) {
      avgG += g / period; avgL += l / period;
      if (i === period) out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }
  return out;
}

function smaSeries(closes, len) {
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= len) sum -= closes[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

/**
 * @param {string} symbol
 * @param {Array} bars lumânări zilnice închise
 * @param {object} inst specificații (pipSize, typicalSpreadPips, commissionPct, swapRatePct)
 * @param {object} params
 * @param {object} [opts] { tradeFromTs, tradeUntilTs, costMultiplier, spreadMultiplier, barMs }
 */
function simulateBars(symbol, bars, inst, params = DEFAULT_PARAMS, opts = {}) {
  const p = Object.assign({}, DEFAULT_PARAMS, params);
  const BAR = opts.barMs || DAY_MS;
  const spread = (inst.typicalSpreadPips || 0) * inst.pipSize * (opts.spreadMultiplier != null ? opts.spreadMultiplier : 1);
  const costMult = opts.costMultiplier != null ? opts.costMultiplier : 1;
  const swapRate = (inst.swapRatePct || 0) / 100;
  const from = opts.tradeFromTs || -Infinity;
  const until = opts.tradeUntilTs || Infinity;
  const closes = bars.map((b) => b.close);
  const rsi = rsiSeries(closes, 2);
  const smaT = smaSeries(closes, p.trendLen);
  const smaX = smaSeries(closes, p.exitLen);
  const trades = [];
  let pos = null;

  const finish = (exit, outcome, at) => {
    const sign = pos.dir === 'LONG' ? 1 : -1;
    const days = Math.max(0, (at - pos.openedAt) / DAY_MS);
    const costR = pos.costR + swapRate / 365 * pos.entry / pos.risk * days;
    trades.push({
      symbol, direction: pos.dir, desk: 'PULLBACK', entry: pos.entry, initialStopLoss: pos.stop, exitPrice: exit,
      outcome, openedAt: pos.openedAt, closedAt: at, costR, resultR: Number((sign * (exit - pos.entry) / pos.risk - costR).toFixed(4))
    });
    pos = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const closeTime = bar.timestamp + BAR;

    // 1. Stop de protecție (pesimist: verificat primul, pe lumânarea curentă)
    if (pos) {
      const long = pos.dir === 'LONG';
      const exLow = long ? bar.low : bar.low + spread;
      const exHigh = long ? bar.high : bar.high + spread;
      const exOpen = long ? bar.open : bar.open + spread;
      if (long ? exLow <= pos.stop : exHigh >= pos.stop) {
        finish(long ? Math.min(pos.stop, exOpen) : Math.max(pos.stop, exOpen), 'STOP', closeTime);
      }
    }
    if (i < p.trendLen + 15 || !Number.isFinite(smaT[i]) || !Number.isFinite(rsi[i])) continue;

    // 2. Ieșire pe semnal sau timp
    if (pos) {
      const long = pos.dir === 'LONG';
      const held = Math.round((closeTime - pos.openedAt) / DAY_MS);
      const target = long ? bar.close > smaX[i] : bar.close < smaX[i];
      if (target || held >= p.maxDays) finish(long ? bar.close : bar.close + spread, target ? 'TARGET' : 'TIME', closeTime);
    }

    // 3. Intrare
    if (!pos && closeTime >= from && closeTime < until) {
      let dir = null;
      if (bar.close > smaT[i] && rsi[i] < p.entryRsi) dir = 'LONG';
      else if (p.allowShort && bar.close < smaT[i] && rsi[i] > 100 - p.entryRsi) dir = 'SHORT';
      if (dir) {
        const atr = computeATR(bars.slice(Math.max(0, i - 15), i + 1), 14);
        if (Number.isFinite(atr) && atr > 0) {
          const entry = dir === 'LONG' ? bar.close + spread : bar.close;
          const stop = dir === 'LONG' ? entry - p.stopAtr * atr : entry + p.stopAtr * atr;
          const risk = Math.abs(entry - stop);
          const commission = ((inst.commissionPips || 0) * inst.pipSize + (inst.commissionPct || 0) * entry) * costMult;
          pos = { dir, entry, stop, risk, openedAt: closeTime, costR: commission / risk };
        }
      }
    }
  }
  if (pos && bars.length) {
    const last = bars[bars.length - 1];
    const op = Object.assign({}, pos);
    finish(pos.dir === 'LONG' ? last.close : last.close + spread, 'END_OF_DATA', last.timestamp + BAR);
    Object.defineProperty(trades, 'openPosition', { value: op, enumerable: false });
  }
  return trades;
}

function simulate(dataBySymbol, instruments, params, opts = {}) {
  const all = [];
  for (const [s, bars] of Object.entries(dataBySymbol)) {
    if (!instruments[s]) continue;
    all.push(...simulateBars(s, bars, instruments[s], params, opts));
  }
  return all.sort((a, b) => a.closedAt - b.closedAt);
}

/** Starea live = același simulator rulat pe istoric (identic cu backtest-ul). */
function liveState(symbol, bars, inst, params = DEFAULT_PARAMS, opts = {}) {
  const BAR = opts.barMs || DAY_MS;
  const trades = simulateBars(symbol, bars, inst, params, opts);
  const last = trades[trades.length - 1];
  const lastBar = bars[bars.length - 1];
  if (last && last.outcome === 'END_OF_DATA' && trades.openPosition) {
    const op = trades.openPosition;
    return {
      position: { symbol, direction: op.dir, entry: op.entry, initialStop: op.stop, stop: op.stop, openedAt: op.openedAt, exitRule: `ieșire când închiderea trece de media pe ${params.exitLen || DEFAULT_PARAMS.exitLen} zile sau după ${params.maxDays || DEFAULT_PARAMS.maxDays} zile` },
      asOf: lastBar ? lastBar.timestamp + BAR : null,
      lastClosed: trades.length > 1 ? trades[trades.length - 2] : null
    };
  }
  return { position: null, asOf: lastBar ? lastBar.timestamp + BAR : null, lastClosed: last || null };
}

module.exports = { simulate, simulateBars, liveState, rsiSeries, smaSeries, DEFAULT_PARAMS, DAY_MS };
