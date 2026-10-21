'use strict';

/**
 * SIMULATORUL DE EXAMEN PROP.
 * Ia tranzacțiile reale out-of-sample ale unui departament (în R) și „reia” examenul pornind din zeci/sute
 * de date diferite din istorie, aplicând Gardianul Prop și regulile firmei. Măsoară:
 *   - probabilitatea de a trece toate fazele, de a pica, sau de a nu termina în orizontul dat;
 *   - timpul median până la trecere;
 *   - pe contul finanțat: câștigul așteptat în primele luni (după split) și riscul de a-l pierde.
 *
 * Simplificări declarate:
 *  - rezultatul unei tranzacții se aplică la închidere (capitalul flotant intraday nu e modelat); Gardianul
 *    compensează rezervând riscul complet al fiecărei poziții deschise în limitele zilnică și totală;
 *  - când ținta fazei e atinsă, pozițiile încă deschise sunt considerate închise la zero (nu mai contează).
 */
const { decide } = require('./guardian');
const { rng } = require('../backtest/metrics');

const DAY = 864e5;
const dayKey = (ms) => Math.floor(ms / DAY);

/**
 * Rulează un singur cont (o fază sau finanțat) pornind de la startTs.
 * @returns {{ outcome: 'PASS'|'FAIL'|'TIMEOUT', endTs, balance, tradesTaken, tradingDays, worstDailyLossPct, maxDdPct }}
 */
function runAccount(trades, rules, cfg, { startTs, endTs, target, initial = 10000, startBalance }) {
  const events = [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t.openedAt < startTs || t.openedAt >= endTs) continue;
    events.push({ at: t.openedAt, type: 'open', i });
    events.push({ at: t.closedAt, type: 'close', i });
  }
  events.sort((a, b) => a.at - b.at || (a.type === 'close' ? -1 : 1));

  // startBalance: contul finanțat continuă cu soldul real (pierderile NU se iartă de la o lună la alta)
  let balance = startBalance != null ? startBalance : initial;
  let highestEod = Math.max(initial, balance), dayStart = balance, curDay = dayKey(startTs);
  let minBal = balance, worstDaily = 0;
  const open = new Map();
  const closedEarly = new Set();
  const days = new Set();
  let taken = 0;

  const rollDay = (ts) => {
    const d = dayKey(ts);
    if (d !== curDay) {
      highestEod = Math.max(highestEod, balance);
      dayStart = balance;
      curDay = d;
    }
  };
  const floorNow = () => (rules.maxLossType === 'trailingEod' ? Math.max(initial, highestEod) - initial * rules.maxLoss : initial * (1 - rules.maxLoss));

  for (const e of events) {
    rollDay(e.at);
    const t = trades[e.i];
    if (e.type === 'open') {
      if (closedEarly.has(e.i)) continue;
      const openRisk = Array.from(open.values()).reduce((s, v) => s + v, 0);
      const d = decide({ initial, balance, dayStartBalance: dayStart, openRisk, highestEod, phaseTarget: target, tradingDays: days.size }, rules, Object.assign({}, cfg, { openCount: open.size }));
      if (!d.allow) continue;
      open.set(e.i, d.riskAmount);
      days.add(dayKey(e.at));
      taken += 1;
    } else if (!open.has(e.i)) {
      closedEarly.add(e.i);
    } else {
      const amt = open.get(e.i);
      open.delete(e.i);
      balance += amt * t.resultR;
      minBal = Math.min(minBal, balance);
      worstDaily = Math.max(worstDaily, (dayStart - balance) / initial);
      if (dayStart - balance > initial * rules.dailyLoss + 1e-9 || balance <= floorNow() + 1e-9) {
        return { outcome: 'FAIL', endTs: e.at, balance, tradesTaken: taken, tradingDays: days.size, worstDailyLossPct: worstDaily * 100, maxDdPct: (initial - minBal) / initial * 100 };
      }
      if (target != null && balance >= initial * (1 + target) && days.size >= (rules.minDays || 0)) {
        return { outcome: 'PASS', endTs: e.at, balance, tradesTaken: taken, tradingDays: days.size, worstDailyLossPct: worstDaily * 100, maxDdPct: (initial - minBal) / initial * 100 };
      }
    }
  }
  return { outcome: 'TIMEOUT', endTs, balance, tradesTaken: taken, tradingDays: days.size, worstDailyLossPct: worstDaily * 100, maxDdPct: (initial - minBal) / initial * 100 };
}

/**
 * Examen complet (toate fazele) + perioada finanțată, pornind din multe date diferite.
 * @param {Array} trades tranzacții OOS ({openedAt, closedAt, resultR})
 * @param {object} rules PROP_RULES[x]
 * @param {object} cfg { riskPct, safety, maxOpen }
 * @param {object} [opts] { horizonDays, fundedMonths, stepDays, initial }
 */
function simulateChallenges(trades, rules, cfg, opts = {}) {
  // Semnalele din aceeași zi pot concura pentru același „loc” de risc; ordinea lor e arbitrară, așa că
  // repetăm simularea cu mai multe ordini aleatoare (determinist, pe seed-uri) și raportăm media și intervalul.
  const seeds = opts.orderSeeds || 8;
  const results = [];
  for (let s = 1; s <= seeds; s++) results.push(simulateOnce(trades, rules, cfg, opts, s));
  const ok = results.filter(Boolean);
  if (!ok.length) return null;
  const avg = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0) / ok.length;
  const r0 = ok[0];
  const passes = ok.map((r) => r.passPct);
  return Object.assign({}, r0, {
    passPct: Number(avg('passPct').toFixed(1)),
    passPctRange: [Math.min(...passes), Math.max(...passes)],
    failPct: Number(avg('failPct').toFixed(1)),
    timeoutPct: Number(avg('timeoutPct').toFixed(1)),
    stuckPct: Number(avg('stuckPct').toFixed(1)),
    lostPct: Number(avg('lostPct').toFixed(1)),
    medianDaysToPass: Math.round(avg('medianDaysToPass')) || null,
    passWithin90Pct: Number(avg('passWithin90Pct').toFixed(1)),
    passWithin180Pct: Number(avg('passWithin180Pct').toFixed(1)),
    passWithin365Pct: Number(avg('passWithin365Pct').toFixed(1)),
    avgPayoutFirstMonths: Math.round(avg('avgPayoutFirstMonths')),
    expectedValuePerAttempt: Math.round(avg('expectedValuePerAttempt')),
    orderSeeds: ok.length
  });
}

