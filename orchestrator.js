const fs = require('fs');
const path = require('path');
const https = require('https');

const config = require('./config/agents_config.json');
const MarketStateBus = require('./core/MarketStateBus');
const BaseForexAgent = require('./core/BaseForexAgent');

const { Div1ShieldMacro } = require('./divisions/div1_shield_macro');
const { Div2MultiTF } = require('./divisions/div2_multi_tf');
const { Div3OrderflowSMC } = require('./divisions/div3_orderflow_smc');
const { Div4CroRisk } = require('./divisions/div4_cro_risk');
const { Div5BoardVoting } = require('./divisions/div5_board_voting');
const { Div6ExecutionWatch } = require('./divisions/div6_execution_watch');
const { Div7AiResearchBg } = require('./divisions/div7_ai_research_bg');

/**
 * Încarcă variabilele din .env fără dependențe externe (Zero-Crash)
 */
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (_) {
    // Ignoră erorile de citire .env
  }
}

loadEnvFile();

/**
 * Harta completă a celor 24 de Sub-Ramuri Specializate către funcțiile lor matematice
 */
const BRANCH_HANDLERS = {
  // Divizia 1: Scut & Macro (40 Agenți)
  '1A': Div1ShieldMacro.branch1A_SpotSpreadGuard,
  '1B': Div1ShieldMacro.branch1B_SessionKillzoneFilter,
  '1C': Div1ShieldMacro.branch1C_RedFolderNewsBlocker,
  '1D': Div1ShieldMacro.branch1D_MacroDxyCompass,

  // Divizia 2: Cartografiere Multi-TF (60 Agenți)
  '2A': Div2MultiTF.branch2A_MajorsMTF,
  '2B': Div2MultiTF.branch2B_CrossesMTF,
  '2C': Div2MultiTF.branch2C_GoldMetalsMTF,
  '2D': Div2MultiTF.branch2D_IndicesCryptoMTF,

  // Divizia 3: Institutional Orderflow & SMC (90 Agenți)
  '3A': Div3OrderflowSMC.branch3A_LiquiditySweep,
  '3B': Div3OrderflowSMC.branch3B_OrderBlockValidator,
  '3C': Div3OrderflowSMC.branch3C_FvgSniper,
  '3D': Div3OrderflowSMC.branch3D_WhaleVolumeExplosion,
  '3E': Div3OrderflowSMC.branch3E_PremiumDiscountFibo,

  // Divizia 4: Chief Risk Officer & Risk Management (40 Agenți)
  '4A': Div4CroRisk.branch4A_MarketRiskCalculator,
  '4B': Div4CroRisk.branch4B_AntiChaseFilter,
  '4C': Div4CroRisk.branch4C_CorrelationGuard,
  '4D': Div4CroRisk.branch4D_DailyDrawdownBreaker,

  // Divizia 5: The Board / Consensus & Voting Engine (20 Agenți)
  '5A': Div5BoardVoting.branch5A_ConfluenceAggregator,
  '5B': Div5BoardVoting.branch5B_DevilsAdvocate,
  '5C': Div5BoardVoting.branch5C_SignalPrioritySelector,

  // Divizia 6: Execution & Live Trade Watchdog (25 Agenți)
  '6A': Div6ExecutionWatch.branch6A_TelegramMarketDispatcher,
  '6B': Div6ExecutionWatch.branch6B_BreakEvenWatchdog,
  '6C': Div6ExecutionWatch.branch6C_PanicExitFeedback,

  // Divizia 7: AI Research, Walk-Forward & Anti-Sleep (25 Agenți)
  '7A': Div7AiResearchBg.branch7A_DeadMarketKiller,
  '7B': Div7AiResearchBg.branch7B_WalkForwardTrainer,
  '7C': Div7AiResearchBg.branch7C_StrategySwitcher
};

/**
 * ApexQuantOrchestrator - Coordonează cei 300 de agenți din cele 7 Divizii și 24 Sub-Ramuri
 * exclusiv prin Panoul Central `MarketStateBus`.
 */
