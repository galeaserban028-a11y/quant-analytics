'use strict';

const defaultConfig = require('../../config/agents_config.json');
const { ApexQuantOrchestrator } = require('../orchestrator');
const { aggregate, normalizeCandles, M15_MS, H1_MS } = require('../core/candles');
const { createTrade, evaluateTradeOnBar, forceClose } = require('../core/tradeManager');
const { computeUsdBias } = require('../data/macro');
const { computeMetrics, verdict } = require('./metrics');

/**
 * Backtest bar-cu-bar care folosește EXACT același orchestrator ca live-ul.
 *
 * Garanții:
 *  - Fără look-ahead: la decizia de pe lumânarea i (luată la închiderea ei) se văd doar lumânările ≤ i.
 *    H1 = lumânările orare complete + ora curentă parțială (construită doar din M15 închise).
 *  - Intrarea se face la prețul de închidere al lumânării semnal (ask pt LONG), managementul începe cu lumânarea următoare.
 *  - Spread realist (typicalSpreadPips × spreadMultiplier) + comisioane din config, scăzute din fiecare tranzacție.
 *  - Model intrabar pesimist (vezi tradeManager): stop-ul verificat înaintea țintelor.
 *  - Calendar de știri istoric indisponibil → 1C nu filtrează (limitare declarată în raport).
 *
 * Mod "umbră" (options.shadow = true) — pentru laboratorul de cercetare:
 *  la fiecare moment în care există o geometrie de tranzacție validă (MTF aliniat), se simulează o
 *  tranzacție-umbră INDIFERENT de verdictul sistemului, împreună cu votul fiecărui agent. Așa se poate
 *  măsura ce câștigă sau pierde compania prin fiecare agent. (Maxim o umbră deschisă per simbol.)
 *
 * @param {object} params
 * @param {Object<string, Array>} params.dataBySymbol  lumânări M15 per simbol
 * @param {object} [params.config]
 * @param {object} [params.options] { m15Window, spreadMultiplier, newsEvents, onProgress, shadow, tradeFromTs, tradeUntilTs }
 */
