'use strict';

/**
 * APEX CAPITAL — viața LIVE, zilnică, a tuturor celor 300 de agenți, cu BANI FICTIVI.
 *
 * După fiecare zi Forex închisă (verificat cel mult o dată pe oră pe pereche), fiecare agent din populația
 * Academiei (data/research/academy.json) își reconstruiește starea pe perechea lui cu ACELAȘI simulator ca
 * în cercetare și tranzacționează pe hârtie:
 *  - riscul pe tranzacție după grad (stagiar 0,05% din capital … elită 0,30%);
 *  - limite pe companie (risc deschis ≤ 6%, pe pereche ≤ 1%) și pe trader (−8R în 90 de zile ⇒ acasă
 *    până la următoarea școală);
 *  - intră doar în semnale proaspete (deschise pe ultima zi închisă), ca un om.
 * Nimic de aici nu e bani reali și nu trimite mesaje: e „viața” agenților, pe care o vezi pe hartă.
 */
const lab = require('../strategies/dailyLab');
const { samePos } = require('../propLive');
const { POLICY } = require('./company');

const DAY = 864e5;
const REFETCH_MS = 55 * 60e3;

function initBook(academy, now) {
  return {
    v: 1, startedAt: now, schoolAt: academy.generatedAt,
    capital: POLICY.startCapital, equity: POLICY.startCapital, peak: POLICY.startCapital, maxDdPct: 0,
    positions: {}, skipped: {}, agents: {}, journal: [], monthly: {},
    lastBarClose: {}, lastFetch: {}, sentHome: {}, recent: {}, initialized: false
  };
}

/**
 * @param {object} p
 * @param {object} p.academy conținutul data/research/academy.json (populația cu grade)
 * @param {object} p.instruments
 * @param {object} p.bus starea (bus.state.fxVirtual)
 * @param {(sym, inst)=>Promise<{candles}>} p.fetch
 * @param {object} [p.rates] dobânzile (swap real, carry)
 */
async function runVirtualCycle({ academy, instruments, bus, fetch, now = Date.now(), rates = null, policy = {} }) {
  if (!academy || !Array.isArray(academy.population) || !academy.population.length) return { skipped: 'FĂRĂ_POPULAȚIE' };
  const P = Object.assign({}, POLICY, policy);
  if (!bus.state.fxVirtual || bus.state.fxVirtual.v !== 1) bus.state.fxVirtual = initBook(academy, now);
  const book = bus.state.fxVirtual;
  if (book.schoolAt !== academy.generatedAt) { book.sentHome = {}; book.schoolAt = academy.generatedAt; } // școală nouă: toți revin
  const firstRun = !book.initialized;
  const byPair = {};
  for (const a of academy.population) (byPair[a.pair] = byPair[a.pair] || []).push(a);
  const report = { fetched: [], errors: {}, opened: 0, closed: 0 };

  for (const [pair, agents] of Object.entries(byPair)) {
    const inst = instruments[pair];
    if (!inst) continue;
    if (!firstRun && book.lastFetch[pair] && now - book.lastFetch[pair] < REFETCH_MS) continue;
    let candles;
    try {
      ({ candles } = await fetch(pair, inst));
      if (!candles || candles.length < 260) throw new Error(`DATE_INSUFICIENTE(${candles ? candles.length : 0})`);
    } catch (err) { report.errors[pair] = err.message; continue; }
    book.lastFetch[pair] = now;
    report.fetched.push(pair);
    const last = candles[candles.length - 1];
    const barClose = last.timestamp + DAY;
    if (book.lastBarClose[pair] === barClose) continue;
    book.lastBarClose[pair] = barClose;

    for (const a of agents) {
      const params = Object.assign({}, a.params, { kind: a.family });
      const { position, lastClosed } = lab.liveState(pair, candles, inst, params, { barMs: DAY, rates });
      const prev = book.positions[a.id];
      if (prev && !samePos(position, prev)) {
        delete book.positions[a.id];
        const closed = samePos(lastClosed, prev) ? lastClosed : null;
        const r = closed ? closed.resultR : 0;
        const pnl = prev.risk * r;
        book.equity += pnl;
        book.peak = Math.max(book.peak, book.equity);
        book.maxDdPct = Math.max(book.maxDdPct, (book.peak - book.equity) / book.peak * 100);
        const st = book.agents[a.id] || { n: 0, sumR: 0, wins: 0, pnl: 0 };
        st.n++; st.sumR += r; if (r > 0) st.wins++; st.pnl += pnl; st.lastAt = closed ? closed.closedAt : now;
        book.agents[a.id] = st;
        const m = new Date(closed ? closed.closedAt : now).toISOString().slice(0, 7);
        book.monthly[m] = (book.monthly[m] || 0) + pnl;
        book.journal.unshift({ at: closed ? closed.closedAt : now, id: a.id, name: a.name, rank: prev.rank, pair, direction: prev.direction, r: Number(r.toFixed(3)), pnl: Math.round(pnl), outcome: closed ? closed.outcome : 'NECUNOSCUT' });
        if (book.journal.length > 150) book.journal.length = 150;
        const rec = (book.recent[a.id] || []).filter((x) => x.at >= now - P.traderWindowDays * DAY);
        rec.push({ at: now, r });
        book.recent[a.id] = rec;
        if (rec.reduce((s, x) => s + x.r, 0) <= P.traderLimitR) book.sentHome[a.id] = now;
        report.closed++;
      }
      const skippedHere = book.skipped[a.id] != null && position && Math.abs(position.openedAt - book.skipped[a.id]) < 30 * 3600e3;
      if (book.skipped[a.id] != null && !skippedHere) delete book.skipped[a.id];
      if (!position || book.positions[a.id] || skippedHere) continue;
      const fresh = position.openedAt >= last.timestamp + DAY - 15 * 3600e3 && now - barClose < 36 * 3600e3;
      if (firstRun || !fresh || book.sentHome[a.id]) { book.skipped[a.id] = position.openedAt; continue; }
      const risk = book.equity * (P.riskByRank[a.rank] || 0);
      const open = Object.values(book.positions);
      const openRisk = open.reduce((s, x) => s + x.risk, 0);
      const pairRisk = open.filter((x) => x.pair === pair).reduce((s, x) => s + x.risk, 0);
      if (!(risk > 0) || openRisk + risk > book.equity * P.maxOpenRisk || pairRisk + risk > book.equity * P.maxPairRisk) { book.skipped[a.id] = position.openedAt; continue; }
      book.positions[a.id] = { pair, direction: position.direction, entry: position.entry, stop: position.stop, openedAt: position.openedAt, risk, rank: a.rank, name: a.name };
      report.opened++;
    }
  }
  if (firstRun && report.fetched.length > 0) book.initialized = true;
  report.equity = Math.round(book.equity);
  report.open = Object.keys(book.positions).length;
  return report;
}

module.exports = { runVirtualCycle, initBook };
