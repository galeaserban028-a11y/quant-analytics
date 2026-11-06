'use strict';

/**
 * AGENTUL „LICHIDITATE” (stilul prietenului: aur + Nasdaq, M15), LIVE pe prețuri reale.
 *
 * Backtest (2019–2025 aur, 2022–2025 Nasdaq, costuri reale): PIERDE (aur −0,13R, Nasdaq −0,05R pe tranzacție).
 * De aceea pornește la ANTRENAMENT: înregistrează fiecare semnal și rezultatul lui, fără mesaje.
 * Mesaje pe Telegram: doar după absolvire (≥ 100 de tranzacții live, media ≥ +0,05R, t ≥ 1,5),
 * sau, dacă vrei să exersezi pe demo, cu LIQ_DEMO_SIGNALS=1 (mesajele sunt marcate DEMO).
 *
 * Risk management (același pe hârtie și în mesaje):
 *  - cont de 5.000 $ (LIQ_ACCOUNT), risc 0,5% pe tranzacție (LIQ_RISK_PCT);
 *  - cel mult o poziție pe instrument și două în total;
 *  - după 2 pierderi în aceeași zi, agentul se oprește până a doua zi (fără „revenge trading”);
 *  - nu intră după 21:00 ora României și înainte de 09:00 (mesajele ar ajunge prea târziu), nici vineri după 17:00 UTC (weekend).
 */
const A = require('../strategies/liquidityAgent');
const { lotsFor } = require('../prop/lots');

const SYMS = { XAUUSD: { name: 'AUR (XAUUSD)', cost: 0.5, unit: '$' }, NAS100: { name: 'NASDAQ (NAS100)', cost: 3, unit: 'puncte' } };
const MIN_TRADES = 100, MIN_MEAN = 0.05, T_MIN = 1.5;
const M15 = 900e3;

function stats(trades) {
  const r = trades.map((t) => t.r), n = r.length;
  if (!n) return { n: 0, mean: 0, t: 0, totalR: 0, wins: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, wins: r.filter((x) => x > 0).length, mean: Number(mean.toFixed(4)), t: sd > 0 ? Number((mean / (sd / Math.sqrt(n))).toFixed(2)) : 0, totalR: Number(r.reduce((a, b) => a + b, 0).toFixed(2)) };
}
const roParts = (t) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const g = (k) => p.find((x) => x.type === k).value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')), hm: `${g('hour')}:${g('minute')}` };
};

/**
 * @param {(sym, inst) => Promise<Array<{t,o,h,l,c}>>} p.fetchBars lumânări de 15 minute (UTC), ~60 de zile, 23 h/zi (futures)
 */
