const { parseCandle } = require('../div1_shield_macro');

/**
 * DIVIZIA 5: THE BOARD / CONSENSUS & VOTING ENGINE (20 Agenți: 5A, 5B, 5C)
 */
const Div5BoardVoting = {
  /**
   * Ramura 5B (8 Agenți): Devil's Advocate / Red-Team Invalidation Check (-25 Puncte Penalizare)
   * Caută motive să respingă semnalul:
   * 1. Dacă R:R-ul la TP2 din Ramura 4A este < 2.5
   * 2. Dacă există un perete/obstacol major de structură H1 (Swing High/Low opus ne-spart)
   *    chiar în fața intrării (la mai puțin de 50% din distanța până la TP1), blocând drumul spre profit.
   */
  branch5B_DevilsAdvocate: async ({ symbol, marketData, stateBus }) => {
    const r4A = stateBus.getBranchReport(symbol, '4A');
    const rawH1 = (marketData && marketData.h1Candles) || [];

    if (!r4A || !r4A.approved || !r4A.data || rawH1.length < 25) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: true,
        veto: false,
        data: { redTeamCheck: 'SKIPPED_NO_ACTIVE_SETUP' }
      };
    }

    const dir = r4A.direction;
    const entry = r4A.data.marketEntryPrice;
    const tp1 = r4A.data.tp1;
    const rrTp2 = r4A.data.rrTp2 || 0;

    // Verificare 1: Raport Risc/Recompensă la TP2 < 2.5
    if (rrTp2 < 2.5) {
      return {
        status: 'OK',
        direction: dir,
        score: -25,
        approved: false,
        veto: false,
        data: {
          penaltyApplied: -25,
          reason: `RED_TEAM_LOW_RR_TP2(${rrTp2} < 2.5)`
        }
      };
    }

    // Verificare 2: Căutăm dacă un fractal H1 major opus blochează imediat calea spre TP1
    const h1 = rawH1.map(parseCandle);
    const len = h1.length;
    const distToTp1 = Math.abs(tp1 - entry);
    let opposingWallPrice = null;

    // Verificăm fractalele H1 din ultimele 20 de ore (exclusiv ultimele 3 lumânări de impuls curent)
    for (let i = Math.max(2, len - 20); i < len - 3; i++) {
      const c = h1[i];
      const isFractalHigh = c.high > h1[i - 1].high && c.high > h1[i - 2].high && c.high > h1[i + 1].high && c.high > h1[i + 2].high;
      const isFractalLow = c.low < h1[i - 1].low && c.low < h1[i - 2].low && c.low < h1[i + 1].low && c.low < h1[i + 2].low;

      // Dacă ultimul close H1 a trecut deja de acel fractal, obstacolul a fost spart (nu mai blochează)
      const h1CurrentClose = h1[len - 1].close;

      if (dir === 'LONG' && isFractalHigh && c.high > entry && c.high < tp1 && h1CurrentClose < c.high) {
        const distToWall = c.high - entry;
        if (distToWall < distToTp1 * 0.65) {
          opposingWallPrice = c.high;
          break;
        }
      }

      if (dir === 'SHORT' && isFractalLow && c.low < entry && c.low > tp1 && h1CurrentClose > c.low) {
        const distToWall = entry - c.low;
        if (distToWall < distToTp1 * 0.65) {
          opposingWallPrice = c.low;
          break;
        }
      }
    }

    if (opposingWallPrice !== null) {
      return {
        status: 'OK',
        direction: dir,
        score: -25,
        approved: false,
        veto: false,
        data: {
          penaltyApplied: -25,
          reason: `RED_TEAM_OPPOSING_H1_WALL_AT_${opposingWallPrice}`
        }
      };
    }

    return {
      status: 'OK',
      direction: dir,
      score: 0,
      approved: true,
      veto: false,
      data: {
        penaltyApplied: 0,
        redTeamClear: true,
        rrTp2Verified: rrTp2
      }
    };
  },

  /**
   * Ramura 5A (8 Agenți): Confluence Score Aggregator (Prag >= 85/100)
   * Apelează stateBus.computeConfluenceScore(symbol) și validează decizia finală.
   */
  branch5A_ConfluenceAggregator: async ({ symbol, stateBus }) => {
    const confluence = stateBus.computeConfluenceScore(symbol);

    return {
      status: 'OK',
      direction: confluence.direction,
      score: confluence.finalScore,
      approved: confluence.approved,
      veto: confluence.vetoed,
      vetoReason: confluence.vetoReasons && confluence.vetoReasons.length > 0
        ? confluence.vetoReasons.join(' | ')
        : null,
      data: confluence
    };
  },

  /**
   * Ramura 5C (4 Agenți): Signal Priority & Best-Setup Selector
   * Evaluează toate perechile care au trecut pragul >= 85/100 în ciclul curent
   * și o marchează pe cea cu scorul și R:R-ul cel mai mare drept câștigătoare pentru execuție.
   */
  branch5C_SignalPrioritySelector: async ({ symbol, stateBus }) => {
    const board = (stateBus.state && stateBus.state.confluenceBoard) || {};
    const current = board[symbol] || stateBus.computeConfluenceScore(symbol);

    if (!current || !current.approved) {
      return {
        status: 'OK',
        direction: 'NEUTRAL',
        score: 0,
        approved: false,
        veto: false,
        data: { selectedForExecution: false, reason: 'SCORE_BELOW_85_OR_VETOED' }
      };
    }

    // Sortăm toate instrumentele aprobate descrescător după finalScore, apoi după rrTp2
    const approvedCandidates = Object.values(board).filter(item => item && item.approved);
    approvedCandidates.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      const r4A_a = stateBus.getBranchReport(a.symbol, '4A');
      const r4A_b = stateBus.getBranchReport(b.symbol, '4A');
      const rrA = (r4A_a && r4A_a.data && r4A_a.data.rrTp2) || 0;
      const rrB = (r4A_b && r4A_b.data && r4A_b.data.rrTp2) || 0;
      return rrB - rrA;
    });

    const topCandidate = approvedCandidates[0] || current;
    const isTopPriority = topCandidate.symbol === symbol;

    return {
      status: 'OK',
      direction: current.direction,
      score: current.finalScore,
      approved: isTopPriority,
      veto: false,
      data: {
        selectedForExecution: isTopPriority,
        rank: approvedCandidates.findIndex(c => c.symbol === symbol) + 1,
        totalApprovedInCycle: approvedCandidates.length,
        topSymbol: topCandidate.symbol
      }
    };
  }
};

module.exports = { Div5BoardVoting };
