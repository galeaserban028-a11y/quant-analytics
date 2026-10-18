'use strict';

/**
 * APEX CAPITAL — compania cu BANI FICTIVI în care lucrează toți cei 300 de agenți ai Academiei.
 *
 * Regulile unei firme reale de trading, aplicate pe hârtie, pe istoria reală:
 *  1. Trepte cu bani puțini: riscul pe tranzacție depinde de grad (stagiar 0,05% din capital, junior 0,10%,
 *     senior 0,20%, elită 0,30%). Gradul e cel decis la începutul trimestrului (fără să vadă viitorul).
 *  2. Banii urmează rezultatele: promovarea aduce mai mult capital, retrogradarea îl ia.
 *  3. Limită de pierdere pe trader: cine pierde peste 8R în ultimele 90 de zile e „trimis acasă” până la
 *     următoarea evaluare trimestrială.
 *  4. Limite pe companie: risc deschis total ≤ 6% din capital, pe o pereche ≤ 1%.
 *  5. Jurnalul fiecărei tranzacții, raport lunar, analiza celor mai mari pierderi.
 *
 * Nu e bani reali. Contul tău de prop urmează separat doar elita, și doar dacă Academia dovedește avantaj.
 */
const { computeMetrics } = require('../backtest/metrics');

const DAY = 864e5;
const POLICY = {
  startCapital: 1000000,
  riskByRank: { STAGIAR: 0.0005, JUNIOR: 0.0010, SENIOR: 0.0020, 'ELITĂ': 0.0030 },
  maxOpenRisk: 0.06, maxPairRisk: 0.01,
  traderLimitR: -8, traderWindowDays: 90
};

const monthKey = (ts) => new Date(ts).toISOString().slice(0, 7);

/**
 * @param {object} academy rezultatul runAcademy (cu quarters[].roster, step, tradesOf)
 * @param {object} [policy]
 */
