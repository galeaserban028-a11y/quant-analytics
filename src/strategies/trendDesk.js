'use strict';

/**
 * DEPARTAMENTUL TREND — ansamblu de canale Donchian pe H4, cu trailing stop pe ATR.
 *
 * De ce: momentum-ul de serie temporală este una dintre puținele anomalii documentate robust în crypto
 * (Liu & Tsyvinski, NBER w24877; Zarattini/Pagani/Barbon, "Catching Crypto Trends"). Pe H4, stopul este
 * de câteva procente, deci comisionul de 0.15% devine neglijabil față de risc — exact problema care
 * omoară strategiile pe M15.
 *
 * Reguli (pure, fără look-ahead; decizia se ia la închiderea lumânării H4):
 *  - Vot pe fiecare lookback N: +1 dacă close > maximul celor N lumânări ANTERIOARE, −1 dacă close < minimul lor,
 *    altfel își păstrează votul precedent (stare tip Turtle).
 *  - Ansamblu = media voturilor. Intrare LONG când ansamblul ≥ +entry, SHORT (dacă e permis) când ≤ −entry.
 *  - Stop inițial = intrare ∓ k × ATR(14, H4); apoi trailing (chandelier): cel mai bun close de la intrare ∓ k × ATR.
 *  - Ieșire la atingerea stopului (verificat pe high/low, cu umplere la open în caz de gap) sau când ansamblul
 *    se întoarce în direcția opusă (ieșire la close).
 *  - Rezultatul în R (față de riscul inițial), cu spread + comision scăzute.
 */
const { aggregate, computeATR, normalizeCandles } = require('../core/candles');

const H4_MS = 4 * 3600e3;

const DEFAULT_PARAMS = { lookbacks: [20, 40, 80], entry: 0.6, atrMult: 3, allowShort: true };

/** Starea voturilor Donchian, actualizată incremental la fiecare lumânare închisă. */
function updateVotes(h4, i, lookbacks, prevVotes) {
  const votes = prevVotes ? prevVotes.slice() : lookbacks.map(() => 0);
  const c = h4[i].close;
  lookbacks.forEach((n, k) => {
    if (i < n) return;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n; j < i; j++) { hi = Math.max(hi, h4[j].high); lo = Math.min(lo, h4[j].low); }
    if (c > hi) votes[k] = 1;
    else if (c < lo) votes[k] = -1;
  });
  return votes;
}

/**
 * Simulează departamentul pe un simbol. Returnează tranzacțiile închise.
 * @param {Array} m15 lumânări M15 normalizate
 * @param {object} inst config instrument (pipSize, typicalSpreadPips, commissionPct, commissionPips)
 * @param {object} params
 * @param {object} [opts] { tradeFromTs, tradeUntilTs, spreadMultiplier }
 */
function simulateSymbol(symbol, m15, inst, params = DEFAULT_PARAMS, opts = {}) {
  const norm = normalizeCandles(m15);
  const h4 = aggregate(norm, H4_MS);
  // ultima lumânare H4 poate fi incompletă — o eliminăm (nu era închisă)
  const lastM15 = norm[norm.length - 1];
  if (h4.length && lastM15 && h4[h4.length - 1].timestamp + H4_MS > lastM15.timestamp + 15 * 60e3) h4.pop();
  return simulateBars(symbol, h4, inst, params, opts);
}

/** Simulează pe lumânări H4 deja închise (ex. istoric lung descărcat direct pe H4). */
function simulateBars(symbol, h4, inst, params = DEFAULT_PARAMS, opts = {}) {
  const p = Object.assign({}, DEFAULT_PARAMS, params);
  const BAR = opts.barMs || H4_MS; // durata unei lumânări (H4 implicit; D1 pentru Forex)
  // Cost de finanțare (swap) pe an, ca fracție din valoarea nominală; se scade proporțional cu zilele deținute
  const swapRate = (inst.swapRatePct || 0) / 100;

  const spread = (inst.typicalSpreadPips || 0) * inst.pipSize * (opts.spreadMultiplier != null ? opts.spreadMultiplier : 1);
  const from = opts.tradeFromTs || -Infinity;
  const until = opts.tradeUntilTs || Infinity;
  const warm = Math.max(...p.lookbacks) + 15;
  const costMult = opts.costMultiplier != null ? opts.costMultiplier : 1;
  const trades = [];
  let votes = null;
  let pos = null;
  let pending = null; // intrare amânată la open-ul lumânării următoare (test de stres: latență)

  const openPosition = (dir, price, atr, at, best) => {
    const entry = dir === 'LONG' ? price + spread : price;
    const stop = dir === 'LONG' ? entry - p.atrMult * atr : entry + p.atrMult * atr;
    const risk = Math.abs(entry - stop);
    const commission = ((inst.commissionPips || 0) * inst.pipSize + (inst.commissionPct || 0) * entry) * costMult;
    return { symbol, dir, entry, stop, initialStop: stop, risk, best, openedAt: at, costR: commission / risk, swapRPerDay: swapRate / 365 * entry / risk };
  };

  for (let i = 0; i < h4.length; i++) {
    const bar = h4[i];
    const closeTime = bar.timestamp + BAR;

    if (pending && !pos) {
      pos = openPosition(pending.dir, bar.open, pending.atr, bar.timestamp, bar.open);
    }
    pending = null;

    // 1. Gestionarea poziției deschise (pe lumânarea curentă, deschisă după intrare)
    if (pos) {
      const long = pos.dir === 'LONG';
      const exitLow = long ? bar.low : bar.low + spread;
      const exitHigh = long ? bar.high : bar.high + spread;
      const exitOpen = long ? bar.open : bar.open + spread;
      const hit = long ? exitLow <= pos.stop : exitHigh >= pos.stop;
      if (hit) {
        const fill = long ? Math.min(pos.stop, exitOpen) : Math.max(pos.stop, exitOpen);
        trades.push(close(pos, fill, 'STOP', closeTime));
        pos = null;
      }
    }

    votes = updateVotes(h4, i, p.lookbacks, votes);
    if (i < warm) continue;
    const ens = votes.reduce((s, v) => s + v, 0) / votes.length;
    const atr = computeATR(h4.slice(Math.max(0, i - 15), i + 1), 14);
    if (!Number.isFinite(atr) || atr <= 0) continue;

    if (pos) {
      const long = pos.dir === 'LONG';
      // Ieșire pe semnal opus
      if ((long && ens <= -p.entry) || (!long && ens >= p.entry)) {
        const exit = long ? bar.close : bar.close + spread;
        trades.push(close(pos, exit, 'SIGNAL_FLIP', closeTime));
        pos = null;
      } else {
        // Trailing chandelier
        pos.best = long ? Math.max(pos.best, bar.close) : Math.min(pos.best, bar.close);
        const trail = long ? pos.best - p.atrMult * atr : pos.best + p.atrMult * atr + spread;
        pos.stop = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
      }
    }

    if (!pos && closeTime >= from && closeTime < until) {
      let dir = null;
      if (ens >= p.entry) dir = 'LONG';
      else if (p.allowShort && ens <= -p.entry) dir = 'SHORT';
      if (dir) {
        if (opts.entryAtNextOpen) pending = { dir, atr };
        else pos = openPosition(dir, bar.close, atr, closeTime, bar.close);
      }
    }
  }
  if (pos && h4.length) {
    const last = h4[h4.length - 1];
    // starea exactă a poziției încă deschise (folosită de live)
    Object.defineProperty(trades, 'openPosition', { value: Object.assign({}, pos), enumerable: false });
    trades.push(close(pos, pos.dir === 'LONG' ? last.close : last.close + spread, 'END_OF_DATA', last.timestamp + BAR));
  }
  return trades;
}