async function runLiquidityCycle({ bus, instruments, fetchBars, notify = null, now = Date.now(), env = {} }) {
  if (!bus.state.liq || bus.state.liq.v !== 1) bus.state.liq = { v: 1, startedAt: now, trades: [], open: {}, seen: {}, slot: {}, lossDay: {}, graduated: null };
  const book = bus.state.liq;
  const slot = Math.floor((now - 60e3) / M15); // o dată pe sfert de oră, la ~1 minut după închiderea lumânării
  const live = Boolean(book.graduated) || env.LIQ_DEMO_SIGNALS === '1';
  const account = Number(env.LIQ_ACCOUNT || 5000), riskPct = Number(env.LIQ_RISK_PCT || 0.5);
  const report = { opened: 0, closed: 0, errors: {} };

  for (const [sym, meta] of Object.entries(SYMS)) {
    if (book.slot[sym] === slot) continue;
    const inst = instruments[sym];
    let bars;
    try { bars = await fetchBars(sym, inst); } catch (err) { report.errors[sym] = err.message; continue; }
    book.slot[sym] = slot;
    bars = (bars || []).filter((b) => b.t + M15 <= now - 30e3).sort((a, b) => a.t - b.t); // doar lumânări încheiate
    if (bars.length < 400) { report.errors[sym] = `DATE_INSUFICIENTE(${bars.length})`; continue; }
    if (now - bars[bars.length - 1].t > 3 * 3600e3) continue; // piață închisă / date vechi

    // 1. Poziția deschisă: s-a atins SL, TP sau au trecut 24 de ore?
    const op = book.open[sym];
    if (op) {
      const ei = bars.findIndex((b) => b.t >= op.entryT);
      const res = ei >= 0 ? A.settle(bars, ei, op.dir, op.stop, op.tpR, meta.cost) : null;
      if (res && !res.invalid) {
        delete book.open[sym];
        const tr = { sym, setup: op.setup, dir: op.dir, openedAt: op.entryT, closedAt: res.closedAt, outcome: res.outcome, r: Number(res.r.toFixed(3)), live: op.live };
        book.trades.push(tr);
        report.closed++;
        if (res.r < 0) { const d = roParts(res.closedAt).day; book.lossDay[sym + d] = (book.lossDay[sym + d] || 0) + 1; }
        if (op.live && notify) {
          const usd = res.r * op.riskUsd;
          const head = res.outcome === 'TP' ? '✅' : (res.outcome === 'SL' ? '⛔' : '⚠️');
          const what = res.outcome === 'TP' ? 'a atins TP-ul (s-a închis singur)' : (res.outcome === 'SL' ? 'a atins SL-ul (s-a închis singur)' : 'au trecut 24 de ore — ÎNCHIDE ACUM');
          await notify(`${head} <b>DEMO · ${meta.name}</b> ${what}\nRezultat: ${res.r >= 0 ? '+' : ''}${res.r.toFixed(2)}R (≈ ${usd >= 0 ? '+' : '−'}${Math.abs(usd).toFixed(0)} $ pe contul demo)`);
        }
      } else if (ei >= 0 && res && res.invalid) delete book.open[sym];
    }

    // 2. Semnal nou pe ULTIMA lumânare încheiată
    if (book.open[sym]) continue;
    const last = bars[bars.length - 1];
    const sig = A.findSignals(bars).filter((s) => s.t === last.t);
    if (!sig.length || book.seen[sym] === last.t) continue;
    book.seen[sym] = last.t;
    const s = sig[0];
    const ro = roParts(now);
    const lossesToday = book.lossDay[sym + ro.day] || 0;
    const nOpen = Object.keys(book.open).length;
    if (lossesToday >= 2 || nOpen >= 2) { report.skipped = (report.skipped || 0) + 1; continue; }
    const tooLate = ro.hour >= 21 || ro.hour < 9;
    const fridayLate = new Date(now).getUTCDay() === 5 && new Date(now).getUTCHours() >= 17; // nu ținem scalping peste weekend
    if (fridayLate) { report.skipped = (report.skipped || 0) + 1; continue; }
    const riskUsd = account * riskPct / 100;
    const dist = Math.abs(last.c - s.stop);
    const lot = lotsFor(inst, riskUsd, dist + meta.cost, {});
    const sendIt = live && !tooLate && notify;
    book.open[sym] = { dir: s.dir, stop: s.stop, tpR: s.tpR, setup: s.setup, entryT: last.t + M15, ref: last.c, riskUsd: lot.ok ? lot.actualRiskUsd : riskUsd, live: Boolean(sendIt) };
    report.opened++;
    if (sendIt) {
      const dp = sym === 'XAUUSD' ? 1 : 0;
      const tpDist = s.tpR * dist;
      await notify([
        `🧪 <b>DEMO · ${meta.name} — ${s.dir > 0 ? '🟢 BUY' : '🔴 SELL'} ACUM</b> (la prețul pieței)`,
        `Referință: ~${last.c.toFixed(dp)}`,
        `SL: <b>${dist.toFixed(dp)} ${meta.unit}</b> ${s.dir > 0 ? 'sub' : 'peste'} intrare`,
        `TP: <b>${tpDist.toFixed(dp)} ${meta.unit}</b> ${s.dir > 0 ? 'peste' : 'sub'} intrare (${s.tpR}R)`,
        `Lot: <b>${lot.ok ? lot.lots.toFixed(2) : '—'}</b> (cont demo ${account} $, risc ${riskPct}% = ${riskUsd.toFixed(0)} $)`,
        `TF: M15 · ${s.setup}`,
        'Pune SL și TP ca distanță de la prețul tău de intrare (prețurile diferă puțin între platforme).',
        'Doar pe cont DEMO: strategia nu e încă dovedită.'
      ].join('\n'));
    }
  }

  const st = stats(book.trades);
  report.stats = st;
  if (!book.graduated && st.n >= MIN_TRADES && st.mean >= MIN_MEAN && st.t >= T_MIN) {
    book.graduated = { at: now, stats: st };
    if (notify) await notify(`🎓 <b>Agentul „Lichiditate” (aur + Nasdaq, M15) a absolvit antrenamentul!</b> ${st.n} tranzacții live pe prețuri reale, media +${st.mean}R (t = ${st.t}). De acum primești semnalele lui.`);
  }
  if (book.trades.length > 3000) book.trades.splice(0, book.trades.length - 3000);
  return report;
}

module.exports = { runLiquidityCycle, stats, SYMS, MIN_TRADES };