function simulateCompany(academy, policy = {}) {
  const P = Object.assign({}, POLICY, policy, { riskByRank: Object.assign({}, POLICY.riskByRank, policy.riskByRank || {}) });
  const agentsById = new Map(academy.agents.map((a) => [a.id, a]));
  // 1. toate tranzacțiile candidate, cu gradul agentului la începutul trimestrului
  const cands = [];
  for (const q of academy.quarters) {
    const end = q.T + academy.step;
    for (const r of q.roster) {
      const a = agentsById.get(r.id);
      for (const t of academy.tradesOf(a.genome)) {
        if (t.openedAt >= q.T && t.openedAt < end && t.outcome !== 'END_OF_DATA') cands.push({ t, agentId: r.id, rank: r.rank, quarter: q.T });
      }
    }
  }
  cands.sort((x, y) => x.t.openedAt - y.t.openedAt || x.agentId.localeCompare(y.agentId));

  // 2. evenimente în ordine: închideri înainte de deschideri la același moment
  const events = [];
  cands.forEach((c, i) => { events.push({ at: c.t.openedAt, kind: 1, i }); events.push({ at: c.t.closedAt, kind: 0, i }); });
  events.sort((a, b) => a.at - b.at || a.kind - b.kind || a.i - b.i);

  let equity = P.startCapital, peak = equity, maxDd = 0;
  const open = new Map(); // i -> { risk$, pair }
  const recent = new Map(); // agentId -> [{at, r}]
  const sentHome = new Map(); // agentId -> quarter T în care a fost trimis acasă
  const journal = [];
  const monthly = new Map();
  const perAgent = new Map();
  const perRank = { STAGIAR: [], JUNIOR: [], SENIOR: [], 'ELITĂ': [] };
  let skippedRisk = 0, skippedHome = 0, suspensions = 0;

  for (const e of events) {
    const c = cands[e.i];
    if (e.kind === 1) {
      if (sentHome.get(c.agentId) === c.quarter) { skippedHome++; continue; }
      const risk = equity * (P.riskByRank[c.rank] || 0);
      const openRisk = Array.from(open.values()).reduce((s, o) => s + o.risk, 0);
      const pairRisk = Array.from(open.values()).filter((o) => o.pair === c.t.symbol).reduce((s, o) => s + o.risk, 0);
      if (risk <= 0 || openRisk + risk > equity * P.maxOpenRisk || pairRisk + risk > equity * P.maxPairRisk) { skippedRisk++; continue; }
      open.set(e.i, { risk, pair: c.t.symbol });
    } else if (open.has(e.i)) {
      const o = open.get(e.i);
      open.delete(e.i);
      const pnl = o.risk * c.t.resultR;
      equity += pnl;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, (peak - equity) / peak);
      const m = monthKey(c.t.closedAt);
      const mm = monthly.get(m) || { pnl: 0, trades: 0, wins: 0, startEquity: equity - pnl };
      mm.pnl += pnl; mm.trades++; if (pnl > 0) mm.wins++; mm.endEquity = equity;
      monthly.set(m, mm);
      const pa = perAgent.get(c.agentId) || { pnl: 0, trades: 0, r: 0 };
      pa.pnl += pnl; pa.trades++; pa.r += c.t.resultR;
      perAgent.set(c.agentId, pa);
      perRank[c.rank].push(c.t);
      const entry = { at: c.t.closedAt, openedAt: c.t.openedAt, agentId: c.agentId, rank: c.rank, pair: c.t.symbol, direction: c.t.direction, family: agentsById.get(c.agentId).genome.family, r: c.t.resultR, pnl, outcome: c.t.outcome, entry: c.t.entry, stop: c.t.initialStopLoss, exit: c.t.exitPrice };
      journal.push(entry);
      // limita trader-ului: pierderile din ultimele 90 de zile
      const list = (recent.get(c.agentId) || []).filter((x) => x.at >= c.t.closedAt - P.traderWindowDays * DAY);
      list.push({ at: c.t.closedAt, r: c.t.resultR });
      recent.set(c.agentId, list);
      const qNow = quarterOf(academy, c.t.closedAt);
      if (list.reduce((s, x) => s + x.r, 0) <= P.traderLimitR && sentHome.get(c.agentId) !== qNow) {
        sentHome.set(c.agentId, qNow);
        suspensions++;
      }
    }
  }

  const months = Array.from(monthly.entries()).sort().map(([m, v]) => ({ month: m, pnl: Math.round(v.pnl), trades: v.trades, wins: v.wins, returnPct: Number((v.pnl / v.startEquity * 100).toFixed(2)), endEquity: Math.round(v.endEquity) }));
  const years = {};
  for (const m of months) { const y = m.month.slice(0, 4); years[y] = years[y] || { pnl: 0, trades: 0, start: m.endEquity - m.pnl }; years[y].pnl += m.pnl; years[y].trades += m.trades; }
  const yearly = Object.entries(years).map(([y, v]) => ({ year: y, pnl: v.pnl, trades: v.trades, returnPct: Number((v.pnl / v.start * 100).toFixed(1)) }));
  const ranks = Object.fromEntries(Object.entries(perRank).map(([k, v]) => { const m = computeMetrics(v); return [k, { trades: m.trades, expectancyR: m.expectancyR, ci: m.expectancyCI95, winRatePct: m.winRatePct }]; }));
  const contrib = Array.from(perAgent.entries()).map(([id, v]) => ({ id, name: agentsById.get(id).name, pair: agentsById.get(id).genome.pair, family: agentsById.get(id).genome.family, pnl: Math.round(v.pnl), trades: v.trades, r: Number(v.r.toFixed(2)) })).sort((a, b) => b.pnl - a.pnl);
  const worst = journal.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 5).map((j) => Object.assign({}, j, { name: agentsById.get(j.agentId).name, lesson: postMortem(j) }));
  const firstMonth = months.length ? months[0].month : null;
  const totalPnl = equity - P.startCapital;
  const nYears = months.length / 12;
  return {
    policy: P,
    startCapital: P.startCapital, endCapital: Math.round(equity), totalPnl: Math.round(totalPnl),
    cagrPct: nYears > 0 ? Number(((Math.pow(equity / P.startCapital, 1 / nYears) - 1) * 100).toFixed(2)) : 0,
    maxDrawdownPct: Number((maxDd * 100).toFixed(1)),
    positiveMonthsPct: months.length ? Number((months.filter((m) => m.pnl > 0).length / months.length * 100).toFixed(1)) : 0,
    from: firstMonth, months, yearly, ranks,
    best: contrib.slice(0, 10), worstAgents: contrib.slice(-5).reverse(),
    worstTrades: worst,
    journal: journal.slice(-60).reverse().map((j) => Object.assign({}, j, { name: agentsById.get(j.agentId).name })),
    trades: journal.length, skippedRisk, skippedHome, suspensions
  };
}

function quarterOf(academy, ts) {
  let T = null;
  for (const q of academy.quarters) if (q.T <= ts) T = q.T;
  return T;
}

/** Analiza pe scurt a unei pierderi mari: ce s-a întâmplat și ce înseamnă. */
function postMortem(j) {
  const long = j.direction === 'LONG';
  const gap = j.outcome === 'STOP' && (long ? j.exit < j.stop - 1e-12 : j.exit > j.stop + 1e-12);
  if (gap) return `Prețul a sărit peste stop (gap), pierderea a depășit riscul planificat (${j.r.toFixed(2)}R). Riscul de gap e motivul pentru care Gardianul nu folosește niciodată toată limita zilnică.`;
  if (j.outcome === 'STOP') return `Stop-ul a fost atins (${j.r.toFixed(2)}R, inclusiv costuri). O pierdere normală, planificată.`;
  if (j.outcome === 'TIME') return `Poziția a expirat fără să revină (${j.r.toFixed(2)}R). Ieșirea pe timp a limitat pierderea.`;
  return `Ieșire pe regula strategiei cu ${j.r.toFixed(2)}R după costuri.`;
}

module.exports = { simulateCompany, postMortem, POLICY };