function close(pos, exit, outcome, at) {
  const sign = pos.dir === 'LONG' ? 1 : -1;
  const gross = sign * (exit - pos.entry) / pos.risk;
  const days = Math.max(0, (at - pos.openedAt) / 864e5);
  const swapR = (pos.swapRPerDay || 0) * days;
  pos = Object.assign({}, pos, { costR: (pos.costR || 0) + swapR });
  return {
    symbol: pos.symbol, direction: pos.dir, desk: 'TREND', entry: pos.entry, initialStopLoss: pos.initialStop,
    exitPrice: exit, outcome, openedAt: pos.openedAt, closedAt: at, costR: pos.costR,
    resultR: Number((gross - pos.costR).toFixed(4))
  };
}

function simulate(dataBySymbol, instruments, params, opts = {}) {
  const all = [];
  for (const [s, bars] of Object.entries(dataBySymbol)) {
    if (!instruments[s]) continue;
    all.push(...(opts.barsAreH4 ? simulateBars(s, bars, instruments[s], params, opts) : simulateSymbol(s, bars, instruments[s], params, opts)));
  }
  return all.sort((a, b) => a.closedAt - b.closedAt);
}

/**
 * Starea LIVE, reconstruită prin rularea ACELUIAȘI simulator pe istoricul recent: dacă ultima tranzacție
 * simulată e încă deschisă la final, aceea este poziția curentă (cu stopul ei de trailing). Astfel live-ul
 * nu poate diverge de backtest.
 */
function liveState(symbol, h4, inst, params = DEFAULT_PARAMS, opts = {}) {
  const BAR = opts.barMs || H4_MS;
  const trades = simulateBars(symbol, h4, inst, params, opts);
  const last = trades[trades.length - 1];
  const lastBar = h4[h4.length - 1];
  if (last && last.outcome === 'END_OF_DATA' && trades.openPosition) {
    const op = trades.openPosition;
    return {
      position: { symbol, direction: op.dir, entry: op.entry, initialStop: op.initialStop, stop: op.stop, openedAt: op.openedAt },
      asOf: lastBar ? lastBar.timestamp + BAR : null,
      lastClosed: trades.length > 1 ? trades[trades.length - 2] : null
    };
  }
  return { position: null, asOf: lastBar ? lastBar.timestamp + BAR : null, lastClosed: last || null };
}

/** Semnalul curent (pentru live): ce ar face departamentul la închiderea ultimei lumânări H4. */
function currentSignal(h4, params = DEFAULT_PARAMS) {
  const p = Object.assign({}, DEFAULT_PARAMS, params);
  let votes = null;
  for (let i = 0; i < h4.length; i++) votes = updateVotes(h4, i, p.lookbacks, votes);
  if (!votes || h4.length < Math.max(...p.lookbacks) + 15) return { direction: 'NEUTRAL', ensemble: 0, ready: false };
  const ens = votes.reduce((s, v) => s + v, 0) / votes.length;
  const atr = computeATR(h4.slice(-16), 14);
  let direction = 'NEUTRAL';
  if (ens >= p.entry) direction = 'LONG';
  else if (p.allowShort && ens <= -p.entry) direction = 'SHORT';
  return { direction, ensemble: ens, atr, ready: true };
}

module.exports = { liveState, simulate, simulateSymbol, simulateBars, currentSignal, updateVotes, DEFAULT_PARAMS, H4_MS };
