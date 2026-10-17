/**
 * BaseForexAgent - Clasa de baza cu Scut Anti-Crash (Regula 2 Zero-Crash)
 * Toti cei 300 de agenti din cele 7 Divizii si 24 Sub-Ramuri mostenesc aceasta clasa.
 * Orice eroare matematica, date lipsa sau API picat este prinsa silentios in `runSafely()`
 * si returneaza obiectul standardizat: `{"status": "SAFE_FALLBACK", "score": 0, "approved": false}`.
 */
class BaseForexAgent {
  constructor(options = {}) {
    this.agentId = options.agentId || 'Agent_Generic';
    this.divisionId = options.divisionId || 'div_unknown';
    this.branchId = options.branchId || '0A';
    this.role = options.role || 'GENERIC_ROLE';
    this.symbol = options.symbol || 'XAUUSD';
    this.canVeto = Boolean(options.canVeto);
    this.maxPoints = typeof options.maxPoints === 'number' ? options.maxPoints : 0;
    this.stateBus = options.stateBus || null;
    this.config = options.config || {};
    this.customLogic = typeof options.customLogic === 'function' ? options.customLogic : null;
  }

  /**
   * Scutul Obligatoriu Anti-Crash (Try/Catch)
   * Niciun agent nu poate opri aplicatia, indiferent de ce eroare apare.
   */
  async execute(context = {}) {
    try {
      const targetSymbol = context.symbol || this.symbol;
      if (!this.stateBus) {
        return this._buildFallback(targetSymbol, 'NO_STATE_BUS_CONNECTED');
      }

      const marketData = this.stateBus.getMarketData(targetSymbol);
      let rawResult = null;

      if (this.customLogic) {
        rawResult = await this.customLogic({
          agent: this,
          symbol: targetSymbol,
          marketData,
          stateBus: this.stateBus,
          config: this.config,
          context
        });
      } else {
        rawResult = await this.analyze({
          symbol: targetSymbol,
          marketData,
          stateBus: this.stateBus,
          config: this.config,
          context
        });
      }

      if (!rawResult || typeof rawResult !== 'object') {
        return this._publishAndReturn(targetSymbol, this._buildFallback(targetSymbol, 'EMPTY_AGENT_OUTPUT'));
      }

      const safeScore = typeof rawResult.score === 'number' && !isNaN(rawResult.score) && isFinite(rawResult.score)
        ? rawResult.score
        : 0;

      const normalizedReport = {
        status: rawResult.status || 'OK',
        agentId: this.agentId,
        divisionId: this.divisionId,
        branchId: this.branchId,
        role: this.role,
        symbol: targetSymbol,
        direction: rawResult.direction || 'NEUTRAL',
        score: safeScore,
        veto: this.canVeto ? Boolean(rawResult.veto) : false,
        vetoReason: rawResult.vetoReason || null,
        approved: Boolean(rawResult.approved),
        data: rawResult.data || {},
        timestamp: Date.now()
      };

      return this._publishAndReturn(targetSymbol, normalizedReport);
    } catch (err) {
      const targetSymbol = (context && context.symbol) || this.symbol;
      if (this.stateBus) {
        this.stateBus.logDiagnostic(`${this.agentId}[${this.branchId}:${targetSymbol}]`, err);
      }
      const fallback = this._buildFallback(targetSymbol, err && err.message ? err.message : 'AGENT_RUNTIME_EXCEPTION');
      return this._publishAndReturn(targetSymbol, fallback);
    }
  }

  /**
   * Metoda implicita suprascrisa de fiecare din cele 24 de Sub-Ramuri
   */
  async analyze() {
    return {
      status: 'SAFE_FALLBACK',
      score: 0,
      approved: false,
      veto: false,
      direction: 'NEUTRAL',
      data: { note: 'Base analyze called without branch override' }
    };
  }

