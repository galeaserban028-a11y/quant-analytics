'use strict';

const fs = require('fs');
const path = require('path');
const { extractFeatures, scoreFeatures } = require('./scoring');

/**
 * MarketStateBus — panoul central. Ramurile NU se apelează între ele: citesc și scriu doar aici.
 *
 * Toate deciziile dependente de timp folosesc `bus.now()`, care poate fi un ceas simulat
 * (backtest) sau Date.now (live). Astfel aceeași logică rulează identic în ambele moduri.
 */
class MarketStateBus {
  /**
   * @param {object} config
   * @param {object} [options]
   * @param {string|null} [options.snapshotPath] null = fără persistență (backtest/teste)
   * @param {() => number} [options.clock]
   */
  constructor(config, options = {}) {
    this.config = config || {};
    this.snapshotPath = options.snapshotPath === undefined
      ? path.join(__dirname, '..', '..', 'data', 'state_snapshot.json')
      : options.snapshotPath;
    this.clock = typeof options.clock === 'function' ? options.clock : Date.now;

    this.state = {
      meta: { startedAt: this.now(), lastCycleAt: null, totalCycles: 0 },
      marketData: {},
      branchReports: {},
      confluenceBoard: {},
      activeTrades: {},
      closedTrades: [],
      riskLedger: { dailyDate: this._today(), slCountBySymbol: {} },
      lockouts: {},
      trend: { positions: {}, skipped: {}, lastAsOf: {} },
      diagnostics: { errorCount: 0, lastErrors: [] }
    };

    for (const symbol of Object.keys(this.config.instruments || {})) {
      this.state.marketData[symbol] = { symbol, spotBid: null, spotAsk: null, spotMid: null, h1Candles: [], m15Candles: [], updatedAt: 0 };
      this.state.branchReports[symbol] = {};
    }
    this.loadSnapshot();
  }

  now() {
    return this.clock();
  }

  _today() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  _checkDailyReset() {
    const today = this._today();
    if (this.state.riskLedger.dailyDate !== today) {
      this.state.riskLedger.dailyDate = today;
      this.state.riskLedger.slCountBySymbol = {};
    }
  }

  instrument(symbol) {
    return (this.config.instruments && this.config.instruments[symbol]) || null;
  }

  // ---------------------------------------------------------------- market data
  updateMarketData(symbol, payload) {
    if (!this.state.marketData[symbol]) this.state.marketData[symbol] = { symbol };
    Object.assign(this.state.marketData[symbol], payload, { updatedAt: this.now() });
  }

  getMarketData(symbol) {
    return this.state.marketData[symbol] || null;
  }

  // ---------------------------------------------------------------- branch reports
  resetBranchReports(symbol) {
    this.state.branchReports[symbol] = {};
  }

  publishBranchReport(symbol, branchId, report) {
    if (!this.state.branchReports[symbol]) this.state.branchReports[symbol] = {};
    const r = {
      status: report.status || 'OK',
      branchId,
      symbol,
      direction: report.direction || 'NEUTRAL',
      score: Number.isFinite(report.score) ? report.score : 0,
      veto: Boolean(report.veto),
      vetoReason: report.vetoReason || null,
      approved: Boolean(report.approved),
      data: report.data || {},
      timestamp: this.now()
    };
    this.state.branchReports[symbol][branchId] = r;
    return r;
  }

  getBranchReport(symbol, branchId) {
    const r = this.state.branchReports[symbol] && this.state.branchReports[symbol][branchId];
    if (r) return r;
    return { status: 'MISSING', branchId, symbol, direction: 'NEUTRAL', score: 0, veto: false, vetoReason: `MISSING_${branchId}`, approved: false, data: {}, timestamp: this.now() };
  }

  // ---------------------------------------------------------------- confluence formula
  /**
   * Scor 0–100 calculat de formula unică din core/scoring.js (ponderi din config.scoringWeights).
   * Orice VETO activ ⇒ scor 0. Punctele se acordă doar dacă direcția ramurii = direcția MTF.
   * Filtrele trecute pe "consultativ" (config.advisoryFilters) sunt raportate, dar nu blochează.
   */
  computeConfluenceScore(symbol) {
    this._checkDailyReset();
    const features = extractFeatures((id) => this.getBranchReport(symbol, id));
    const s = scoreFeatures(features, this.config);
    const summary = {
      symbol,
      direction: features.direction,
      finalScore: s.finalScore,
      rawTotal: s.rawTotal,
      threshold: s.threshold,
      approved: s.approved,
      vetoed: s.vetoed,
      vetoReasons: s.activeVetoes.map((id) => features.vetoReasons[id]),
      advisoryVetoes: s.advisoryVetoes.map((id) => features.vetoReasons[id]),
      breakdown: s.breakdown,
      features,
      timestamp: this.now()
    };
    this.state.confluenceBoard[symbol] = summary;
    return summary;
  }

  // ---------------------------------------------------------------- risk ledger
  getDailySlCount(symbol) {
    this._checkDailyReset();
    return this.state.riskLedger.slCountBySymbol[symbol] || 0;
  }

  recordStopLoss(symbol) {
    this._checkDailyReset();
    const n = (this.state.riskLedger.slCountBySymbol[symbol] || 0) + 1;
    this.state.riskLedger.slCountBySymbol[symbol] = n;
    const policy = this.config.executionPolicy || {};
    if (n >= (policy.maxDailySlPerSymbol || 2)) {
      const hours = policy.lockoutHoursAfterMaxSl || 48;
      this.setLockout(symbol, this.now() + hours * 3600 * 1000, `${n}_SL_TODAY`);
    }
    return n;
  }

