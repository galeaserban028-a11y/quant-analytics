const fs = require('fs');
const path = require('path');

/**
 * MarketStateBus - Panoul Central JSON (Message Bus)
 * Regula 1 Zero-Crash: Agentii NU au voie sa se apeleze direct unul pe altul.
 * Toate cele 7 Divizii si 24 Sub-Ramuri citesc si scriu exclusiv in acest StateBus.
 */
class MarketStateBus {
  constructor(config, snapshotPath) {
    this.config = config || {};
    this.snapshotPath = snapshotPath || path.join(__dirname, '..', 'config', 'state_bus_snapshot.json');

    this.state = {
      meta: {
        companyName: (config && config.companyName) || 'APEX QUANT 300-AGENT DESK',
        startedAt: Date.now(),
        lastCycleAt: null,
        totalCycles: 0
      },
      marketData: {},
      branchReports: {},
      confluenceBoard: {},
      activeTrades: {},
      riskLedger: {
        dailyDate: new Date().toISOString().slice(0, 10),
        slCountBySymbol: {},
        currencyExposure: {}
      },
      aiTuning: {},
      diagnostics: {
        fallbackCount: 0,
        lastErrors: []
      }
    };

    this._initInstruments();
    this.loadSnapshot();
  }

  _initInstruments() {
    try {
      const instruments = (this.config && this.config.instruments) || {};
      for (const symbol of Object.keys(instruments)) {
        if (!this.state.marketData[symbol]) {
          this.state.marketData[symbol] = {
            symbol,
            spotBid: null,
            spotAsk: null,
            spotMid: null,
            spreadPips: null,
            h1Candles: [],
            m15Candles: [],
            updatedAt: 0
          };
        }
        if (!this.state.branchReports[symbol]) {
          this.state.branchReports[symbol] = {};
        }
        if (!this.state.aiTuning[symbol]) {
          this.state.aiTuning[symbol] = {
            deadMarketBlocked: false,
            activeStrategy: 'PULLBACK',
            walkForwardWinRate: 75.0,
            params: { zThreshold: 1.8, rsiLimit: 34, volMultiplier: 1.5 },
            updatedAt: Date.now()
          };
        }
      }
    } catch (err) {
      this.logDiagnostic('MarketStateBus._initInstruments', err);
    }
  }

