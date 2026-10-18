'use strict';

/**
 * BranchAgent — învelișul fiecărei ramuri de analiză.
 *  - rulează logica ramurii într-un try/catch (o ramură defectă nu oprește sistemul);
 *  - o eroare NU aprobă nimic: ramurile cu drept de veto pun VETO la eroare (fail-closed);
 *  - normalizează raportul și îl publică pe MarketStateBus.
 */
class BranchAgent {
  constructor({ branchId, name, division, canVeto = false, handler }) {
    if (typeof handler !== 'function') throw new Error(`Branch ${branchId} has no handler`);
    this.branchId = branchId;
    this.name = name || branchId;
    this.division = division || '';
    this.canVeto = Boolean(canVeto);
    this.handler = handler;
  }

  async execute({ symbol, stateBus, config, context = {} }) {
    let report;
    try {
      const marketData = stateBus.getMarketData(symbol);
      const inst = stateBus.instrument(symbol);
      if (!inst) throw new Error(`UNKNOWN_INSTRUMENT_${symbol}`);
      const raw = await this.handler({ symbol, marketData, stateBus, config, inst, context, now: stateBus.now() });
      if (!raw || typeof raw !== 'object') throw new Error('EMPTY_BRANCH_OUTPUT');
      report = {
        status: raw.status || 'OK',
        direction: raw.direction || 'NEUTRAL',
        score: Number.isFinite(raw.score) ? raw.score : 0,
        veto: this.canVeto ? Boolean(raw.veto) : false,
        vetoReason: raw.vetoReason || null,
        approved: Boolean(raw.approved),
        data: raw.data || {}
      };
    } catch (err) {
      stateBus.logDiagnostic(`${this.branchId}:${symbol}`, err);
      report = {
        status: 'ERROR',
        direction: 'NEUTRAL',
        score: 0,
        veto: this.canVeto,
        vetoReason: `${this.branchId}_ERROR(${err && err.message ? err.message : 'unknown'})`,
        approved: false,
        data: {}
      };
    }
    return stateBus.publishBranchReport(symbol, this.branchId, report);
  }
}

module.exports = BranchAgent;