class ApexQuantOrchestrator {
  constructor(customConfig = config, snapshotPath = null) {
    this.config = customConfig;
    this.stateBus = new MarketStateBus(this.config, snapshotPath);
    this.fleet = BaseForexAgent.spawnFleet(this.config, this.stateBus, BRANCH_HANDLERS);
  }

  /**
   * Returnează agentul desemnat dintr-o sub-ramură pentru simbolul țintă
   */
  getAgentForBranch(branchId, symbol) {
    const agents = this.fleet.byBranch[branchId] || [];
    if (agents.length === 0) return null;
    const exact = agents.find(a => a.symbol === symbol);
    return exact || agents[0];
  }

  /**
   * Execută o sub-ramură pentru un simbol prin scutul `BaseForexAgent.execute()`
   */
  async runBranch(branchId, symbol, context = {}) {
    const agent = this.getAgentForBranch(branchId, symbol);
    if (!agent) return null;
    return await agent.execute(Object.assign({}, context, { symbol }));
  }

  /**
   * Determină ramura MTF (2A, 2B, 2C, 2D) corespunzătoare categoriei instrumentului
   */
  getMtfBranchForSymbol(symbol) {
    return this.stateBus._getMtfBranchForSymbol(symbol);
  }

  /**
   * Rulează un ciclu complet al tuturor celor 7 Divizii și 24 Sub-Ramuri
   * pe lista de simboluri activă.
   */
  async runCompanyCycle(symbols = Object.keys(this.config.instruments), context = {}) {
    this.stateBus.state.meta.totalCycles += 1;
    this.stateBus.state.meta.lastCycleAt = new Date().toISOString();
    this.stateBus.state.confluenceBoard = {};

    const cycleReport = {
      cycleNumber: this.stateBus.state.meta.totalCycles,
      totalAgentsSpawned: this.fleet.totalSpawned,
      evaluatedSymbols: {},
      dispatchedSignals: []
    };

    // PASUL 1..5 PE FIECARE INSTRUMENT (Diviziile 7, 1, 2, 3, 4 și 5B + 5A)
    for (const symbol of symbols) {
      // Divizia 7: AI Research, Walk-Forward & Dead-Market Killer
      await this.runBranch('7A', symbol, context);
      await this.runBranch('7B', symbol, context);
      await this.runBranch('7C', symbol, context);

      // Divizia 1: Scut & Macro (Spot 0-Delay, Killzone, News, Macro DXY Compass)
      await this.runBranch('1A', symbol, context);
      await this.runBranch('1B', symbol, context);
      await this.runBranch('1C', symbol, context);
      await this.runBranch('1D', symbol, context);

      // Divizia 2: Cartografiere Multi-Timeframe (H1 Trend + M15 BOS/CHoCH)
      const mtfBranch = this.getMtfBranchForSymbol(symbol);
      await this.runBranch(mtfBranch, symbol, context);

      // Divizia 3: Institutional Orderflow & SMC (3A -> 3B, 3C, 3E cu Anti-Inducement + 3D)
      await this.runBranch('3A', symbol, context);
      await this.runBranch('3B', symbol, context);
      await this.runBranch('3C', symbol, context);
      await this.runBranch('3E', symbol, context);
      await this.runBranch('3D', symbol, context);

      // Divizia 4: Chief Risk Officer (4A Market Entry/SL/TP -> 4B Anti-Chase -> 4C Corelație -> 4D Drawdown)
      await this.runBranch('4A', symbol, context);
      await this.runBranch('4B', symbol, context);
      await this.runBranch('4C', symbol, context);
      await this.runBranch('4D', symbol, context);

      // Divizia 5 (Partea 1): 5B Avocatul Diavolului -> 5A Scorul de Confluență (>= 85/100)
      await this.runBranch('5B', symbol, context);
      const r5A = await this.runBranch('5A', symbol, context);

      cycleReport.evaluatedSymbols[symbol] = {
        confluence: r5A ? r5A.data : null,
        riskGeometry: this.stateBus.getBranchReport(symbol, '4A').data,
        antiChase: this.stateBus.getBranchReport(symbol, '4B').data
      };
    }

    // PASUL 6: Divizia 5 (Ramura 5C - Selectarea priorității maxime) + Divizia 6 (Execuție & Watchdog)
    for (const symbol of symbols) {
      await this.runBranch('5C', symbol, context);
      const r6A = await this.runBranch('6A', symbol, context);
      const r6B = await this.runBranch('6B', symbol, context);
      const r6C = await this.runBranch('6C', symbol, context);

      if (r6A && r6A.data && r6A.data.dispatched) {
        cycleReport.dispatchedSignals.push(r6A.data);
      }

      cycleReport.evaluatedSymbols[symbol].execution6A = r6A ? r6A.data : null;
      cycleReport.evaluatedSymbols[symbol].watchdog6B = r6B ? r6B.data : null;
      cycleReport.evaluatedSymbols[symbol].feedback6C = r6C ? r6C.data : null;
    }

    this.stateBus.saveSnapshot();
    return cycleReport;
  }
}

