'use strict';

/**
 * COMPANIA FOREX — „Londra”: spargerea intervalului asiatic, ANTRENATĂ LIVE pe bani fictivi.
 *
 * Cum funcționează:
 *  1. PE HÂRTIE (acum): în fiecare zi, după ora 20:00 UTC, ia lumânările orare reale (Yahoo) și înregistrează ce ar fi
 *     făcut strategia azi pe EURUSD, GBPUSD, USDJPY, cu costuri prudente (1,2 pips pe tranzacție). Nu trimite nimic.
 *  2. ABSOLVIREA: după cel puțin MIN_TRADES tranzacții live pe hârtie, dacă media rămâne clar pozitivă (≥ MIN_MEAN),
 *     compania „absolvă” și te anunță pe Telegram. Se verifică doar pe tranzacțiile LIVE, nu pe istoric.
 *  3. SEMNALE REALE (doar după absolvire): la ora 07:00 UTC primești ordinele în așteptare (cumpără peste / vinde sub,
 *     stop pe partea opusă, lot calculat pentru riscul ales), iar la 20:00 UTC mesajul de închidere.
 *     Pentru un cont SEPARAT de cel cu indici.
 * Dacă după absolvire rezultatele live se strică (ultimele 60 de tranzacții cu medie negativă), semnalele se opresc singure.
 */
const L = require('../strategies/londonBreakout');
const { lotsFor } = require('../prop/lots');
const { escapeHtml, roTime } = require('../notify/telegram');

const DAY = 864e5;
const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY'];
// Absolvirea: istoricul (2017–2025, pe ani nevăzuți) arată deja avantaj (t ≈ 3,4). Antrenamentul live verifică altceva:
// că pe prețurile de acum, cu costurile presupuse, rezultatul rămâne clar pozitiv. ~3 luni de tranzacții, media ≥ +0,03R.
const MIN_TRADES = 120;
const MIN_MEAN = 0.03;
const T_MIN = 0.5;

function stats(trades) {
  const r = trades.map((t) => t.resultR);
  const n = r.length;
  if (!n) return { n: 0, mean: 0, t: 0, totalR: 0, winPct: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: Number(mean.toFixed(4)), t: sd > 0 ? Number((mean / (sd / Math.sqrt(n))).toFixed(2)) : 0, totalR: Number(r.reduce((a, b) => a + b, 0).toFixed(2)), winPct: Number((r.filter((x) => x > 0).length / n * 100).toFixed(1)) };
}

function initBook(now) {
  return { v: 1, startedAt: now, trades: [], skips: {}, settled: {}, graduated: null, paused: false, sentPlan: {}, sentClose: {} };
}

/**
 * @param {object} p
 * @param {object} p.bus starea (bus.state.fxLondon)
 * @param {object} p.instruments
 * @param {(pair, inst) => Promise<Array<{t,o,h,l,c}>>} p.fetchHours lumânări orare (UTC), cel puțin ~30 de zile
 * @param {(text) => Promise} [p.notify]
 * @param {object} [p.env] LONDON_RISK_PCT (implicit 1), LONDON_ACCOUNT (implicit 10000)
 */