  setLockout(symbol, untilMs, reason) {
    this.state.lockouts[symbol] = { until: untilMs, reason };
  }

  getLockout(symbol) {
    const l = this.state.lockouts[symbol];
    if (!l) return null;
    if (l.until <= this.now()) {
      delete this.state.lockouts[symbol];
      return null;
    }
    return l;
  }

  checkCurrencyCorrelationConflict(symbol) {
    const inst = this.instrument(symbol);
    if (!inst) return { conflict: true, reason: `UNKNOWN_INSTRUMENT_${symbol}` };
    for (const activeSym of Object.keys(this.state.activeTrades)) {
      if (activeSym === symbol) return { conflict: true, reason: `ACTIVE_TRADE_ALREADY_OPEN_ON_${symbol}` };
      const a = this.instrument(activeSym);
      if (!a) continue;
      const shared = [inst.baseCurrency, inst.quoteCurrency].filter(c => c === a.baseCurrency || c === a.quoteCurrency);
      if (shared.length > 0) return { conflict: true, reason: `4C_SHARED_CURRENCY[${shared.join(',')}]_WITH_${activeSym}` };
    }
    return { conflict: false, reason: null };
  }

  // ---------------------------------------------------------------- trades
  registerActiveTrade(symbol, trade) {
    this.state.activeTrades[symbol] = trade;
    this.saveSnapshot();
    return trade;
  }

  updateActiveTrade(symbol, trade) {
    this.state.activeTrades[symbol] = trade;
  }

  getActiveTrade(symbol) {
    return this.state.activeTrades[symbol] || null;
  }

  /** Închide poziția, o mută în istoric (feedback pentru 7B) și actualizează registrul CRO. */
  closeActiveTrade(symbol, closedTrade) {
    delete this.state.activeTrades[symbol];
    this.state.closedTrades.push({
      symbol,
      direction: closedTrade.direction,
      openedAt: closedTrade.openedAt,
      closedAt: closedTrade.closedAt,
      outcome: closedTrade.outcome,
      resultR: closedTrade.resultR
    });
    if (this.state.closedTrades.length > 500) this.state.closedTrades.shift();
    if (closedTrade.outcome === 'SL') this.recordStopLoss(symbol);
    this.saveSnapshot();
  }

  recentClosedTrades(symbol, n) {
    const list = this.state.closedTrades.filter(t => t.symbol === symbol);
    return list.slice(-n);
  }

  // ---------------------------------------------------------------- diagnostics & persistence
  logDiagnostic(source, err) {
    this.state.diagnostics.errorCount += 1;
    this.state.diagnostics.lastErrors.push({ source, message: err && err.message ? err.message : String(err), at: new Date(this.now()).toISOString() });
    if (this.state.diagnostics.lastErrors.length > 50) this.state.diagnostics.lastErrors.shift();
  }

  saveSnapshot() {
    if (!this.snapshotPath) return false;
    try {
      fs.mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      const payload = {
        activeTrades: this.state.activeTrades,
        closedTrades: this.state.closedTrades,
        riskLedger: this.state.riskLedger,
        lockouts: this.state.lockouts,
        trend: this.state.trend,
        prop: this.state.prop || null,
        fx: this.state.fx || null,
        fxVirtual: this.state.fxVirtual || null,
        fxLondon: this.state.fxLondon || null,
        orb: this.state.orb || null,
        savedAt: new Date(this.now()).toISOString()
      };
      // Rulăm des (din 5 în 5 minute): dacă nimic nu s-a schimbat în afară de oră, nu rescriem fișierul (evită commit-uri inutile)
      if (fs.existsSync(this.snapshotPath)) {
        try {
          const prev = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
          const strip = (o) => JSON.stringify(Object.assign({}, o, { savedAt: null }));
          if (strip(prev) === strip(JSON.parse(JSON.stringify(payload)))) return true;
        } catch (_) { /* fișier corupt: îl rescriem */ }
      }
      const tmp = `${this.snapshotPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.snapshotPath); // scriere atomică
      return true;
    } catch (err) {
      this.logDiagnostic('saveSnapshot', err);
      return false;
    }
  }

  loadSnapshot() {
    if (!this.snapshotPath || !fs.existsSync(this.snapshotPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      const maxAgeMs = ((this.config.executionPolicy || {}).maxTradeAgeHours || 72) * 3600 * 1000;
      for (const [sym, t] of Object.entries(parsed.activeTrades || {})) {
        if (!this.instrument(sym)) continue;
        if (t && t.openedAt && this.now() - t.openedAt <= maxAgeMs) {
          this.state.activeTrades[sym] = t;
        } else {
          this.logDiagnostic('loadSnapshot', new Error(`STALE_TRADE_DROPPED_${sym}`));
        }
      }
      if (Array.isArray(parsed.closedTrades)) this.state.closedTrades = parsed.closedTrades.slice(-500);
      if (parsed.riskLedger) this.state.riskLedger = parsed.riskLedger;
      if (parsed.lockouts) this.state.lockouts = parsed.lockouts;
      if (parsed.prop) this.state.prop = parsed.prop;
      if (parsed.fx) this.state.fx = parsed.fx;
      if (parsed.fxVirtual) this.state.fxVirtual = parsed.fxVirtual;
      if (parsed.fxLondon) this.state.fxLondon = parsed.fxLondon;
      if (parsed.orb) this.state.orb = parsed.orb;
      if (parsed.trend && parsed.trend.positions) this.state.trend = Object.assign({ positions: {}, skipped: {}, lastAsOf: {} }, parsed.trend);
      this._checkDailyReset();
    } catch (err) {
      this.logDiagnostic('loadSnapshot', err);
    }
  }
}

module.exports = MarketStateBus;
