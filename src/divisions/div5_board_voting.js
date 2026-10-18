'use strict';

/**
 * 5B — Red-Team: −25 dacă R:R la TP2 < minim, sau dacă un fractal H1 opus, nespart,
 * stă între intrare și TP1 la mai puțin de 65% din drum.
 */
function branch5B_DevilsAdvocate({ symbol, marketData: md, stateBus, config }) {
  const minRR = (config.executionPolicy || {}).devilsAdvocateMinRR || 2.5;
  const r4A = stateBus.getBranchReport(symbol, '4A');
  const h1 = (md && md.h1Candles) || [];
  if (!r4A.approved || h1.length < 25) {
    return { status: 'OK', direction: 'NEUTRAL', score: 0, approved: true, veto: false, data: { redTeam: 'SKIPPED_NO_SETUP' } };
  }
  const dir = r4A.direction;
  const { entry, tp1, rrTp2 } = r4A.data;
  if (rrTp2 < minRR) {
    return { status: 'OK', direction: dir, score: -25, approved: false, veto: false, data: { penalty: -25, reason: `LOW_RR_TP2(${rrTp2} < ${minRR})` } };
  }
  const len = h1.length;
  const lastClose = h1[len - 1].close;
  const toTp1 = Math.abs(tp1 - entry);
  for (let i = Math.max(2, len - 20); i < len - 3; i++) {
    const c = h1[i];
    const fh = c.high > h1[i - 1].high && c.high > h1[i - 2].high && c.high > h1[i + 1].high && c.high > h1[i + 2].high;
    const fl = c.low < h1[i - 1].low && c.low < h1[i - 2].low && c.low < h1[i + 1].low && c.low < h1[i + 2].low;
    if (dir === 'LONG' && fh && c.high > entry && c.high < tp1 && lastClose < c.high && c.high - entry < toTp1 * 0.65) {
      return { status: 'OK', direction: dir, score: -25, approved: false, veto: false, data: { penalty: -25, reason: `OPPOSING_H1_HIGH_AT_${c.high}` } };
    }
    if (dir === 'SHORT' && fl && c.low < entry && c.low > tp1 && lastClose > c.low && entry - c.low < toTp1 * 0.65) {
      return { status: 'OK', direction: dir, score: -25, approved: false, veto: false, data: { penalty: -25, reason: `OPPOSING_H1_LOW_AT_${c.low}` } };
    }
  }
  return { status: 'OK', direction: dir, score: 0, approved: true, veto: false, data: { penalty: 0, redTeamClear: true } };
}

/** 5A — agregatorul: aplică formula de confluență din MarketStateBus. */
function branch5A_ConfluenceAggregator({ symbol, stateBus }) {
  const c = stateBus.computeConfluenceScore(symbol);
  return {
    status: 'OK',
    direction: c.direction,
    score: c.finalScore,
    approved: c.approved,
    veto: c.vetoed,
    vetoReason: c.vetoReasons.length ? c.vetoReasons.join(' | ') : null,
    data: c
  };
}

module.exports = { branch5B_DevilsAdvocate, branch5A_ConfluenceAggregator };
