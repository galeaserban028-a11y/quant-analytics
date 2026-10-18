'use strict';

const defaultConfig = require('../config/agents_config.json');
const MarketStateBus = require('./core/MarketStateBus');
const BranchAgent = require('./core/BranchAgent');
const { normalizeCandles } = require('./core/candles');
const { createTrade, evaluateTradeOnBar, forceClose } = require('./core/tradeManager');

const d1 = require('./divisions/div1_shield_macro');
const d2 = require('./divisions/div2_multi_tf');
const d3 = require('./divisions/div3_orderflow_smc');
const d4 = require('./divisions/div4_cro_risk');
const d5 = require('./divisions/div5_board_voting');
const d7 = require('./divisions/div7_ai_research');

/** Logica fiecărei ramuri. Ordinea de execuție este cea din config.branches. */
const BRANCH_HANDLERS = {
  '7A': d7.branch7A_DeadMarketGuard,
  '7B': d7.branch7B_PerformanceBreaker,
  '7C': d7.branch7C_RegimeFilter,
  '1A': d1.branch1A_SpotSpreadGuard,
  '1B': d1.branch1B_SessionKillzoneFilter,
  '1C': d1.branch1C_RedFolderNewsBlocker,
  '1D': d1.branch1D_MacroUsdCompass,
  MTF: d2.branchMTF_Alignment,
  '3A': d3.branch3A_LiquiditySweep,
  '3B': d3.branch3B_OrderBlock,
  '3C': d3.branch3C_FairValueGap,
  '3E': d3.branch3E_PremiumDiscount,
  '3D': d3.branch3D_Displacement,
  '4A': d4.branch4A_RiskGeometry,
  '4B': d4.branch4B_AntiChase,
  '4C': d4.branch4C_CorrelationGuard,
  '4D': d4.branch4D_DailyDrawdown,
  '4E': d4.branch4E_CostGuard,
  '5B': d5.branch5B_DevilsAdvocate,
  '5A': d5.branch5A_ConfluenceAggregator
};

function looksNormalized(arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length === 0) return true;
  const a = arr[0];
  const b = arr[arr.length - 1];
  const ok = (c) => c !== null && typeof c === 'object' && !Array.isArray(c) && Number.isFinite(c.close) && Number.isFinite(c.timestamp);
  return ok(a) && ok(b);
}

class ApexQuantOrchestrator {
  /**
   * @param {object} [config]
   * @param {object} [options] { clock, snapshotPath } — vezi MarketStateBus
   */
  constructor(config = defaultConfig, options = {}) {
    this.config = config;
    this.stateBus = new MarketStateBus(config, options);
    this.agents = (config.branches || []).map((b) => new BranchAgent({
      branchId: b.branchId,
      name: b.name,
      division: b.division,
      canVeto: b.canVeto,
      handler: BRANCH_HANDLERS[b.branchId]
    }));
  }

  symbols() {
    return Object.keys(this.config.instruments || {});
  }

  /** Încarcă date de piață pentru un simbol (normalizează lumânările dacă e nevoie). */
  ingest(symbol, payload) {
    const p = Object.assign({}, payload);
    for (const key of ['m15Candles', 'h1Candles']) {
      if (p[key] !== undefined && !looksNormalized(p[key])) p[key] = normalizeCandles(p[key]);
    }
    for (const key of ['spotBid', 'spotAsk', 'spotMid']) {
      if (p[key] !== undefined && !Number.isFinite(p[key])) p[key] = null;
    }
    this.stateBus.updateMarketData(symbol, p);
  }

  /** Rulează toate ramurile pe un simbol și întoarce verdictul de confluență (5A). */
  async evaluateSymbol(symbol, context = {}) {
    this.stateBus.resetBranchReports(symbol);
    for (const agent of this.agents) {
      await agent.execute({ symbol, stateBus: this.stateBus, config: this.config, context });
    }
    return this.stateBus.getBranchReport(symbol, '5A').data;
  }