function simulateOnce(trades, rules, cfg, opts, seed) {
  const horizon = (opts.horizonDays || 365) * DAY;
  const fundedMs = (opts.fundedMonths || 6) * 30 * DAY;
  const step = (opts.stepDays || 14) * DAY;
  const initial = opts.initial || 10000;
  const r = rng(seed * 7919);
  // ordine canonică înainte de amestecare ⇒ rezultatul nu depinde de ordinea în care primim tranzacțiile
  const canon = trades.slice().sort((a, b) => a.openedAt - b.openedAt || String(a.symbol).localeCompare(String(b.symbol)) || a.closedAt - b.closedAt || a.resultR - b.resultR);
  const keyed = canon.map((t) => ({ t, k: r() }));
  keyed.sort((a, b) => a.t.openedAt - b.t.openedAt || a.k - b.k);
  const sorted = keyed.map((x) => x.t);
  if (!sorted.length) return null;
  const first = sorted[0].openedAt;
  const last = sorted[sorted.length - 1].closedAt;

  const runs = [];
  for (let start = first; start + horizon + fundedMs <= last; start += step) {
    let ts = start;
    let outcome = 'PASS';
    let stuck = false;
    const phaseDays = [];
    for (const target of rules.phases) {
      const r = runAccount(sorted, rules, cfg, { startTs: ts, endTs: start + horizon, target, initial });
      phaseDays.push((r.endTs - ts) / DAY);
      if (r.outcome !== 'PASS') {
        outcome = r.outcome; ts = r.endTs;
        // „blocat”: nu a picat formal, dar a rămas lângă limita totală, unde Gardianul mai permite doar poziții minuscule
        stuck = r.outcome === 'TIMEOUT' && r.balance < initial * (1 - rules.maxLoss * 0.75);
        break;
      }
      ts = r.endTs;
    }
    let funded = null;
    if (outcome === 'PASS') {
      // Cont finanțat: soldul se poartă de la o lună la alta; retragem doar profitul de peste soldul inițial
      let payout = 0, alive = true, fts = ts, bal = initial;
      for (let m = 0; m < (opts.fundedMonths || 6) && alive; m++) {
        const r = runAccount(sorted, rules, cfg, { startTs: fts, endTs: fts + 30 * DAY, target: null, initial, startBalance: bal });
        bal = r.balance;
        if (r.outcome === 'FAIL') alive = false;
        else if (bal > initial) { payout += (bal - initial) * rules.split; bal = initial; }
        fts += 30 * DAY;
      }
      funded = { payout, survived: alive };
    }
    runs.push({ start, outcome, stuck, daysToFinish: phaseDays.reduce((s, v) => s + v, 0), funded });
  }

  const n = runs.length;
  const pass = runs.filter((r) => r.outcome === 'PASS');
  const fail = runs.filter((r) => r.outcome === 'FAIL');
  const med = (arr) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null);
  const passProb = n ? pass.length / n : 0;
  const avgPayout = pass.length ? pass.reduce((s, r) => s + r.funded.payout, 0) / pass.length : 0;
  // Valoare așteptată per încercare: P(trece) × payout mediu (+ taxa înapoi la FTMO) − taxa
  const ev = passProb * avgPayout - rules.fee10k * (initial / 10000);
  return {
    rules: rules.name,
    riskPct: cfg.riskPct,
    attempts: n,
    passPct: Number((passProb * 100).toFixed(1)),
    failPct: Number((fail.length / Math.max(1, n) * 100).toFixed(1)),
    timeoutPct: Number(((n - pass.length - fail.length) / Math.max(1, n) * 100).toFixed(1)),
    // practic pierdut: picat formal + blocat lângă limită (taxa e pierdută în ambele cazuri)
    stuckPct: Number((runs.filter((r) => r.stuck).length / Math.max(1, n) * 100).toFixed(1)),
    lostPct: Number(((fail.length + runs.filter((r) => r.stuck).length) / Math.max(1, n) * 100).toFixed(1)),
    medianDaysToPass: pass.length ? Math.round(med(pass.map((r) => r.daysToFinish))) : null,
    // cât de repede: procent din TOATE încercările care trec în ≤ 90 / 180 / 365 de zile
    passWithin90Pct: Number((pass.filter((r) => r.daysToFinish <= 90).length / Math.max(1, n) * 100).toFixed(1)),
    passWithin180Pct: Number((pass.filter((r) => r.daysToFinish <= 180).length / Math.max(1, n) * 100).toFixed(1)),
    passWithin365Pct: Number((pass.filter((r) => r.daysToFinish <= 365).length / Math.max(1, n) * 100).toFixed(1)),
    fundedSurvivalPct: pass.length ? Number((pass.filter((r) => r.funded.survived).length / pass.length * 100).toFixed(1)) : null,
    avgPayoutFirstMonths: Math.round(avgPayout),
    expectedValuePerAttempt: Math.round(ev),
    fee: Math.round(rules.fee10k * (initial / 10000))
  };
}

module.exports = { simulateChallenges, runAccount };