/**
 * Construiește un set determinist de lumânări OHLCV H1 și M15 pentru XAUUSD (Gold Spot)
 * care reproduce o structură instituțională reală:
 * - H1: Trend Bullish (EMA 50 ascendent + structură HH/HL)
 * - M15:
 *   1. Pool de lichiditate (Swing Low la 2648.00)
 *   2. Lumânare de Stop-Hunt / Liquidity Sweep (fitil la 2646.20 sub 2648.00, închidere la 2649.10) -> +25p (3A)
 *   3. Impuls Whale Displacement cu volum 2.4x media + FVG deschis [2649.20 - 2650.80] + BOS peste ultimul Swing High -> +25p (2C) & +15p (3D)
 *   4. Retest live (mitigare la prețul Spot 2650.00) în interiorul Order Block-ului & FVG-ului, în zona de Discount (<50% Fibo) -> +20p (3B+3C+3E)
 */
function buildInstitutionalGoldDataset() {
  const now = Date.now();
  // Setăm ora de referință la 14:30 UTC (în plin New York Killzone & London Overlap)
  const refDate = new Date();
  refDate.setUTCHours(14, 30, 0, 0);
  const referenceTime = refDate.getTime();

  // 1. Generăm 60 lumânări H1 în trend ascendent curat (de la 2610.00 la 2650.00)
  const h1Candles = [];
  for (let i = 0; i < 60; i++) {
    const base = 2610 + i * 0.65;
    const wave = Math.sin(i / 3) * 1.2;
    const open = Number((base + wave).toFixed(2));
    const close = Number((open + 0.55).toFixed(2));
    const high = Number((Math.max(open, close) + 0.90).toFixed(2));
    const low = Number((Math.min(open, close) - 0.60).toFixed(2));
    h1Candles.push({
      timestamp: referenceTime - (60 - i) * 3600 * 1000,
      open,
      high,
      low,
      close,
      volume: 1200 + (i % 7) * 110
    });
  }

  // 2. Generăm 40 lumânări M15 cu structură SMC completă (Swing Range 2646.20 -> 2656.50, Equilibrium = 2651.35)
  const m15Candles = [];
  for (let i = 0; i < 40; i++) {
    let open = 2650.0;
    let high = 2652.0;
    let low = 2648.5;
    let close = 2650.5;
    let volume = 500;

    if (i < 25) {
      // Construim range-ul macro [2648.00 ... 2658.00] (ca Equilibrium 50% pe ultimele 30 lumânări să fie la 2652.10)
      if (i === 12) {
        open = 2655.0; high = 2658.00; low = 2654.20; close = 2657.10; volume = 620;
      } else if (i === 18) {
        open = 2649.50; high = 2650.20; low = 2648.00; close = 2648.80; volume = 540;
      } else {
        open = 2651.0 + (i % 4) * 0.4;
        close = open + 0.25;
        high = close + 0.80;
        low = open - 0.70;
        volume = 480 + (i % 5) * 25;
      }
    } else if (i >= 25 && i <= 33) {
      // Consolidare pre-sweep deasupra 2648.20 cu Swing High M15 intermediar la 2651.20
      open = 2649.40 + ((i % 3) * 0.35);
      close = open + 0.20;
      high = i === 29 ? 2651.20 : close + 0.45;
      low = 2648.35;
      volume = 490;
    } else if (i === 34) {
      // Lumânarea Bearish (Order Block instituțional: [2648.20 - 2649.90])
      open = 2649.85;
      high = 2649.90;
      low = 2648.20;
      close = 2648.30;
      volume = 650;
    } else if (i === 35) {
      // Ramura 3A: STOP-HUNT / LIQUIDITY SWEEP! Fitil la 2646.20 (mătură 2648.00), dar închide la 2649.20
      open = 2648.30;
      high = 2649.40;
      low = 2646.20;
      close = 2649.20;
      volume = 1150;
    } else if (i === 36) {
      // Ramura 3D: WHALE DISPLACEMENT EXPLOSION! (Volum 1450 > 1.8x media 500, corp uriaș 2649.20 -> 2652.10)
      open = 2649.20;
      high = 2652.30;
      low = 2649.15;
      close = 2652.10;
      volume = 1450;
    } else if (i === 37) {
      // Lasă FVG Bullish deschis între lumânarea 35 (high=2649.40) și lumânarea 37 (low=2650.40)
      open = 2652.10;
      high = 2652.60;
      low = 2650.40;
      close = 2651.60;
      volume = 780;
    } else if (i === 38) {
      // Pullback controlat spre zona de mitigare (Order Block + FVG în Discount < 2651.35)
      open = 2651.60;
      high = 2651.70;
      low = 2649.85;
      close = 2649.95;
      volume = 520;
    } else if (i === 39) {
      // Lumânarea curentă M15: Rejecție bullish exact din zona Order Block / FVG la 2650.10!
      open = 2649.95;
      high = 2650.35;
      low = 2649.55;
      close = 2650.10;
      volume = 920;
    }

    m15Candles.push({
      timestamp: referenceTime - (40 - i) * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume
    });
  }

  return {
    symbol: 'XAUUSD',
    spotBid: 2650.00,
    spotAsk: 2650.20,
    spotMid: 2650.10,
    spreadPips: 2.0, // Sub limita de 3.0 pips pt XAUUSD
    spotTimestamp: now,
    referenceTime,
    dxyBias: 'BEARISH_USD', // Susține XAUUSD LONG (+15p în 1D)
    newsEvents: [], // Fără știri Red-Folder în +/- 30m
    h1Candles,
    m15Candles
  };
}