  /**
   * Un ciclu complet: evaluează simbolurile, sortează candidații aprobați după scor (5C)
   * și deschide poziții una câte una, re-verificând corelația valutară după fiecare.
   * Nu trimite nimic pe Telegram — întoarce semnalele, iar apelantul decide ce face cu ele.
   */
  /**
   * @param {string[]} symbols
   * @param {object} context
   * @param {object} [opts] { dryRun: evaluează fără să deschidă poziții }
   */
  async runCycle(symbols = this.symbols(), context = {}, opts = {}) {
    const bus = this.stateBus;
    bus.state.meta.totalCycles += 1;
    bus.state.meta.lastCycleAt = bus.now();
    bus.state.confluenceBoard = {};

    const evaluated = {};
    for (const s of symbols) {
      evaluated[s] = await this.evaluateSymbol(s, context);
      if (bus.getActiveTrade(s)) evaluated[s] = Object.assign({}, evaluated[s], { approved: false, activeTrade: true });
    }

    // Birourile (instrumentele) suspendate de consiliu sunt evaluate în continuare (Observație), dar nu tranzacționează
    const disabled = new Set(this.config.disabledSymbols || []);
    for (const s of symbols) {
      if (disabled.has(s) && evaluated[s] && evaluated[s].approved) evaluated[s] = Object.assign({}, evaluated[s], { approved: false, deskSuspended: true });
    }
    const candidates = symbols
      .map((s) => evaluated[s])
      .filter((c) => c && c.approved)
      .sort((a, b) => b.finalScore - a.finalScore);

    const signals = [];
    if (opts.dryRun) return { cycle: bus.state.meta.totalCycles, evaluated, signals };
    for (const c of candidates) {
      const corr = bus.checkCurrencyCorrelationConflict(c.symbol);
      if (corr.conflict) { c.selectionNote = `SKIPPED_${corr.reason}`; continue; }
      const geo = bus.getBranchReport(c.symbol, '4A').data;
      const trade = createTrade({
        symbol: c.symbol,
        direction: c.direction,
        entry: geo.entry,
        stopLoss: geo.stopLoss,
        tp1: geo.tp1,
        trailingLock: geo.trailingLock,
        tp2: geo.tp2,
        protectedBreakEven: geo.protectedBreakEven,
        openedAt: bus.now(),
        partialPct: (this.config.executionPolicy || {}).tp1PartialClosePct != null ? this.config.executionPolicy.tp1PartialClosePct : 0.5,
        costR: geo.costR || 0,
        meta: {
          score: c.finalScore,
          breakdown: c.breakdown,
          riskPips: geo.riskPips,
          spreadPips: geo.spreadPips,
          spreadToRiskPct: geo.spreadToRiskPct,
          chasePct: bus.getBranchReport(c.symbol, '4B').data.chasePct || 0,
          rrTp1: geo.rrTp1,
          rrTrail: geo.rrTrail,
          rrTp2: geo.rrTp2,
          validitySec: (this.config.executionPolicy || {}).marketSignalValiditySeconds || 180,
          lastEvaluatedTs: null
        }
      });
      bus.registerActiveTrade(c.symbol, trade);
      signals.push(trade);
    }

    bus.saveSnapshot();
    return { cycle: bus.state.meta.totalCycles, evaluated, signals };
  }

  /**
   * Gestionează poziția deschisă pe un simbol, pe o listă de lumânări/tick-uri noi (prețuri BID).
   * Întoarce evenimentele (TP1, TRAIL, CLOSED). La închidere actualizează registrul CRO și feedback-ul 7B.
   */
  manageTrade(symbol, bars, spreadPrice) {
    const bus = this.stateBus;
    let trade = bus.getActiveTrade(symbol);
    const events = [];
    if (!trade) return { events, closed: null };

    for (const bar of bars) {
      const res = evaluateTradeOnBar(trade, bar, spreadPrice);
      trade = res.trade;
      for (const e of res.events) events.push(Object.assign({ symbol, at: bar.timestamp }, e));
      if (res.closed) {
        bus.closeActiveTrade(symbol, trade);
        return { events, closed: trade };
      }
    }

    // Poziție prea veche → închidere la piață (protecție contra stărilor uitate)
    const maxAgeMs = ((this.config.executionPolicy || {}).maxTradeAgeHours || 72) * 3600 * 1000;
    const last = bars[bars.length - 1];
    if (last && bus.now() - trade.openedAt > maxAgeMs) {
      trade = forceClose(trade, last.close, spreadPrice, 'MAX_AGE', bus.now());
      events.push({ symbol, at: bus.now(), type: 'CLOSED', outcome: 'MAX_AGE', price: trade.exitPrice, resultR: trade.resultR });
      bus.closeActiveTrade(symbol, trade);
      return { events, closed: trade };
    }

    bus.updateActiveTrade(symbol, trade);
    if (events.length) bus.saveSnapshot();
    return { events, closed: null };
  }
}

module.exports = { ApexQuantOrchestrator, BRANCH_HANDLERS };