  _buildFallback(symbol, reason) {
    return {
      status: 'SAFE_FALLBACK',
      agentId: this.agentId,
      divisionId: this.divisionId,
      branchId: this.branchId,
      role: this.role,
      symbol,
      direction: 'NEUTRAL',
      score: 0,
      veto: false,
      vetoReason: reason || 'SAFE_FALLBACK',
      approved: false,
      data: { fallbackReason: reason || 'UNKNOWN' },
      timestamp: Date.now()
    };
  }

  _publishAndReturn(symbol, report) {
    try {
      if (this.stateBus && report.publishToBus !== false) {
        this.stateBus.publishBranchReport(symbol, this.branchId, report);
      }
    } catch (_) {
      // Silenced by Zero-Crash Rule
    }
    return report;
  }

  // ==========================================================================
  // 📐 BIBLIOTECA MATEMATICA INSTITUTIONALA (SMC / ORDERFLOW / MULTI-TF)
  // ==========================================================================
  static getSMA(candles, period, endIndex) {
    if (!Array.isArray(candles) || endIndex < period - 1 || period <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += parseFloat(candles[endIndex - i][4]);
    }
    return sum / period;
  }

  static getEMA(candles, period, endIndex) {
    if (!Array.isArray(candles) || endIndex < period || period <= 0) return 0;
    const k = 2 / (period + 1);
    const startIdx = Math.max(0, endIndex - period * 3);
    let ema = parseFloat(candles[startIdx][4]);
    for (let i = startIdx + 1; i <= endIndex; i++) {
      const close = parseFloat(candles[i][4]);
      ema = close * k + ema * (1 - k);
    }
    return ema;
  }

  static getTrueATR(candles, period, endIndex) {
    if (!Array.isArray(candles) || endIndex < period || period <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      const idx = endIndex - i;
      const high = parseFloat(candles[idx][2]);
      const low = parseFloat(candles[idx][3]);
      const prevClose = parseFloat(candles[idx - 1][4]);
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      sum += tr;
    }
    return sum / period;
  }

  static getShockRSI(candles, period, endIndex) {
    if (!Array.isArray(candles) || endIndex < period || period <= 0) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 0; i < period; i++) {
      const diff = parseFloat(candles[endIndex - i][4]) - parseFloat(candles[endIndex - i - 1][4]);
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
  }

  // ==========================================================================
  // 🏭 MULTIPLICATOR DINAMIC PENTRU CEI 300 DE AGENTI AI COMPANIEI
  // ==========================================================================
  static spawnFleet(config, stateBus, branchHandlers = {}) {
    const fleet = {
      totalSpawned: 0,
      byDivision: {},
      byBranch: {},
      allAgents: []
    };

    try {
      const instruments = Object.keys((config && config.instruments) || { XAUUSD: {} });
      const divisions = (config && config.divisions) || [];

      for (const div of divisions) {
        fleet.byDivision[div.divisionId] = [];
        for (const branch of div.branches || []) {
          fleet.byBranch[branch.branchId] = [];
          const count = branch.agentCount || 1;
          const handler = branchHandlers[branch.branchId] || null;

          for (let i = 0; i < count; i++) {
            const assignedSymbol = instruments[i % instruments.length];
            const agent = new BaseForexAgent({
              agentId: `Agent_${branch.branchId}_${String(i + 1).padStart(2, '0')}`,
              divisionId: div.divisionId,
              branchId: branch.branchId,
              role: branch.role,
              symbol: assignedSymbol,
              canVeto: branch.canVeto,
              maxPoints: branch.maxPoints || 0,
              stateBus,
              config,
              customLogic: handler
            });

            fleet.byDivision[div.divisionId].push(agent);
            fleet.byBranch[branch.branchId].push(agent);
            fleet.allAgents.push(agent);
            fleet.totalSpawned += 1;
          }
        }
      }
    } catch (err) {
      if (stateBus) stateBus.logDiagnostic('BaseForexAgent.spawnFleet', err);
    }

    return fleet;
  }
}

module.exports = BaseForexAgent;