/**
 * TEST END-TO-END COMPLET (PASUL 2)
 */
async function runEndToEndVerification() {
  console.log('================================================================================');
  console.log('🏛️  APEX QUANT 300-AGENT INSTITUTIONAL DESK — END-TO-END VERIFICATION (PASUL 2)');
  console.log('================================================================================');

  const orchestrator = new ApexQuantOrchestrator();
  // Resetăm eventualele trade-uri din rulări anterioare pentru un test curat
  orchestrator.stateBus.state.activeTrades = {};
  orchestrator.stateBus.state.riskLedger.slCountBySymbol = {};

  console.log(`[1] Flota inițializată: ${orchestrator.fleet.totalSpawned} Agenți activi în ${Object.keys(orchestrator.fleet.byDivision).length} Divizii și ${Object.keys(orchestrator.fleet.byBranch).length} Sub-Ramuri.`);

  // 2. Alimentăm Panoul Central (MarketStateBus) cu datele XAUUSD 0-Delay
  const goldData = buildInstitutionalGoldDataset();
  orchestrator.stateBus.updateMarketData('XAUUSD', goldData);

  // 3. Rulăm ciclul complet al celor 7 Divizii pe XAUUSD
  const cycleResult = await orchestrator.runCompanyCycle(['XAUUSD'], { sendLiveTelegram: false });
  const xauEval = cycleResult.evaluatedSymbols['XAUUSD'];

  console.log('\n[2] REZULTAT CONFLUENȚĂ DIVIZIA 5 (THE BOARD):');
  console.log(JSON.stringify(xauEval.confluence, null, 2));

  console.log('\n[3] GEOMETRIE RISC DIVIZIA 4 (RAMURA 4A - MARKET EXECUTION & 4B - ANTI-CHASE):');
  console.log(JSON.stringify({
    risk4A: xauEval.riskGeometry,
    antiChase4B: xauEval.antiChase
  }, null, 2));

  if (cycleResult.dispatchedSignals.length > 0) {
    console.log('\n[4] SEMNAL MARKET EXECUTION GENERAT DE DIVIZIA 6 (RAMURA 6A):');
    console.log('--------------------------------------------------------------------------------');
    console.log(cycleResult.dispatchedSignals[0].telegramMessage);
    console.log('--------------------------------------------------------------------------------');
  }

  // 4. Testăm Watchdog-ul 6B la atingerea TP1 (mutare automată SL la Break-Even)
  const activeTrade = orchestrator.stateBus.getActiveTrade('XAUUSD');
  if (activeTrade) {
    orchestrator.stateBus.updateMarketData('XAUUSD', {
      spotBid: activeTrade.tp1,
      spotAsk: activeTrade.tp1 + 0.20,
      spotMid: activeTrade.tp1 + 0.10,
      spotTimestamp: Date.now()
    });
    const watchdogReport = await orchestrator.runBranch('6B', 'XAUUSD');
    console.log('\n[5] TEST WATCHDOG 6B (SIMULARE ATINGERE TP1 -> BREAK-EVEN):');
    console.log(JSON.stringify(watchdogReport.data, null, 2));
  }

  // 5. Testăm Scutul Corelație Valutară 4C (EURUSD este blocat dacă avem deja expunere pe USD prin XAUUSD)
  const corrReport = await orchestrator.runBranch('4C', 'EURUSD');
  console.log('\n[6] TEST SCUT CORELAȚIE VALUTARĂ 4C (BLOCARE EXPUNERE DUBLĂ PE USD):');
  console.log(JSON.stringify({
    veto: corrReport.veto,
    vetoReason: corrReport.vetoReason
  }, null, 2));

  // 6. Testăm Filtrul Anti-Chase 4B (Dacă prețul Spot a plecat deja > 15% spre TP1 -> VETO INSTANT!)
  orchestrator.stateBus.updateMarketData('XAUUSD', {
    spotBid: 2651.90,
    spotAsk: 2652.10,
    spotMid: 2652.00,
    spotTimestamp: Date.now()
  });
  const antiChaseVetoReport = await orchestrator.runBranch('4B', 'XAUUSD');
  console.log('\n[7] TEST FILTRU ANTI-CHASE 4B (PREȚ PLECAT > 15% SPRE TP1 -> VETO INSTANT):');
  console.log(JSON.stringify({
    veto: antiChaseVetoReport.veto,
    vetoReason: antiChaseVetoReport.vetoReason,
    chasePct: Number((antiChaseVetoReport.data.chaseRatio * 100).toFixed(1)) + '%'
  }, null, 2));

  console.log('\n[8] DIAGNOSTIC ZERO-CRASH & SNAPSHOT PERSISTENCE:');
  console.log(JSON.stringify({
    fallbackErrors: orchestrator.stateBus.state.diagnostics.fallbackCount,
    snapshotSavedAt: orchestrator.stateBus.snapshotPath
  }, null, 2));
  console.log('================================================================================');
}

if (require.main === module) {
  runEndToEndVerification().catch((err) => {
    console.error('Fatal orchestrator error:', err);
  });
}

module.exports = { ApexQuantOrchestrator, BRANCH_HANDLERS, buildInstitutionalGoldDataset };
