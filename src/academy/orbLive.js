'use strict';

/**
 * SCALPING M15 — spargerea deschiderii bursei americane (S&P 500, Nasdaq), ANTRENATĂ LIVE pe bani fictivi.
 *
 *  1. PE HÂRTIE (acum): în fiecare zi de bursă, după 16:15 New York, ia lumânările reale de 15 minute (Yahoo) și înregistrează
 *     ce ar fi făcut strategia, cu costuri prudente. Nu trimite nimic.
 *  2. ABSOLVIREA: după cel puțin MIN_TRADES tranzacții live (~2,5–3 luni), dacă media ≥ MIN_MEAN și t ≥ T_MIN, te anunță.
 *  3. SEMNALE REALE (doar după absolvire), pentru un cont separat:
 *     ~17:00 România: două ordine în așteptare (BUY STOP / SELL STOP), stop pe partea opusă, lot pentru riscul ales;
 *     ~21:00 România: mesajul de închidere. Se oprește singură dacă ultimele 60 de tranzacții ies pe minus.
 */
const O = require('../strategies/openingBreakout');
const { lotsFor } = require('../prop/lots');
const { escapeHtml } = require('../notify/telegram');

const SYMS = ['SPX500', 'NAS100'];
const COST_PTS = { SPX500: 0.8, NAS100: 2.5 }; // spread + comision + alunecare (prudent; Yahoo nu dă spread)
const MIN_TRADES = 100;
const MIN_MEAN = 0.05;
const T_MIN = 1.5;

function stats(trades) {
  const r = trades.map((t) => t.resultR), n = r.length;
  if (!n) return { n: 0, mean: 0, t: 0, totalR: 0, winPct: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: Number(mean.toFixed(4)), t: sd > 0 ? Number((mean / (sd / Math.sqrt(n))).toFixed(2)) : 0, totalR: Number(r.reduce((a, b) => a + b, 0).toFixed(2)), winPct: Number((r.filter((x) => x > 0).length / n * 100).toFixed(1)) };
}

function initBook(now) { return { v: 1, startedAt: now, trades: [], skips: {}, settled: {}, graduated: null, paused: false, sentPlan: {}, sentClose: {} }; }

/**
 * @param {object} p
 * @param {(sym, inst) => Promise<Array<{t,o,h,l,c}>>} p.fetchBars lumânări de 15 minute (UTC), ~30+ zile
 * @param {object} [p.env] ORB_RISK_PCT (implicit 0,5), ORB_ACCOUNT (implicit 5000)
 */
async function runOrbCycle({ bus, instruments, fetchBars, notify = null, now = Date.now(), env = {}, syms = SYMS }) {
  if (!bus.state.orb || bus.state.orb.v !== 1) bus.state.orb = initBook(now);
  const book = bus.state.orb;
  const q = O.PARAMS;
  const L = O.local(now, q.tz);
  const weekday = L.wd !== 'Sat' && L.wd !== 'Sun';
  const live = Boolean(book.graduated && !book.paused);
  const report = { settled: 0, plans: 0, errors: {} };
  const needSettle = (s) => weekday && L.hm >= q.close + 0.25 && book.settled[s] !== L.d;
  const needPlan = (s) => live && weekday && L.hm >= q.open + 0.5 && L.hm < q.open + 1 && book.sentPlan[s] !== L.d;
  const needClose = (s) => live && weekday && L.hm >= q.exitAt && book.sentPlan[s] === L.d && book.sentClose[s] !== L.d;

  for (const s of syms) {
    const inst = instruments[s];
    if (!inst || !(needSettle(s) || needPlan(s) || needClose(s))) continue;
    let bars;
    try { bars = await fetchBars(s, inst); } catch (err) { report.errors[s] = err.message; continue; }
    const days = O.sessionDays(bars || [], q);
    const today = days.get(L.d) || [];
    const atr = O.atrBefore(days, L.d);
    const plan = O.planDay(today, atr, q);

    if (needPlan(s) && notify) {
      book.sentPlan[s] = L.d;
      if (!plan.skip) {
        const riskPct = Number(env.ORB_RISK_PCT || 0.5), account = Number(env.ORB_ACCOUNT || 5000);
        const lot = lotsFor(inst, account * riskPct / 100, plan.range, {});
        const px = (v) => v.toFixed(inst.decimals != null ? inst.decimals : 1);
        await notify([
          `⚡ <b>SCALPING M15: ${escapeHtml(s)}</b> — două ordine în așteptare, ACUM`,
          `🟢 BUY STOP: <b>${px(plan.hi)}</b> · SL ${px(plan.lo)}`,
          `🔴 SELL STOP: <b>${px(plan.lo)}</b> · SL ${px(plan.hi)}`,
          `Lot: <b>${lot.ok ? lot.lots.toFixed(2) : '—'}</b> fiecare (risc ${riskPct}% din cont) · TF: M15`,
          'Când se activează unul, ANULEAZĂ-L pe celălalt. Dacă nu se activează niciunul până la 19:00, anulează-le.',
          'Închiderea: azi pe la 21:00 (primești mesaj). Cont separat de cel cu semnalele zilnice.'
        ].join('\n'));
        report.plans++;
      }
    }
    if (needClose(s) && notify) {
      book.sentClose[s] = L.d;
      if (!plan.skip) await notify(`⏹️ <b>SCALPING M15: ${escapeHtml(s)}</b> — închide ACUM poziția de azi (dacă s-a activat) și anulează ordinele rămase.`);
    }
    if (needSettle(s)) {
      if (today.length < 20) { report.errors[s] = `ZI_INCOMPLETĂ(${today.length})`; continue; } // datele zilei încă nu au sosit
      book.settled[s] = L.d;
      if (plan.skip) { book.skips[plan.skip] = (book.skips[plan.skip] || 0) + 1; continue; }
      const t = O.settleDay(today, plan, { costPts: COST_PTS[s] || 1 }, q);
      if (t) { book.trades.push(Object.assign({ sym: s, day: L.d, live }, t)); report.settled++; }
      if (book.trades.length > 2000) book.trades.splice(0, book.trades.length - 2000);
    }
  }

  const st = stats(book.trades);
  report.stats = st;
  if (!book.graduated && st.n >= MIN_TRADES && st.mean >= MIN_MEAN && st.t >= T_MIN) {
    book.graduated = { at: now, stats: st };
    if (notify) await notify(`🎓 <b>Scalpingul M15 a absolvit antrenamentul!</b> Spargerea deschiderii pe S&P 500 și Nasdaq a mers live, pe bani fictivi: ${st.n} tranzacții, media +${st.mean}R (t = ${st.t}). De la următoarea zi de bursă primești semnale reale pe la 17:00 (cont separat).`);
  }
  if (book.graduated) {
    const recent = stats(book.trades.slice(-60));
    const pause = recent.n >= 60 && recent.mean < 0;
    if (pause && !book.paused && notify) await notify(`⛔ <b>Scalping M15: pauză</b>. Ultimele 60 de tranzacții au media ${recent.mean}R. Opresc semnalele reale; antrenamentul continuă.`);
    if (!pause && book.paused && notify) await notify('▶️ <b>Scalping M15</b>: rezultatele și-au revenit, semnalele reale continuă.');
    book.paused = pause;
  }
  return report;
}

module.exports = { runOrbCycle, stats, initBook, SYMS, MIN_TRADES, MIN_MEAN, T_MIN, COST_PTS };
