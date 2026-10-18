'use strict';

/**
 * LABORATORUL DE STRATEGII ZILNICE — mai multe reguli simple, cunoscute din literatură, rulate pe ACELAȘI motor
 * ca strategia Pullback (aceleași costuri, același stop obligatoriu verificat primul, același swap, fără look-ahead).
 * Fiecare intră în companie DOAR dacă trece walk-forward-ul out-of-sample.
 *
 * Reguli (`params.kind`):
 *  - 'ibs'    Internal Bar Strength: închidere lângă minimul zilei într-un trend ascendent ⇒ cumpără;
 *             ieșire când închiderea trece de maximul zilei precedente (sau după maxDays).
 *  - 'd7'     „Double Seven” (Connors): închidere = cea mai mică din ultimele N zile, peste media lungă ⇒ cumpără;
 *             ieșire la cea mai mare închidere din ultimele N zile.
 *  - 'down'   N zile la rând cu închideri mai mici, peste media lungă ⇒ cumpără; ieșire peste media scurtă.
 *  - 'tom'    Efectul de sfârșit de lună (indici): cumpără la închiderea penultimei/ultimei zile a lunii,
 *             vinde după a N-a zi de tranzacționare a lunii noi.
 * Pentru toate (exceptând 'tom'), vânzarea în lipsă e oglinda (sub media lungă), dacă allowShort.
 */
const { computeATR } = require('../core/candles');
const { smaSeries, rsiSeries } = require('./meanRevDesk');

const DAY_MS = 864e5;

/** Câte zile lucrătoare (luni–vineri) mai urmează în aceeași lună după data dată (UTC). Fără look-ahead: doar calendarul. */
function weekdaysLeftInMonth(ts) {
  const d = new Date(ts);
  const m = d.getUTCMonth();
  let n = 0;
  for (let k = 1; k <= 7; k++) {
    const x = new Date(ts + k * DAY_MS);
    if (x.getUTCMonth() !== m) break;
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

function makeRules(bars, p) {
  const closes = bars.map((b) => b.close);
  const smaT = p.trendLen ? smaSeries(closes, p.trendLen) : closes.map(() => NaN);
  const smaX = smaSeries(closes, p.exitLen || 5);
  const above = (i) => (p.trendLen ? closes[i] > smaT[i] : true);
  const below = (i) => (p.trendLen ? closes[i] < smaT[i] : false);
  const ibs = (b) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);
  const minMax = (i, n) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) { lo = Math.min(lo, closes[k]); hi = Math.max(hi, closes[k]); }
    return [lo, hi];
  };
  const ready = (i) => !p.trendLen || Number.isFinite(smaT[i]);

  switch (p.kind) {
    case 'ibs':
      return {
        warm: (p.trendLen || 0) + 15,
        entry(i) {
          if (!ready(i)) return null;
          const v = ibs(bars[i]);
          if (above(i) && v < p.ibsEntry) return 'LONG';
          if (p.allowShort && below(i) && v > 1 - p.ibsEntry) return 'SHORT';
          return null;
        },
        exit(i, pos) {
          return pos.dir === 'LONG' ? closes[i] > bars[i - 1].high : closes[i] < bars[i - 1].low;
        }
      };
    case 'd7':
      return {
        warm: Math.max(p.trendLen || 0, p.lookback) + 15,
        entry(i) {
          if (!ready(i)) return null;
          const [lo, hi] = minMax(i, p.lookback);
          if (above(i) && closes[i] <= lo) return 'LONG';
          if (p.allowShort && below(i) && closes[i] >= hi) return 'SHORT';
          return null;
        },
        exit(i, pos) {
          const [lo, hi] = minMax(i, p.lookback);
          return pos.dir === 'LONG' ? closes[i] >= hi : closes[i] <= lo;
        }
      };
    case 'down':
      return {
        warm: (p.trendLen || 0) + 15,
        entry(i) {
          if (!ready(i) || i < p.nDays) return null;
          let dn = true, up = true;
          for (let k = 0; k < p.nDays; k++) {
            if (!(closes[i - k] < closes[i - k - 1])) dn = false;
            if (!(closes[i - k] > closes[i - k - 1])) up = false;
          }
          if (above(i) && dn) return 'LONG';
          if (p.allowShort && below(i) && up) return 'SHORT';
          return null;
        },
        exit(i, pos) {
          return pos.dir === 'LONG' ? closes[i] > smaX[i] : closes[i] < smaX[i];
        }
      };
    case 'rsi2': {
      const rsi = rsiSeries(closes, 2);
      return {
        warm: (p.trendLen || 0) + 15,
        entry(i) {
          if (!ready(i) || !Number.isFinite(rsi[i])) return null;
          if (above(i) && rsi[i] < p.entryRsi) return 'LONG';
          if (p.allowShort && below(i) && rsi[i] > 100 - p.entryRsi) return 'SHORT';
          return null;
        },
        exit(i, pos) {
          return pos.dir === 'LONG' ? closes[i] > smaX[i] : closes[i] < smaX[i];
        }
      };
    }
    case 'tom':
      return {
        warm: (p.trendLen || 0) + 15,
        entry(i) {
          if (!ready(i) || !above(i)) return null;
          // decizia se ia la închiderea zilei i, cunoscând doar calendarul (sărbătorile pot decala cu o zi)
          return weekdaysLeftInMonth(bars[i].timestamp) === p.entryDaysBefore - 1 ? 'LONG' : null;
        },
        exit(i, pos) {
          const d = new Date(bars[i].timestamp);
          const o = new Date(pos.openedAt - DAY_MS);
          if (d.getUTCMonth() === o.getUTCMonth()) return false;
          // a câta zi de tranzacționare a lunii noi e bara i (numărăm barele din date, nu calendarul)
          let n = 0;
          for (let k = i; k >= 0 && new Date(bars[k].timestamp).getUTCMonth() === d.getUTCMonth(); k--) n += 1;
          return n >= p.exitDay;
        }
      };
    default:
      throw new Error(`STRATEGIE_NECUNOSCUTĂ: ${p.kind}`);
  }
}