async function runLondonCycle({ bus, instruments, fetchHours, notify = null, now = Date.now(), env = {}, pairs = PAIRS }) {
  if (!bus.state.fxLondon || bus.state.fxLondon.v !== 1) bus.state.fxLondon = initBook(now);
  const book = bus.state.fxLondon;
  const report = { settled: 0, errors: {}, plans: 0 };
  const q = L.PARAMS;
  const today = now - (now % DAY);
  const hour = new Date(now).getUTCHours();
  const wd = new Date(today).getUTCDay();
  const weekday = wd >= 1 && wd <= 5;
  const live = Boolean(book.graduated && !book.paused);
  const needSettle = (pair) => hour >= q.exitH && weekday && book.settled[pair] !== today;
  const needPlan = (pair) => live && weekday && hour >= q.open && hour < q.open + 2 && book.sentPlan[pair] !== today;
  const needClose = (pair) => live && weekday && hour >= q.exitH && book.sentClose[pair] !== today && book.sentPlan[pair] === today;

  const prices = {};
  for (const pair of pairs) {
    const inst = instruments[pair];
    if (!inst || !(needSettle(pair) || needPlan(pair) || needClose(pair))) continue;
    let hours;
    try { hours = await fetchHours(pair, inst); } catch (err) { report.errors[pair] = err.message; continue; }
    if (!hours || hours.length < 300) { report.errors[pair] = `DATE_INSUFICIENTE(${hours ? hours.length : 0})`; continue; }
    const dayBars = hours.filter((b) => b.t >= today && b.t < today + DAY).sort((a, b) => a.t - b.t);
    const atr = L.atrBefore(hours, today);
    const plan = L.planDay(dayBars, atr);
    prices[pair] = hours[hours.length - 1].c;

    if (needPlan(pair) && notify) {
      book.sentPlan[pair] = today;
      if (!plan.skip) {
        const riskPct = Number(env.LONDON_RISK_PCT || 1);
        const account = Number(env.LONDON_ACCOUNT || 10000);
        const lot = lotsFor(inst, account * riskPct / 100, plan.range, Object.assign({ [pair]: prices[pair] }, prices));
        const px = (v) => v.toFixed(inst.decimals || (inst.pipSize < 0.01 ? 5 : 3));
        await notify([
          `🇬🇧 <b>SEMNAL FOREX (Londra): ${escapeHtml(pair)}</b>, două ordine în așteptare, ACUM`,
          `🟢 BUY STOP la <b>${px(plan.hi)}</b>, stop loss ${px(plan.lo)}`,
          `🔴 SELL STOP la <b>${px(plan.lo)}</b>, stop loss ${px(plan.hi)}`,
          `📦 Lot: <b>${lot.ok ? lot.lots.toFixed(2) : '—'}</b> pentru fiecare (risc ${riskPct}% din cont)`,
          '👉 Când se activează unul, ANULEAZĂ-L imediat pe celălalt. Dacă niciunul nu se activează până la 11:00 UTC, anulează-le pe amândouă.',
          `⏱️ Închiderea vine azi la ${roTime(today + q.exitH * 3600e3)} (ora României). Cont SEPARAT de cel cu indici.`
        ].join('\n'));
        report.plans++;
      }
    }
    if (needClose(pair) && notify) {
      book.sentClose[pair] = today;
      if (!plan.skip) await notify(`⏹️ <b>FOREX (Londra): ${escapeHtml(pair)}</b>: închide ACUM poziția de azi (dacă s-a activat) și anulează ordinele rămase.`);
    }
    if (needSettle(pair)) {
      book.settled[pair] = today;
      if (plan.skip) { book.skips[plan.skip] = (book.skips[plan.skip] || 0) + 1; continue; }
      const t = L.settleDay(dayBars, plan, { pipSize: inst.pipSize, costPips: Number(env.LONDON_COST_PIPS || 1.2) });
      if (t) { book.trades.push(Object.assign({ pair, day: today, live }, t)); report.settled++; }
      if (book.trades.length > 2000) book.trades.splice(0, book.trades.length - 2000);
    }
  }

  // Absolvirea (doar pe tranzacțiile live pe hârtie) și oprirea dacă rezultatele se strică
  const s = stats(book.trades);
  report.stats = s;
  if (!book.graduated && s.n >= MIN_TRADES && s.mean >= MIN_MEAN && s.t >= T_MIN) {
    book.graduated = { at: now, stats: s };
    if (notify) await notify(`🎓 <b>Compania Forex a absolvit!</b> Strategia „Londra” a dovedit live, pe bani fictivi, că face profit: ${s.n} tranzacții, media ${s.mean >= 0 ? '+' : ''}${s.mean}R pe tranzacție (t = ${s.t}). De mâine primești semnale reale Forex la ora 07:00 UTC, pentru un cont separat.`);
  }
  if (book.graduated) {
    const recent = stats(book.trades.slice(-60));
    const shouldPause = recent.n >= 60 && recent.mean < 0;
    if (shouldPause && !book.paused && notify) await notify(`⛔ <b>Forex (Londra): pauză</b>. Ultimele 60 de tranzacții au media ${recent.mean}R. Opresc semnalele reale până își revine (antrenamentul pe hârtie continuă).`);
    if (!shouldPause && book.paused && notify) await notify('▶️ <b>Forex (Londra)</b>: rezultatele și-au revenit, semnalele reale continuă.');
    book.paused = shouldPause;
  }
  return report;
}

module.exports = { runLondonCycle, stats, initBook, PAIRS, MIN_TRADES, MIN_MEAN, T_MIN };
