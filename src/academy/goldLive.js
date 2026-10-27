'use strict';

/**
 * AUR — momentum pe H4, ANTRENAT LIVE pe bani fictivi.
 *
 * Singura strategie pe aur care a ieșit pe plus în cercetare (H4, 2021–2025: +0,24R pe tranzacție), dar nedovedită:
 * câștigul vine mai ales din anii cu trend uriaș (2022, 2025). Aici o verificăm pe prețuri NOI, pe care nu le-a văzut.
 *
 * Cum: o dată pe oră ia lumânările orare reale ale aurului (Yahoo), le grupează în H4, rulează același simulator ca în
 * cercetare (intrare la deschiderea lumânării următoare, stop 3×ATR, costuri reale) și păstrează DOAR tranzacțiile
 * deschise după pornirea antrenamentului. Nu trimite semnale până nu absolvă (minim 30 de tranzacții, media ≥ +0,10R, t ≥ 1,5).
 */
const lab = require('../strategies/dailyLab');

const H4 = 4 * 3600e3;
const PARAMS = { kind: 'mom', lookback: 120, stopAtr: 3, maxDays: 60, allowShort: false, tpR: undefined };
const MIN_TRADES = 30, MIN_MEAN = 0.10, T_MIN = 1.5;
const REFRESH_MS = 55 * 60e3;

function toH4(hours) {
  const m = new Map();
  for (const b of hours) {
    const k = b.t - (b.t % H4);
    const x = m.get(k);
    if (!x) m.set(k, { timestamp: k, open: b.o, high: b.h, low: b.l, close: b.c, n: 1 });
    else { x.high = Math.max(x.high, b.h); x.low = Math.min(x.low, b.l); x.close = b.c; x.n++; }
  }
  return Array.from(m.values()).filter((x) => x.n >= 2).sort((a, b) => a.timestamp - b.timestamp);
}

function stats(trades) {
  const r = trades.map((t) => t.resultR), n = r.length;
  if (!n) return { n: 0, mean: 0, t: 0, totalR: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: Number(mean.toFixed(4)), t: sd > 0 ? Number((mean / (sd / Math.sqrt(n))).toFixed(2)) : 0, totalR: Number(r.reduce((a, b) => a + b, 0).toFixed(2)) };
}

/**
 * @param {(sym, inst) => Promise<Array<{t,o,h,l,c}>>} p.fetchHours lumânări orare ale aurului (cât mai lung istoric, ex. 730 de zile)
 */
async function runGoldCycle({ bus, instruments, fetchHours, notify = null, now = Date.now() }) {
  if (!bus.state.gold || bus.state.gold.v !== 1) bus.state.gold = { v: 1, startedAt: now, trades: [], open: null, lastFetch: 0, graduated: null };
  const book = bus.state.gold;
  if (now - book.lastFetch < REFRESH_MS) return { skipped: 'DEVREME' };
  const inst = Object.assign({}, instruments.XAUUSD, { typicalSpreadPips: 30, commissionPips: 15, swapRatePct: 4 });
  let hours;
  try { hours = await fetchHours('XAUUSD', inst); } catch (err) { return { error: err.message }; }
  book.lastFetch = now;
  const bars = toH4((hours || []).filter((b) => b.t < now - 3600e3)); // doar orele încheiate
  if (bars.length < PARAMS.lookback + 50) return { error: `DATE_INSUFICIENTE(${bars.length})` };
  const trades = lab.simulate({ XAUUSD: bars }, { XAUUSD: inst }, PARAMS, { barMs: H4, execution: 'nextOpen' });
  const closed = trades.filter((t) => t.outcome !== 'END_OF_DATA' && t.openedAt >= book.startedAt);
  const known = new Set(book.trades.map((t) => t.openedAt));
  let added = 0;
  for (const t of closed) if (!known.has(t.openedAt)) { book.trades.push({ openedAt: t.openedAt, closedAt: t.closedAt, direction: t.direction, entry: t.entry, exit: t.exitPrice, outcome: t.outcome, resultR: t.resultR }); added++; }
  const op = trades.openPosition;
  book.open = op && op.openedAt >= book.startedAt ? { direction: op.dir, entry: op.entry, stop: op.stop, openedAt: op.openedAt } : null;
  const s = stats(book.trades);
  if (!book.graduated && s.n >= MIN_TRADES && s.mean >= MIN_MEAN && s.t >= T_MIN) {
    book.graduated = { at: now, stats: s };
    if (notify) await notify(`🎓 <b>Aurul (momentum H4) a absolvit antrenamentul!</b> ${s.n} tranzacții live pe bani fictivi, media +${s.mean}R (t = ${s.t}). Îți propun să-l trecem la semnale reale.`);
  }
  return { added, stats: s, open: Boolean(book.open) };
}

module.exports = { runGoldCycle, toH4, stats, PARAMS, MIN_TRADES, MIN_MEAN, T_MIN };