async function runBacktest({ dataBySymbol, config = defaultConfig, options = {} }) {
  const m15Window = options.m15Window || 240;
  const spreadMult = options.spreadMultiplier != null ? options.spreadMultiplier : 1;
  const tradeFrom = options.tradeFromTs || -Infinity;
  const tradeUntil = options.tradeUntilTs || Infinity;
  const symbols = Object.keys(dataBySymbol).filter((s) => config.instruments[s]);
  if (!symbols.length) throw new Error('NO_KNOWN_SYMBOLS_IN_DATA');

  let now = 0;
  const orch = new ApexQuantOrchestrator(config, { clock: () => now, snapshotPath: null });

  // Pregătire per simbol
  const S = {};
  const timeline = new Set();
  for (const s of symbols) {
    const m15 = normalizeCandles(dataBySymbol[s]);
    const inst = config.instruments[s];
    const h1Full = aggregate(m15, H1_MS);
    const h1IndexByBucket = new Map(h1Full.map((c, i) => [c.timestamp, i]));
    const byTs = new Map(m15.map((c, i) => [c.timestamp, i]));
    S[s] = { m15, inst, h1Full, h1IndexByBucket, byTs, spread: (inst.typicalSpreadPips || 0) * inst.pipSize * spreadMult };
    for (const c of m15) timeline.add(c.timestamp);
  }
  const times = Array.from(timeline).sort((a, b) => a - b);

  /** H1 vizibil la închiderea lumânării M15 cu indexul i: orele complete + ora curentă parțială. */
  function h1At(st, i) {
    const bar = st.m15[i];
    const bucket = Math.floor(bar.timestamp / H1_MS) * H1_MS;
    const idx = st.h1IndexByBucket.get(bucket);
    const complete = st.h1Full.slice(Math.max(0, idx - 120), idx);
    let j = i;
    while (j > 0 && st.m15[j - 1].timestamp >= bucket) j--;
    return complete.concat(aggregate(st.m15.slice(j, i + 1), H1_MS));
  }

  const closedTrades = [];
  const signalsLog = [];
  const evalStats = { cycles: 0, evaluations: 0, vetoCounts: {} };
  const shadows = {};       // simbol → umbră deschisă
  const shadowClosed = [];

  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    now = t + M15_MS; // decizia se ia la închiderea lumânării
    const fresh = [];
    const h1Cache = {};

    for (const s of symbols) {
      const st = S[s];
      const i = st.byTs.get(t);
      if (i === undefined) continue;
      const bar = st.m15[i];

      // 1. Managementul poziției reale deschise înainte de această lumânare
      const trade = orch.stateBus.getActiveTrade(s);
      if (trade && trade.openedAt <= t) {
        const { closed } = orch.manageTrade(s, [bar], st.spread);
        if (closed) closedTrades.push(closed);
      }
      // 1b. Umbra
      const sh = shadows[s];
      if (sh && sh.openedAt <= t) {
        const res = evaluateTradeOnBar(sh, bar, st.spread);
        if (res.closed) { shadowClosed.push(res.trade); delete shadows[s]; } else shadows[s] = res.trade;
      }

      if (i < 60) continue; // încălzire minimă
      h1Cache[s] = h1At(st, i);
      fresh.push(s);
    }

    if (!fresh.length) continue;

    const macroCfg = config.macro || {};
    const macro = computeUsdBias(h1Cache, config.instruments, { lookback: macroCfg.usdBasketLookbackH1 || 20, thresholdPct: macroCfg.usdBiasThresholdPct || 0.1 });

    for (const s of fresh) {
      const st = S[s];
      const i = st.byTs.get(t);
      const bar = st.m15[i];
      orch.ingest(s, {
        m15Candles: st.m15.slice(Math.max(0, i - m15Window + 1), i + 1),
        h1Candles: h1Cache[s],
        spotBid: bar.close,
        spotAsk: bar.close + st.spread,
        spotMid: bar.close + st.spread / 2,
        spotTimestamp: now,
        usdBias: macro.usdBias,
        usdStrengthPct: macro.usdStrengthPct,
        newsEvents: options.newsEvents || [],
        newsFeedAvailable: options.newsEvents ? true : undefined
      });
    }

    const canTrade = now >= tradeFrom && now < tradeUntil;
    const { evaluated, signals } = await orch.runCycle(fresh, {}, { dryRun: !canTrade });
    evalStats.cycles += 1;
    for (const [s, c] of Object.entries(evaluated)) {
      if (!c) continue;
      evalStats.evaluations += 1;
      for (const v of c.vetoReasons || []) {
        const key = String(v).split('(')[0];
        evalStats.vetoCounts[key] = (evalStats.vetoCounts[key] || 0) + 1;
      }
      // Tranzacție-umbră: geometrie validă, indiferent de verdict
      if (options.shadow && canTrade && !shadows[s]) {
        const geo = orch.stateBus.getBranchReport(s, '4A');
        if (geo.approved) {
          const g = geo.data;
          shadows[s] = createTrade({
            symbol: s, direction: geo.direction, entry: g.entry, stopLoss: g.stopLoss, tp1: g.tp1,
            trailingLock: g.trailingLock, tp2: g.tp2, protectedBreakEven: g.protectedBreakEven,
            openedAt: now, partialPct: (config.executionPolicy || {}).tp1PartialClosePct != null ? config.executionPolicy.tp1PartialClosePct : 0.5,
            costR: g.costR || 0,
            meta: { features: c.features, finalScore: c.finalScore, rawTotal: c.rawTotal, approved: c.approved, hour: new Date(now).getUTCHours(), costToRisk: g.totalCostToRisk }
          });
        }
      }
    }
    for (const sig of signals) signalsLog.push({ symbol: sig.symbol, direction: sig.direction, at: now, score: sig.meta.score });

    if (options.onProgress && k % 500 === 0) options.onProgress(k / times.length);
  }

  // Poziții rămase deschise la final → închise la ultimul preț
  for (const s of Object.keys(orch.stateBus.state.activeTrades)) {
    const st = S[s];
    const last = st.m15[st.m15.length - 1];
    const t = forceClose(orch.stateBus.getActiveTrade(s), last.close, st.spread, 'END_OF_DATA', last.timestamp + M15_MS);
    orch.stateBus.closeActiveTrade(s, t);
    closedTrades.push(t);
  }
  for (const [s, sh] of Object.entries(shadows)) {
    const st = S[s];
    const last = st.m15[st.m15.length - 1];
    shadowClosed.push(forceClose(sh, last.close, st.spread, 'END_OF_DATA', last.timestamp + M15_MS));
  }

  closedTrades.sort((a, b) => a.closedAt - b.closedAt);
  const tradeRows = closedTrades.map((t) => ({
    symbol: t.symbol,
    direction: t.direction,
    openedAt: new Date(t.openedAt).toISOString(),
    closedAt: new Date(t.closedAt).toISOString(),
    entry: t.entry,
    stopLoss: t.initialStopLoss,
    tp1: t.tp1,
    tp2: t.tp2,
    exit: t.exitPrice,
    outcome: t.outcome,
    costR: Number((t.costR || 0).toFixed(4)),
    resultR: t.resultR,
    score: t.meta && t.meta.score
  }));

  const mid = times.length ? times[Math.floor(times.length / 2)] : 0;
  const perSymbol = {};
  for (const s of symbols) perSymbol[s] = computeMetrics(closedTrades.filter((t) => t.symbol === s));
  const overall = computeMetrics(closedTrades);

  return {
    period: times.length ? { from: new Date(times[0]).toISOString(), to: new Date(times[times.length - 1] + M15_MS).toISOString(), bars: times.length } : null,
    symbols,
    assumptions: {
      spreadMultiplier: spreadMult,
      intrabar: 'PESIMIST (stop înaintea țintelor)',
      entry: 'close-ul lumânării semnal, la ask/bid',
      news: options.newsEvents ? 'calendar furnizat' : 'FĂRĂ calendar istoric — 1C nu a filtrat știrile',
      costs: 'spread tipic + comision din config'
    },
    overall,
    verdict: verdict(overall),
    stability: {
      firstHalf: computeMetrics(closedTrades.filter((t) => t.openedAt < mid)),
      secondHalf: computeMetrics(closedTrades.filter((t) => t.openedAt >= mid))
    },
    perSymbol,
    evalStats,
    trades: tradeRows,
    closedTrades,
    shadowTrades: shadowClosed.sort((a, b) => a.openedAt - b.openedAt),
    signals: signalsLog
  };
}

module.exports = { runBacktest };