  _checkDailyReset() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (this.state.riskLedger.dailyDate !== today) {
        this.state.riskLedger.dailyDate = today;
        this.state.riskLedger.slCountBySymbol = {};
      }
    } catch (err) {
      this.logDiagnostic('MarketStateBus._checkDailyReset', err);
    }
  }

  updateMarketData(symbol, payload) {
    try {
      if (!this.state.marketData[symbol]) {
        this.state.marketData[symbol] = { symbol };
      }
      Object.assign(this.state.marketData[symbol], payload, { updatedAt: Date.now() });
      return true;
    } catch (err) {
      this.logDiagnostic(`updateMarketData:${symbol}`, err);
      return false;
    }
  }

  getMarketData(symbol) {
    try {
      return this.state.marketData[symbol] || null;
    } catch (err) {
      this.logDiagnostic(`getMarketData:${symbol}`, err);
      return null;
    }
  }

  publishBranchReport(symbol, branchId, report) {
    try {
      if (!this.state.branchReports[symbol]) {
        this.state.branchReports[symbol] = {};
      }
      this.state.branchReports[symbol][branchId] = {
        status: report.status || 'OK',
        branchId,
        divisionId: report.divisionId || 'UNKNOWN',
        agentId: report.agentId || `Agent_${branchId}`,
        symbol,
        direction: report.direction || 'NEUTRAL',
        score: typeof report.score === 'number' && !isNaN(report.score) ? report.score : 0,
        veto: Boolean(report.veto),
        vetoReason: report.vetoReason || null,
        approved: Boolean(report.approved),
        data: report.data || {},
        timestamp: Date.now()
      };
      return this.state.branchReports[symbol][branchId];
    } catch (err) {
      this.logDiagnostic(`publishBranchReport:${symbol}:${branchId}`, err);
      return null;
    }
  }

  getBranchReport(symbol, branchId) {
    try {
      if (!this.state.branchReports[symbol] || !this.state.branchReports[symbol][branchId]) {
        return {
          status: 'SAFE_FALLBACK',
          branchId,
          symbol,
          direction: 'NEUTRAL',
          score: 0,
          veto: false,
          vetoReason: 'MISSING_BRANCH_REPORT',
          approved: false,
          data: {},
          timestamp: Date.now()
        };
      }
      return this.state.branchReports[symbol][branchId];
    } catch (err) {
      this.logDiagnostic(`getBranchReport:${symbol}:${branchId}`, err);
      return { status: 'SAFE_FALLBACK', score: 0, veto: false, approved: false, data: {} };
    }
  }

  /**
   * PASUL 2: Formula Matematica Exacta pentru Scorul de Confluenta >= 85/100
   * Calibrata pentru MARKET EXECUTION (0-Delay) + Anti-Inducement + VETO Instant
   */
  computeConfluenceScore(symbol) {
    try {
      this._checkDailyReset();
      const policy = (this.config && this.config.executionPolicy) || {};
      const threshold = policy.confluenceThreshold || 85;
      const reports = this.state.branchReports[symbol] || {};
      const tuning = this.state.aiTuning[symbol] || {};

      const vetoList = [];

      // 0. Check Divizia 7A Dead-Market Killer
      if (tuning.deadMarketBlocked || (reports['7A'] && reports['7A'].veto)) {
        vetoList.push('7A_DEAD_MARKET_BLOCKED');
      }

      // 1. REGULI DE VETO INSTANT
      // VETO 1A: Spot Price 0-Delay & Spread Guard
      const r1A = this.getBranchReport(symbol, '1A');
      if (r1A.veto || r1A.status === 'SAFE_FALLBACK' || !r1A.approved) {
        vetoList.push(r1A.vetoReason || '1A_SPOT_OR_SPREAD_VETO');
      }

      // VETO 1B & 1C: Session Killzone & Red-Folder News Blocker
      const r1B = this.getBranchReport(symbol, '1B');
      if (r1B.veto || !r1B.approved) {
        vetoList.push(r1B.vetoReason || '1B_OUTSIDE_KILLZONE_SESSION');
      }
      const r1C = this.getBranchReport(symbol, '1C');
      if (r1C.veto || !r1C.approved) {
        vetoList.push(r1C.vetoReason || '1C_RED_FOLDER_NEWS_VETO');
      }

      // VETO 2A/2B/2C/2D: Multi-Timeframe H1 + M15 Alignment
      const mtfBranch = this._getMtfBranchForSymbol(symbol);
      const rMTF = this.getBranchReport(symbol, mtfBranch);
      if (rMTF.veto || !rMTF.approved || (rMTF.direction !== 'LONG' && rMTF.direction !== 'SHORT')) {
        vetoList.push(rMTF.vetoReason || `${mtfBranch}_MTF_CONFLICT_VETO`);
      }

      // VETO 4B: Anti-Chase Filter (Max 15% din drum spre TP1 pentru Market Execution)
      const r4B = this.getBranchReport(symbol, '4B');
      if (r4B.veto || !r4B.approved) {
        vetoList.push(r4B.vetoReason || '4B_ANTI_CHASE_EXCEEDED_15PCT');
      }

      // VETO 4C & 4D: Multi-FX Correlation Guard & Daily Drawdown (Max 2 SL/zi)
      const r4C = this.getBranchReport(symbol, '4C');
      if (r4C.veto || !r4C.approved) {
        vetoList.push(r4C.vetoReason || '4C_CURRENCY_CORRELATION_VETO');
      }
      const r4D = this.getBranchReport(symbol, '4D');
      const slToday = this.getDailySlCount(symbol);
      if (r4D.veto || slToday >= (policy.maxDailySlPerSymbol || 2)) {
        vetoList.push(r4D.vetoReason || `4D_MAX_DAILY_SL_REACHED(${slToday})`);
      }

      // 2. FORMULA MATEMATICA DE PUNCTAJ (Total 100 Puncte)
      // [+25 PUNCTE] Divizia 2: Aliniere H1 Trend + M15 BOS/CHoCH
      const ptsMTF = (!rMTF.veto && rMTF.approved) ? Math.min(25, Math.max(0, rMTF.score)) : 0;

      // [+25 PUNCTE] Divizia 3 (Ramura 3A): Liquidity Sweep / Stop-Hunt
      const r3A = this.getBranchReport(symbol, '3A');
      const ptsSweep = (r3A.approved && r3A.direction === rMTF.direction)
        ? Math.min(25, Math.max(0, r3A.score))
        : 0;

      // [+20 PUNCTE] Divizia 3 (Ramurile 3B, 3C, 3E): Order Block + FVG + Fibo Equilibrium
      // REGULA DE AUR ANTI-INDUCEMENT: Daca Ramura 3A (Liquidity Sweep) are 0 puncte,
      // atunci Ramurile 3B/3C/3E primesc OBLIGATORIU 0 puncte!
      let ptsObFvgEq = 0;
      if (ptsSweep > 0) {
        const r3B = this.getBranchReport(symbol, '3B');
        const r3C = this.getBranchReport(symbol, '3C');
        const r3E = this.getBranchReport(symbol, '3E');
        const rawObFvg = (r3B.score || 0) + (r3C.score || 0) + (r3E.score || 0);
        ptsObFvgEq = Math.min(20, Math.max(0, rawObFvg));
      }

      // [+15 PUNCTE] Divizia 3 (Ramura 3D): Whale Volume Explosion & Rejection
      const r3D = this.getBranchReport(symbol, '3D');
      const ptsVolume = (r3D.approved) ? Math.min(15, Math.max(0, r3D.score)) : 0;

      // [+15 PUNCTE] Divizia 1 (Ramura 1D): Macro & DXY Compass
      const r1D = this.getBranchReport(symbol, '1D');
      const ptsMacro = (r1D.approved) ? Math.min(15, Math.max(0, r1D.score)) : 0;

      // [-25 PUNCTE PENALIZARE] Divizia 5 (Ramura 5B): Avocatul Diavolului / Red-Team
      const r5B = this.getBranchReport(symbol, '5B');
      const penaltyRedTeam = (r5B && r5B.score < 0) ? Math.max(-25, r5B.score) : 0;

      const rawTotal = ptsMTF + ptsSweep + ptsObFvgEq + ptsVolume + ptsMacro + penaltyRedTeam;
      const finalScore = vetoList.length > 0 ? 0 : Math.max(0, Math.min(100, rawTotal));
      const approved = vetoList.length === 0 && finalScore >= threshold;

      const summary = {
        symbol,
        direction: rMTF.direction || 'NEUTRAL',
        finalScore,
        rawTotal,
        threshold,
        approved,
        vetoed: vetoList.length > 0,
        vetoReasons: vetoList,
        breakdown: {
          mtfAlignment_25: ptsMTF,
          liquiditySweep_25: ptsSweep,
          obFvgEquilibrium_20: ptsObFvgEq,
          antiInducementTriggered: ptsSweep === 0,
          whaleVolume_15: ptsVolume,
          macroCompass_15: ptsMacro,
          devilsAdvocatePenalty: penaltyRedTeam
        },
        timestamp: Date.now()
      };

      this.state.confluenceBoard[symbol] = summary;
      return summary;
    } catch (err) {
      this.logDiagnostic(`computeConfluenceScore:${symbol}`, err);
      return {
        symbol,
        direction: 'NEUTRAL',
        finalScore: 0,
        approved: false,
        vetoed: true,
        vetoReasons: ['SAFE_FALLBACK_ERROR'],
        breakdown: {}
      };
    }
  }

  _getMtfBranchForSymbol(symbol) {
    const inst = (this.config.instruments && this.config.instruments[symbol]) || {};
    if (inst.category === 'MAJORS') return '2A';
    if (inst.category === 'CROSSES') return '2B';
    if (inst.category === 'GOLD_METALS') return '2C';
    return '2D';
  }

  // ==========================================================================
  // 🛡️ GESTIUNE POZITII ACTIVE, CORELATIE VALUTARA (4C) & DRAWDOWN (4D)
  // ==========================================================================
  getDailySlCount(symbol) {
    this._checkDailyReset();
    return this.state.riskLedger.slCountBySymbol[symbol] || 0;
  }

  recordStopLoss(symbol) {
    try {
      this._checkDailyReset();
      this.state.riskLedger.slCountBySymbol[symbol] = (this.state.riskLedger.slCountBySymbol[symbol] || 0) + 1;
      this.saveSnapshot();
      return this.state.riskLedger.slCountBySymbol[symbol];
    } catch (err) {
      this.logDiagnostic(`recordStopLoss:${symbol}`, err);
      return 0;
    }
  }

  checkCurrencyCorrelationConflict(symbol, direction) {
    try {
      const inst = (this.config.instruments && this.config.instruments[symbol]) || null;
      if (!inst) return { conflict: false };

      for (const activeSym of Object.keys(this.state.activeTrades)) {
        if (activeSym === symbol) {
          return { conflict: true, reason: `ACTIVE_TRADE_ALREADY_OPEN_ON_${symbol}` };
        }
        const activeInst = (this.config.instruments && this.config.instruments[activeSym]) || null;
        if (!activeInst) continue;

        const sharedCurrencies = [inst.baseCurrency, inst.quoteCurrency].filter(
          c => c === activeInst.baseCurrency || c === activeInst.quoteCurrency
        );
        if (sharedCurrencies.length > 0) {
          return {
            conflict: true,
            reason: `CORRELATION_GUARD_4C: Shared currency [${sharedCurrencies.join(',')}] with active trade on ${activeSym}`
          };
        }
      }
      return { conflict: false, reason: null };
    } catch (err) {
      this.logDiagnostic(`checkCurrencyCorrelationConflict:${symbol}`, err);
      return { conflict: true, reason: 'CORRELATION_CHECK_FALLBACK' };
    }
  }

  registerActiveTrade(symbol, tradeObj) {
    try {
      this.state.activeTrades[symbol] = Object.assign({}, tradeObj, {
        symbol,
        openedAt: Date.now(),
        tp1Hit: false,
        expiredNotified: false
      });
      this.saveSnapshot();
      return this.state.activeTrades[symbol];
    } catch (err) {
      this.logDiagnostic(`registerActiveTrade:${symbol}`, err);
      return null;
    }
  }

  getActiveTrade(symbol) {
    return this.state.activeTrades[symbol] || null;
  }

  closeActiveTrade(symbol, outcome) {
    try {
      const trade = this.state.activeTrades[symbol];
      delete this.state.activeTrades[symbol];
      if (outcome === 'SL') {
        this.recordStopLoss(symbol);
      }
      this.saveSnapshot();
      return trade;
    } catch (err) {
      this.logDiagnostic(`closeActiveTrade:${symbol}`, err);
      return null;
    }
  }

  // ==========================================================================
  // 💾 PERSISTENTA SI DIAGNOSTICARE ZERO-CRASH
  // ==========================================================================
  logDiagnostic(source, err) {
    try {
      this.state.diagnostics.fallbackCount += 1;
      this.state.diagnostics.lastErrors.push({
        source,
        message: err && err.message ? err.message : String(err),
        timestamp: new Date().toISOString()
      });
      if (this.state.diagnostics.lastErrors.length > 50) {
        this.state.diagnostics.lastErrors.shift();
      }
    } catch (_) {
      // Never throw inside diagnostic logger
    }
  }

  saveSnapshot() {
    try {
      const payload = {
        activeTrades: this.state.activeTrades,
        riskLedger: this.state.riskLedger,
        aiTuning: this.state.aiTuning,
        savedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.snapshotPath, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } catch (err) {
      this.logDiagnostic('saveSnapshot', err);
      return false;
    }
  }

  loadSnapshot() {
    try {
      if (fs.existsSync(this.snapshotPath)) {
        const raw = fs.readFileSync(this.snapshotPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.activeTrades) this.state.activeTrades = parsed.activeTrades;
        if (parsed.riskLedger) this.state.riskLedger = parsed.riskLedger;
        if (parsed.aiTuning) Object.assign(this.state.aiTuning, parsed.aiTuning);
        this._checkDailyReset();
      }
    } catch (err) {
      this.logDiagnostic('loadSnapshot', err);
    }
  }
}

module.exports = MarketStateBus;
