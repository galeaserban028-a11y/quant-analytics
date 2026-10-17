const path = require('path');
const config = require('./config/agents_config.json');
const { ApexQuantOrchestrator, buildInstitutionalGoldDataset } = require('./orchestrator');

/**
 * Construiește un dataset instituțional SHORT perfect pe EURUSD (Majors)
 * - H1: Trend Bearish (EMA 50 descendent + structură LH/LL)
 * - M15:
 *   1. Pool de lichiditate (Swing High la 1.08620)
 *   2. Lumânare de Stop-Hunt / Liquidity Sweep (fitil la 1.08640 peste 1.08620, închidere la 1.08560) -> +25p (3A)
 *   3. Impuls Whale Bearish Displacement (volum 2.5x media) + BOS Bearish sub 1.08480 -> +25p (2A) & +15p (3D)
 *   4. Retest live la Spot 1.08550 în Order Block + Bearish FVG, în zona de Premium (>50% Fibo) -> +20p (3B+3C+3E)
 */
function buildInstitutionalEurUsdShortDataset() {
  const gold = buildInstitutionalGoldDataset();
  // Oglindim matematic la milimetru structura SMC (scala 1 pip Gold [0.10] -> 2.5 pips EURUSD [0.00025])
  // Astfel: H1 devine Bearish (LH/LL sub EMA50), M15 face Buy-Side Liquidity Sweep + Bearish BOS + FVG + OB în Premium (>50% Fibo)
  const mirrorPrice = (p) => Number((1.08500 - (p - 2650.10) * 0.00025).toFixed(5));

  const h1Candles = gold.h1Candles.map(c => ({
    timestamp: c.timestamp,
    open: mirrorPrice(c.open),
    high: mirrorPrice(c.low),
    low: mirrorPrice(c.high),
    close: mirrorPrice(c.close),
    volume: c.volume
  }));

  const m15Candles = gold.m15Candles.map(c => ({
    timestamp: c.timestamp,
    open: mirrorPrice(c.open),
    high: mirrorPrice(c.low),
    low: mirrorPrice(c.high),
    close: mirrorPrice(c.close),
    volume: c.volume
  }));

  return {
    symbol: 'EURUSD',
    spotBid: 1.08495,
    spotAsk: 1.08505,
    spotMid: 1.08500,
    spreadPips: 1.0, // Sub max 1.8 pips; SL = 12.2 pips -> Spread/SL = 8.2% <= 18%
    spotTimestamp: gold.spotTimestamp,
    referenceTime: gold.referenceTime,
    dxyBias: 'BULLISH_USD', // Susține EURUSD SHORT (+15p în 1D)
    newsEvents: [],
    h1Candles,
    m15Candles
  };
}

/**
 * SUITA OFFLINE DE STRESS-TESTING & SIMULARE DE HAOS PE CEI 300 DE AGENȚI
 */
