'use strict';

/**
 * Departamentul Trend — ciclul LIVE.
 * La fiecare lumânare H4 nou închisă reconstruiește starea fiecărui simbol cu ACELAȘI simulator ca backtest-ul
 * (trendDesk.liveState) și trimite mesaje doar la schimbări: intrare, mutare de stop, ieșire.
 * Riscul total deschis este limitat (maxOpenRiskPct / maxOpen): semnalele peste limită sunt raportate și ignorate.
 */
const sources = require('./data/sources');
const { normalizeCandles } = require('./core/candles');
const { liveState, H4_MS } = require('./strategies/trendDesk');
const { formatTrendEntry, formatTrendTrail, formatTrendExit } = require('./notify/telegram');

/**
 * @param {object} p
 * @param {object} p.config
 * @param {object} p.bus MarketStateBus (pentru persistență)
 * @param {(text:string)=>Promise} p.notify
 * @param {(symbol:string, inst:object)=>Promise<Array>} [p.fetchH4] injectabil (teste)
 * @param {number} [p.now]
 */
async function runTrendCycle({ config, bus, notify, fetchH4, now = Date.now() }) {
  const desk = config.trendDesk || {};
  if (!desk.enabled) return { skipped: 'TREND_DESK_DISABLED' };
  const st = bus.state.trend;
  const fetcher = fetchH4 || ((sym, inst) => sources.binanceKlines(inst.candles.id, '4h', { limit: Math.min(1000, desk.liveBars || 700), now }));
  const riskPct = desk.riskPerTradePct || 0.5;
  const report = { updated: [], errors: {} };
  // Prima pornire: pozițiile deja în curs sunt PRELUATE fără semnal de intrare (nu intrăm în tranzacții vechi).
  const firstRun = !st.initialized;
  const adopted = [];

  for (const sym of desk.symbols || []) {
    const inst = config.instruments[sym];
    if (!inst) continue;
    try {
      const h4 = normalizeCandles(await fetcher(sym, inst)).filter((c) => c.timestamp + H4_MS <= now);
      if (h4.length < 200) throw new Error(`H4_INSUFFICIENT(${h4.length})`);
      const asOf = h4[h4.length - 1].timestamp + H4_MS;
      if (st.lastAsOf[sym] === asOf) continue; // nicio lumânare H4 nouă
      st.lastAsOf[sym] = asOf;

      const { position, lastClosed } = liveState(sym, h4, inst, desk.params);
      const prev = st.positions[sym] || null;
      const skippedId = st.skipped[sym];

      // Ieșire (sau poziție înlocuită)
      if (prev && (!position || position.openedAt !== prev.openedAt)) {
        delete st.positions[sym];
        const closed = lastClosed && lastClosed.openedAt === prev.openedAt ? lastClosed : null;
        await notify(formatTrendExit(sym, inst, closed));
        report.updated.push({ sym, event: 'EXIT' });
      }
      if (skippedId && (!position || position.openedAt !== skippedId)) delete st.skipped[sym];

      if (position && firstRun && !st.positions[sym]) {
        st.positions[sym] = position;
        adopted.push(`${sym} ${position.direction} (stop ${position.stop.toPrecision(6)})`);
        continue;
      }

      if (position) {
        const known = st.positions[sym];
        if (!known && st.skipped[sym] !== position.openedAt) {
          // Intrare nouă — verificăm limita de risc a portofoliului
          const openCount = Object.keys(st.positions).length;
          if (openCount >= (desk.maxOpen || 10) || (openCount + 1) * riskPct > (desk.maxOpenRiskPct || 5) + 1e-9) {
            st.skipped[sym] = position.openedAt;
            await notify(`⚠️ <b>${sym}</b> trend: semnal ${position.direction} ignorat — limita de risc a portofoliului este atinsă (${openCount} poziții).`);
            report.updated.push({ sym, event: 'SKIPPED_RISK_LIMIT' });
          } else {
            st.positions[sym] = position;
            await notify(formatTrendEntry(position, inst, riskPct, now));
            report.updated.push({ sym, event: 'ENTRY' });
          }
        } else if (known && Math.abs(position.stop - known.stop) > 1e-12) {
          const old = known.stop;
          st.positions[sym] = position;
          await notify(formatTrendTrail(position, inst, old));
          report.updated.push({ sym, event: 'TRAIL' });
        }
      }
    } catch (err) {
      report.errors[sym] = err.message;
      bus.logDiagnostic(`trend:${sym}`, err);
    }
  }
  // Pornirea se confirmă doar când TOATE simbolurile au avut date (altfel reîncearcă la rularea următoare)
  if (firstRun && Object.keys(report.errors).length === 0) {
    st.initialized = true;
    await notify(`🚀 <b>APEX QUANT a pornit</b> (Departamentul Trend H4, ${(desk.symbols || []).length} monede).\n` +
      (adopted.length
        ? `Poziții deja în curs, preluate doar pentru urmărire (NU intra acum în ele): ${adopted.join(', ')}.`
        : 'Nicio poziție deschisă acum: sistemul așteaptă următorul trend ascendent.') +
      `\nVei primi mesaj la fiecare intrare, mutare de stop și ieșire, plus un mesaj zilnic de verificare.`);
  }
  bus.saveSnapshot();
  report.openPositions = Object.keys(st.positions);
  report.adopted = adopted;
  return report;
}

module.exports = { runTrendCycle };