/**
 * Același contract ca meanRevDesk.simulateBars: tranzacții cu resultR (după costuri), stop obligatoriu,
 * poziția încă deschisă la final apare ca END_OF_DATA și în trades.openPosition.
 */
function simulateBars(symbol, bars, inst, params, opts = {}) {
  const p = Object.assign({ maxDays: 10, stopAtr: 3, allowShort: false }, params);
  const BAR = opts.barMs || DAY_MS;
  const spread = (inst.typicalSpreadPips || 0) * inst.pipSize * (opts.spreadMultiplier != null ? opts.spreadMultiplier : 1);
  const costMult = opts.costMultiplier != null ? opts.costMultiplier : 1;
  const swapRate = (inst.swapRatePct || 0) / 100;
  const from = opts.tradeFromTs || -Infinity;
  const until = opts.tradeUntilTs || Infinity;
  const rules = makeRules(bars, p);
  const trades = [];
  let pos = null;
  const desk = String(p.kind).toUpperCase();

  const finish = (exit, outcome, at) => {
    const sign = pos.dir === 'LONG' ? 1 : -1;
    const days = Math.max(0, (at - pos.openedAt) / DAY_MS);
    const costR = pos.costR + swapRate / 365 * pos.entry / pos.risk * days;
    trades.push({
      symbol, direction: pos.dir, desk, entry: pos.entry, initialStopLoss: pos.stop, exitPrice: exit,
      outcome, openedAt: pos.openedAt, closedAt: at, costR, resultR: Number((sign * (exit - pos.entry) / pos.risk - costR).toFixed(4))
    });
    pos = null;
  };

  // execution: 'close' (la închiderea zilei semnalului) sau 'nextOpen' (a doua zi la deschidere: cum execută un om dimineața)
  const nextOpen = opts.execution === 'nextOpen';
  let pendingEntry = null, pendingExit = null;
  const openPos = (dir, px, atr, openedAt) => {
    const entry = dir === 'LONG' ? px + spread : px;
    const stop = dir === 'LONG' ? entry - p.stopAtr * atr : entry + p.stopAtr * atr;
    const risk = Math.abs(entry - stop);
    const commission = ((inst.commissionPips || 0) * inst.pipSize + (inst.commissionPct || 0) * entry) * costMult;
    pos = { dir, entry, stop, risk, openedAt, costR: commission / risk };
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const closeTime = bar.timestamp + BAR;
    if (nextOpen) {
      if (pos && pendingExit) finish(pos.dir === 'LONG' ? bar.open : bar.open + spread, pendingExit, bar.timestamp);
      pendingExit = null;
      if (!pos && pendingEntry) openPos(pendingEntry.dir, bar.open, pendingEntry.atr, bar.timestamp);
      pendingEntry = null;
    }
    if (pos) {
      const long = pos.dir === 'LONG';
      const exLow = long ? bar.low : bar.low + spread;
      const exHigh = long ? bar.high : bar.high + spread;
      const exOpen = long ? bar.open : bar.open + spread;
      if (long ? exLow <= pos.stop : exHigh >= pos.stop) finish(long ? Math.min(pos.stop, exOpen) : Math.max(pos.stop, exOpen), 'STOP', closeTime);
    }
    if (i < rules.warm) continue;
    if (pos) {
      const held = Math.round((closeTime - pos.openedAt) / DAY_MS);
      const hit = rules.exit(i, pos);
      if (hit || held >= p.maxDays) {
        const outcome = hit ? 'TARGET' : 'TIME';
        if (nextOpen) pendingExit = outcome;
        else finish(pos.dir === 'LONG' ? bar.close : bar.close + spread, outcome, closeTime);
      }
    }
    if (!pos && closeTime >= from && closeTime < until) {
      const dir = rules.entry(i);
      if (dir) {
        const atr = computeATR(bars.slice(Math.max(0, i - 15), i + 1), 14);
        if (Number.isFinite(atr) && atr > 0) {
          if (nextOpen) pendingEntry = { dir, atr };
          else openPos(dir, bar.close, atr, closeTime);
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
  const only = params.categories;
  for (const [s, bars] of Object.entries(dataBySymbol)) {
    const inst = instruments[s];
    if (!inst || (only && !only.includes(inst.category))) continue;
    all.push(...simulateBars(s, bars, inst, params, opts));
  }
  return all.sort((a, b) => a.closedAt - b.closedAt);
}

/** Starea live (identică cu backtest-ul). */
function liveState(symbol, bars, inst, params, opts = {}) {
  const BAR = opts.barMs || DAY_MS;
  const trades = simulateBars(symbol, bars, inst, params, opts);
  const last = trades[trades.length - 1];
  const lastBar = bars[bars.length - 1];
  if (last && last.outcome === 'END_OF_DATA' && trades.openPosition) {
    const op = trades.openPosition;
    return {
      position: { symbol, direction: op.dir, entry: op.entry, initialStop: op.stop, stop: op.stop, openedAt: op.openedAt, desk: String(params.kind).toUpperCase() },
      asOf: lastBar ? lastBar.timestamp + BAR : null,
      lastClosed: trades.length > 1 ? trades[trades.length - 2] : null
    };
  }
  return { position: null, asOf: lastBar ? lastBar.timestamp + BAR : null, lastClosed: last || null };
}

module.exports = { simulate, simulateBars, liveState, makeRules, weekdaysLeftInMonth, DAY_MS };