async function runStressTestSuite() {
  const testSnapshotPath = path.join(__dirname, 'config', 'stress_test_snapshot.json');
  const orchestrator = new ApexQuantOrchestrator(config, testSnapshotPath);
  const results = [];
  let unhandledCrashes = 0;

  console.log('========================================================================================');
  console.log('🛡️  APEX QUANT 300-AGENT DESK — SUITA OFFLINE DE STRESS-TESTING & HAOS (8 SCENARII) 🛡️');
  console.log('========================================================================================');
  console.log(`Flotă activă: ${orchestrator.fleet.totalSpawned} Agenți | 7 Divizii | Scut Zero-Crash Activat\n`);

  // ========================================================================================
  // TESTUL 1: Semnal Perfect LONG pe XAUUSD -> Aprobare >= 85/100 -> TP1 (Protected BE) ->
  //           2.2 R:R (Trailing Lock pe TP1) -> TP2 (3.0 R:R Full Win)
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    orchestrator.stateBus.state.riskLedger.slCountBySymbol = {};
    orchestrator.stateBus.state.aiTuning['XAUUSD'].deadMarketBlocked = false;

    const goldData = buildInstitutionalGoldDataset();
    orchestrator.stateBus.updateMarketData('XAUUSD', goldData);

    const cycle1 = await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });
    const eval1 = cycle1.evaluatedSymbols['XAUUSD'];
    const trade1 = orchestrator.stateBus.getActiveTrade('XAUUSD');

    // Pasul 1B: Simulare atingere TP1 (1.5 R:R = 2656.47) -> Mutare SL la Protected Break-Even (Entry + Spread + 0.5p = 2650.35)
    orchestrator.stateBus.updateMarketData('XAUUSD', {
      spotMid: trade1.tp1 + 0.05,
      spotTimestamp: Date.now()
    });
    const wTp1 = await orchestrator.runBranch('6B', 'XAUUSD');

    // Pasul 1C: Simulare atingere 2.2 R:R (Trailing Lock = 2659.45) -> Mutare SL pe nivelul TP1 (2656.47)
    orchestrator.stateBus.updateMarketData('XAUUSD', {
      spotMid: trade1.tp15TrailingLock + 0.05,
      spotTimestamp: Date.now()
    });
    const wTp15 = await orchestrator.runBranch('6B', 'XAUUSD');

    // Pasul 1D: Simulare atingere TP2 (3.0 R:R = 2662.85) -> Închidere completă pe profit în 6C
    orchestrator.stateBus.updateMarketData('XAUUSD', {
      spotMid: trade1.tp2 + 0.10,
      spotTimestamp: Date.now()
    });
    const exitTp2 = await orchestrator.runBranch('6C', 'XAUUSD');

    const passed =
      eval1.confluence.finalScore === 100 &&
      eval1.confluence.approved === true &&
      wTp1.data.tp1Hit === true &&
      wTp1.data.currentStopLoss === 2650.35 &&
      wTp15.data.tp15Hit === true &&
      wTp15.data.currentStopLoss === trade1.tp1 &&
      exitTp2.data.outcome === 'TP2_FULL_WIN';

    results.push({ testId: 1, name: 'XAUUSD LONG Lifecycle (TP1 Protected BE -> 2.2RR Lock -> TP2)', passed });
    console.log(`✅ [TEST 1] ${passed ? 'PASSED' : 'FAILED'} — Semnal Perfect LONG pe XAUUSD:`);
    console.log(`   • Scor Confluență: ${eval1.confluence.finalScore}/100 (Approved=${eval1.confluence.approved})`);
    console.log(`   • Entry Spot: ${trade1.marketEntryPrice} | SL Inițial: ${trade1.stopLoss} | Spread/SL Ratio: ${eval1.riskGeometry.spreadToRiskPct}% (<= 18%)`);
    console.log(`   • La TP1 (${trade1.tp1}): ${wTp1.data.alerts[0]}`);
    console.log(`   • La 2.2 R:R (${trade1.tp15TrailingLock}): ${wTp15.data.alerts[0]}`);
    console.log(`   • La TP2 (${trade1.tp2}): ${exitTp2.data.closeMessage}\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 1, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 2: Semnal Perfect SHORT pe EURUSD -> Expirare fereastră de 180s (TTL Expired Alert)
  //           + Verificare Spread-to-Risk Ratio Guard (> 18% VETO)
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    orchestrator.stateBus.state.riskLedger.slCountBySymbol = {};
    orchestrator.stateBus.state.aiTuning['EURUSD'].deadMarketBlocked = false;

    const eurData = buildInstitutionalEurUsdShortDataset();
    orchestrator.stateBus.updateMarketData('EURUSD', eurData);

    const cycle2 = await orchestrator.runCompanyCycle(['EURUSD'], { sendLiveTelegram: false });
    const eval2 = cycle2.evaluatedSymbols['EURUSD'];
    const trade2 = orchestrator.stateBus.getActiveTrade('EURUSD');

    // Simulăm trecerea a 185 secunde (> 180s TTL) fără atingerea TP1
    orchestrator.stateBus.updateMarketData('EURUSD', {
      spotMid: 1.08490,
      simulatedElapsedSec: 185,
      spotTimestamp: Date.now()
    });
    const wExpiry = await orchestrator.runBranch('6B', 'EURUSD');

    // Sub-test 2B: Verificăm gardianul Spread-to-Risk (> 18% din SL) pe M15 Scalping
    const tightSlData = buildInstitutionalEurUsdShortDataset();
    // Prețul Spot 1.08570 aproape de fitilul Sweep 1.08598 (SL total = 6.0 pips cu spread = 1.7 pips -> 28.3% > 18% max!)
    tightSlData.spotMid = 1.08570;
    tightSlData.spreadPips = 1.7;
    orchestrator.stateBus.state.activeTrades = {};
    orchestrator.stateBus.updateMarketData('EURUSD', tightSlData);
    await orchestrator.runBranch('2A', 'EURUSD');
    await orchestrator.runBranch('3A', 'EURUSD');
    const r4ATight = await orchestrator.runBranch('4A', 'EURUSD');

    const passed =
      eval2.confluence.finalScore === 100 &&
      eval2.confluence.direction === 'SHORT' &&
      wExpiry.data.expiredNotified === true &&
      wExpiry.data.alerts.some(a => a.includes('SIGNAL EXPIRED (TTL 180s)')) &&
      r4ATight.veto === true &&
      r4ATight.vetoReason.includes('SPREAD_TO_SL_RATIO_TOO_HIGH');

    results.push({ testId: 2, name: 'EURUSD SHORT 180s TTL Expiry + Spread-to-SL Ratio Guard (>18%)', passed });
    console.log(`✅ [TEST 2] ${passed ? 'PASSED' : 'FAILED'} — Semnal SHORT pe EURUSD & Expirare TTL 180s + Spread/SL Guard:`);
    console.log(`   • Scor EURUSD SHORT: ${eval2.confluence.finalScore}/100 | Entry: ${trade2.marketEntryPrice} | Protected BE: ${trade2.protectedBreakEvenPrice}`);
    console.log(`   • Alertă la 185s: ${wExpiry.data.alerts[0]}`);
    console.log(`   • Protecție Scalping 4A (Spread > 18% din SL): VETO=${r4ATight.veto} -> ${r4ATight.vetoReason}\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 2, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 3: Capcană Inducement (Order Block + FVG perfecte, dar fără Liquidity Sweep 3A)
  //           -> Blocare automată (Scor 3B/3C/3E = 0)
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    const inducementData = buildInstitutionalGoldDataset();
    // Eliminăm fitilul de Liquidity Sweep de pe lumânarea 35 (low = 2648.60 > priorLiquidityLow 2648.00)
    inducementData.m15Candles[35].low = 2648.60;
    orchestrator.stateBus.updateMarketData('XAUUSD', inducementData);

    const cycle3 = await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });
    const conf3 = cycle3.evaluatedSymbols['XAUUSD'].confluence;

    const passed =
      conf3.breakdown.liquiditySweep_25 === 0 &&
      conf3.breakdown.obFvgEquilibrium_20 === 0 &&
      conf3.breakdown.antiInducementTriggered === true &&
      conf3.finalScore === 55 &&
      conf3.approved === false;

    results.push({ testId: 3, name: 'Anti-Inducement Trap (3A=0 -> 3B/3C/3E forced to 0)', passed });
    console.log(`✅ [TEST 3] ${passed ? 'PASSED' : 'FAILED'} — Capcană Inducement (OB + FVG fără Liquidity Sweep 3A):`);
    console.log(`   • Puncte 3A (Sweep): ${conf3.breakdown.liquiditySweep_25} | Puncte 3B/3C/3E (OB/FVG/Eq): ${conf3.breakdown.obFvgEquilibrium_20}`);
    console.log(`   • Anti-Inducement Triggered: ${conf3.breakdown.antiInducementTriggered} | Scor Final: ${conf3.finalScore}/100 (Approved=${conf3.approved})\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 3, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 4: Știre Red-Folder (CPI/NFP) + Spread Spike (Spread = 6.5 pips pe EURUSD)
  //           -> VETO instant din Divizia 1
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    const newsSpreadData = buildInstitutionalEurUsdShortDataset();
    newsSpreadData.spreadPips = 6.5; // Max permis pe EURUSD este 1.8 pips
    newsSpreadData.newsEvents = [
      {
        title: 'US CPI Flash Release & NFP',
        currency: 'USD',
        impact: 'RED',
        timestamp: newsSpreadData.referenceTime + 10 * 60 * 1000 // Peste 10 minute (în fereastra +/- 30m)
      }
    ];
    orchestrator.stateBus.updateMarketData('EURUSD', newsSpreadData);

    const cycle4 = await orchestrator.runCompanyCycle(['EURUSD'], { sendLiveTelegram: false });
    const conf4 = cycle4.evaluatedSymbols['EURUSD'].confluence;

    const hasSpreadVeto = conf4.vetoReasons.some(r => r.includes('1A_SPREAD_TOO_HIGH'));
    const hasNewsVeto = conf4.vetoReasons.some(r => r.includes('1C_RED_FOLDER_NEWS_BLOCK'));
    const passed = conf4.vetoed === true && hasSpreadVeto && hasNewsVeto && conf4.finalScore === 0;

    results.push({ testId: 4, name: 'Divizia 1 Red-Folder News (CPI/NFP) + Spread Spike (6.5p) VETO', passed });
    console.log(`✅ [TEST 4] ${passed ? 'PASSED' : 'FAILED'} — Știre Red-Folder (CPI/NFP) + Spread Spike (6.5 pips):`);
    console.log(`   • Scor Final: ${conf4.finalScore}/100 | Vetoed: ${conf4.vetoed}`);
    console.log(`   • Motive VETO: ${JSON.stringify(conf4.vetoReasons)}\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 4, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 5: Conflict Multi-Timeframe (H1 Bullish dar M15 face BOS Bearish)
  //           -> VETO instant din Divizia 2
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    const conflictData = buildInstitutionalGoldDataset();
    // Păstrăm H1 Bullish, dar inversăm ultimele 5 lumânări M15 într-un BOS Bearish puternic sub 2647.00
    conflictData.m15Candles[36] = { timestamp: Date.now() - 180000, open: 2650.0, high: 2650.2, low: 2645.0, close: 2645.2, volume: 1600 };
    conflictData.m15Candles[37] = { timestamp: Date.now() - 120000, open: 2645.2, high: 2646.0, low: 2644.5, close: 2644.8, volume: 900 };
    conflictData.m15Candles[38] = { timestamp: Date.now() - 60000, open: 2644.8, high: 2645.5, low: 2644.2, close: 2645.1, volume: 700 };
    conflictData.m15Candles[39] = { timestamp: Date.now(), open: 2645.1, high: 2645.3, low: 2644.0, close: 2644.1, volume: 1100 };
    conflictData.spotMid = 2644.1;
    orchestrator.stateBus.updateMarketData('XAUUSD', conflictData);

    const cycle5 = await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });
    const conf5 = cycle5.evaluatedSymbols['XAUUSD'].confluence;

    const hasMtfVeto = conf5.vetoReasons.some(r => r.includes('2C_GOLD_MTF_CONFLICT(H1=LONG,M15=SHORT)'));
    const passed = conf5.vetoed === true && hasMtfVeto && conf5.finalScore === 0;

    results.push({ testId: 5, name: 'Divizia 2 Multi-Timeframe Conflict (H1=LONG vs M15=SHORT) VETO', passed });
    console.log(`✅ [TEST 5] ${passed ? 'PASSED' : 'FAILED'} — Conflict Multi-Timeframe (H1 Bullish vs M15 Bearish BOS):`);
    console.log(`   • Scor Final: ${conf5.finalScore}/100 | Motive VETO: ${JSON.stringify(conf5.vetoReasons)}\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 5, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 6: Penalizare "Avocatul Diavolului" (Ramura 5B găsește zid major H1 în fața TP1
  //           și scade -25 puncte, coborând scorul la 75/100 < 85/100 -> Respins)
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    const redTeamData = buildInstitutionalGoldDataset();
    // Plasăm un fractal Swing High H1 ne-spart la 2652.80 (între Entry 2650.10 și TP1 2656.47),
    // în timp ce prețul H1 curent este 2650.10 (sub zidul de la 2652.80)
    redTeamData.h1Candles[50].high = 2652.80;
    redTeamData.h1Candles[59].close = 2650.10;
    orchestrator.stateBus.updateMarketData('XAUUSD', redTeamData);

    const cycle6 = await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });
    const conf6 = cycle6.evaluatedSymbols['XAUUSD'].confluence;
    const r5B = orchestrator.stateBus.getBranchReport('XAUUSD', '5B');

    const passed =
      conf6.breakdown.devilsAdvocatePenalty === -25 &&
      conf6.finalScore === 75 &&
      conf6.approved === false;

    results.push({ testId: 6, name: "Divizia 5B Devil's Advocate (-25p H1 Wall Penalty -> 75/100 Rejected)", passed });
    console.log(`✅ [TEST 6] ${passed ? 'PASSED' : 'FAILED'} — Penalizare "Avocatul Diavolului" (Zid H1 în fața TP1):`);
    console.log(`   • Motiv 5B: ${r5B.data.reason} | Penalizare: ${conf6.breakdown.devilsAdvocatePenalty} puncte`);
    console.log(`   • Scor Brut: 100 -> Scor Final: ${conf6.finalScore}/100 (Prag >= 85 -> Approved=${conf6.approved})\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 6, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 7: Simulare 2 Stop-Loss-uri consecutive pe GBPJPY -> Declanșare automată
  //           branch4D_DailyDrawdownBreaker + activare div7_ai_research_bg (Dead-Market 48h + Strategy Switcher)
  // ========================================================================================
  try {
    orchestrator.stateBus.state.activeTrades = {};
    orchestrator.stateBus.state.riskLedger.slCountBySymbol['GBPJPY'] = 0;
    orchestrator.stateBus.state.aiTuning['GBPJPY'].activeStrategy = 'PULLBACK';
    orchestrator.stateBus.state.aiTuning['GBPJPY'].deadMarketBlocked = false;

    // Simulăm 2 poziții pe GBPJPY care ating Stop-Loss în aceeași zi
    orchestrator.stateBus.registerActiveTrade('GBPJPY', { direction: 'LONG', marketEntryPrice: 198.500, stopLoss: 198.100, tp1: 199.100, tp2: 199.700 });
    orchestrator.stateBus.closeActiveTrade('GBPJPY', 'SL');

    orchestrator.stateBus.registerActiveTrade('GBPJPY', { direction: 'LONG', marketEntryPrice: 198.200, stopLoss: 197.800, tp1: 198.800, tp2: 199.400 });
    orchestrator.stateBus.closeActiveTrade('GBPJPY', 'SL');

    const gbpJpyData = buildInstitutionalGoldDataset();
    gbpJpyData.symbol = 'GBPJPY';
    orchestrator.stateBus.updateMarketData('GBPJPY', gbpJpyData);

    const cycle7 = await orchestrator.runCompanyCycle(['GBPJPY'], { sendLiveTelegram: false });
    const conf7 = cycle7.evaluatedSymbols['GBPJPY'].confluence;
    const r4D = orchestrator.stateBus.getBranchReport('GBPJPY', '4D');
    const r7A = orchestrator.stateBus.getBranchReport('GBPJPY', '7A');
    const r7C = orchestrator.stateBus.getBranchReport('GBPJPY', '7C');

    const passed =
      r4D.veto === true &&
      r7A.veto === true &&
      r7A.data.deadMarketBlocked === true &&
      r7A.data.lockoutHours === 48 &&
      r7C.data.activeStrategy === 'MEAN_REVERSION_DEFENSIVE' &&
      conf7.finalScore === 0;

    results.push({ testId: 7, name: 'GBPJPY 2x SL Streak -> 4D Breaker + 7A 48h Lockout + 7C Strategy Switch', passed });
    console.log(`✅ [TEST 7] ${passed ? 'PASSED' : 'FAILED'} — 2 Stop-Loss-uri Consecutive pe GBPJPY (CRO 4D + AI Research 7A/7C):`);
    console.log(`   • Ramura 4D (Drawdown Breaker): VETO=${r4D.veto} (${r4D.vetoReason})`);
    console.log(`   • Ramura 7A (Dead-Market Killer): Blocat=${r7A.data.deadMarketBlocked} pt ${r7A.data.lockoutHours}h (${r7A.vetoReason})`);
    console.log(`   • Ramura 7C (Strategy Switcher): ${r7C.data.previousStrategy} -> ${r7C.data.activeStrategy} (${r7C.data.reason})\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 7, passed: false, error: err.message });
  }

  // ========================================================================================
  // TESTUL 8: Bombardament cu date corupte (null, undefined, NaN, string-uri corupte)
  //           pe toate cele 7 divizii simultan -> SAFE_FALLBACK & CRASHES: 0!
  // ========================================================================================
  try {
    const prevFallbackCount = orchestrator.stateBus.state.diagnostics.fallbackCount;

    // 8A: Injectăm payload-uri corupte (non-array pentru lumânări, NaN pe prețuri, string pe newsEvents)
    orchestrator.stateBus.updateMarketData('XAUUSD', {
      spotBid: NaN,
      spotAsk: undefined,
      spotMid: null,
      spreadPips: NaN,
      h1Candles: 'CORRUPTED_NON_ARRAY_PAYLOAD_THROWING_TYPE_ERROR',
      m15Candles: 999999,
      newsEvents: 'BROKEN_NEWS_OBJECT'
    });

    await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });

    // 8B: Bombardăm direct toți cei 300 de agenți cu un exercițiu de excepție în paralel
    let safeFallbackResponses = 0;
    for (const agent of orchestrator.fleet.allAgents) {
      const res = await agent.execute({ symbol: 'XAUUSD' });
      if (res && (res.status === 'SAFE_FALLBACK' || res.status === 'OK')) {
        safeFallbackResponses += 1;
      }
    }

    const totalFallbacksCaught = orchestrator.stateBus.state.diagnostics.fallbackCount - prevFallbackCount;
    const passed =
      unhandledCrashes === 0 &&
      safeFallbackResponses === 300 &&
      totalFallbacksCaught > 0;

    results.push({ testId: 8, name: 'Corrupted Data Chaos Bombardment on 300 Agents (Zero-Crash Shield)', passed });
    console.log(`✅ [TEST 8] ${passed ? 'PASSED' : 'FAILED'} — Bombardament cu Date Corupte pe toți cei 300 de Agenți:`);
    console.log(`   • Agenți testați sub haos: ${safeFallbackResponses}/300 au răspuns controlat (fără oprirea execuției)`);
    console.log(`   • Excepții prinse în scutul SAFE_FALLBACK (fallbackErrors): ${totalFallbacksCaught}`);
    console.log(`   • CRASHES APLICAȚIE: ${unhandledCrashes}\n`);
  } catch (err) {
    unhandledCrashes += 1;
    results.push({ testId: 8, passed: false, error: err.message });
  }

  const passedCount = results.filter(r => r.passed).length;
  console.log('========================================================================================');
  console.log(`🏆 REZULTAT FINAL STRESS-TEST SUITE: ${passedCount}/${results.length} TESTE TRECUTE | CRASHES: ${unhandledCrashes}`);
  console.log('========================================================================================');
}

if (require.main === module) {
  runStressTestSuite().catch((err) => {
    console.error('Unhandled suite error:', err);
    process.exit(1);
  });
}

module.exports = { runStressTestSuite, buildInstitutionalEurUsdShortDataset };
