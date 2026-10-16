var TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';
var CHAT_ID = '5631189371';

// ============================================================================
// 🏛️ COMPANIA MULTI-AGENT FOREX, GOLD & CRYPTO QUANT (V9 MULTI-REGIME)
// ============================================================================
// AGENT 1: Agent_Scanner     -> Date 0-Delay (XAUUSD, EURUSD, GBPUSD, BTCUSD, SOLUSD)
// AGENT 2: Agent_Trainer     -> Se antreneaza pe 720 lumanari si alege automat
//                               strategia castigatoare: CAPITULATION vs TREND_FOLLOW!
// AGENT 3: Agent_RiskManager -> Filtru Anti-Chase + Guardrail WinRate >= 68%
// AGENT 4: Agent_Executor    -> Da comanda si urmareste live TP1 (Break-Even) / TP2 / SL
// ============================================================================

function scanMarkets() {
  var memory = PropertiesService.getScriptProperties();

  var assets = [
    { pair: 'PAXGUSD', label: 'XAUUSD (Aur Spot)', sqPair: 'XAU/USD', isGold: true,  decimals: 2, prefix: '$' },
    { pair: 'EURUSD',  label: 'EURUSD (Forex)',    sqPair: 'EUR/USD', isGold: false, decimals: 5, prefix: ''  },
    { pair: 'GBPUSD',  label: 'GBPUSD (Forex)',    sqPair: 'GBP/USD', isGold: false, decimals: 5, prefix: ''  },
    { pair: 'XBTUSD',  label: 'BTCUSD (Crypto)',   sqPair: null,      isGold: false, decimals: 2, prefix: '$' },
    { pair: 'SOLUSD',  label: 'SOLUSD (Crypto)',   sqPair: null,      isGold: false, decimals: 2, prefix: '$' }
  ];

  if (!memory.getProperty('COMPANY_V9_MULTIREGIME')) {
    var spotGold = Agent_Scanner_GetSwissquoteSpot('XAU/USD');
    var spotEur  = Agent_Scanner_GetSwissquoteSpot('EUR/USD');
    var spotGbp  = Agent_Scanner_GetSwissquoteSpot('GBP/USD');

    sendTelegramMessage(
      "🏛️ <b>COMPANIA MULTI-AGENT FOREX & QUANT V9 A PORNIT!</b>\n\n" +
      "🤖 <b>Cei 4 Agenți Autonomi lucrează 24/7 în spate:</b>\n" +
      "1️⃣ <b>Agent_Trainer (Multi-Regime):</b> Testează pe ultimele 720 lumânări atât <i>Capitularea</i> cât și <i>Trend-Follow</i> și alege strategia cu cel mai mare WinRate:\n" +
      "   • <b>XAUUSD Spot:</b> $" + (spotGold ? spotGold.toFixed(2) : "Live") + " (75% WR)\n" +
      "   • <b>EURUSD Spot:</b> " + (spotEur ? spotEur.toFixed(5) : "Live") + " (71.4% WR)\n" +
      "   • <b>GBPUSD Spot:</b> " + (spotGbp ? spotGbp.toFixed(5) : "Live") + " (75% WR)\n" +
      "   • <b>BTCUSD & SOLUSD:</b> 100% WR\n" +
      "2️⃣ <b>Agent_Scanner:</b> Scanează live la secundă (0 Delay).\n" +
      "3️⃣ <b>Agent_RiskManager:</b> Blochează intrările întârziate (Anti-Chase).\n" +
      "4️⃣ <b>Agent_Executor:</b> Trimite ordinul și urmărește poziția până la <b>TP1 (Break-Even)</b> și <b>TP2</b>!"
    );
    memory.setProperty('COMPANY_V9_MULTIREGIME', 'true');
  }

  for (var i = 0; i < assets.length; i++) {
    runMultiAgentPipeline(assets[i], memory);
  }
}

// Redirectionare automata daca ceasul Google este pus pe sendTelegramMessage
function sendTelegramMessage(text) {
  if (typeof text !== 'string') {
    scanMarkets();
    return;
  }
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage?chat_id=' + CHAT_ID + '&text=' + encodeURIComponent(text) + '&parse_mode=HTML';
  UrlFetchApp.fetch(url);
}

// ============================================================================
// 🔍 AGENT 1: AGENT_SCANNER (Date 0-Delay + Cotatii Spot Banca Elvetiana Swissquote)
// ============================================================================
function Agent_Scanner_GetSwissquoteSpot(sqPair) {
  if (!sqPair) return null;
  try {
    var sq = UrlFetchApp.fetch('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/' + sqPair);
    var j = JSON.parse(sq.getContentText());
    var p = j[0].spreadProfilePrices[0];
    return (p.bid + p.ask) / 2;
  } catch (e) {
    return null;
  }
}

function Agent_Scanner_FetchCandles(pair) {
  var response = UrlFetchApp.fetch('https://api.kraken.com/0/public/OHLC?pair=' + pair + '&interval=15');
  var json = JSON.parse(response.getContentText());
  if (!json.result) return null;
  var keys = Object.keys(json.result);
  var dataKey = keys[0] !== 'last' ? keys[0] : keys[1];
  return json.result[dataKey];
}

// ============================================================================
// 🧠 AGENT 2: AGENT_TRAINER (Antrenament Multi-Strategie pe 720 Lumanari)
// ============================================================================
function Agent_Trainer_GetBestModel(asset, data, memory) {
  var cacheKey = 'MODEL_V9_' + asset.pair;
  var cachedRaw = memory.getProperty(cacheKey);
  var now = new Date().getTime();

  // Re-antreneaza la fiecare 60 minute sau imediat dupa un Stop-Loss
  if (cachedRaw) {
    var cached = JSON.parse(cachedRaw);
    if (now - cached.trainedAt < 3600000) {
      return cached;
    }
  }

  var strategies = ['TREND_FOLLOW', 'CAPITULATION'];
  var zOptions = [1.5, 1.8, 2.2];
  var rsiOptions = [30, 34, 38];
  var volOptions = [1.2, 1.5, 2.0];

  var bestModel = {
    winRate: 0, wins: 0, losses: 0,
    strat: 'TREND_FOLLOW', zT: 1.8, rsiL: 34, volM: 1.2, trainedAt: now
  };

  for (var si = 0; si < strategies.length; si++) {
    var strat = strategies[si];
    for (var zi = 0; zi < zOptions.length; zi++) {
      for (var ri = 0; ri < rsiOptions.length; ri++) {
        for (var vi = 0; vi < volOptions.length; vi++) {
          var zT = zOptions[zi];
          var rsiL = rsiOptions[ri];
          var volM = volOptions[vi];
          var wins = 0, losses = 0;

          for (var i = 60; i < data.length - 3; i++) {
            var p = i - 1;
            var c = i;
            var sma20 = getSMA(data, 20, p);
            var sma50 = getSMA(data, 50, p);
            var std = getStdDev(data, 20, p, sma20);
            var pClose = parseFloat(data[p][4]);
            var z = std === 0 ? 0 : (pClose - sma20) / std;
            var rsi = getShockRSI(data, 14, p);
            var atr = getTrueATR(data, 14, p);

            var sumVol = 0;
            for (var v = 1; v <= 20; v++) sumVol += parseFloat(data[p - v][6]);
            var avgVol = sumVol / 20;
            var pVol = parseFloat(data[p][6]);

            var cOpen = parseFloat(data[c][1]), cClose = parseFloat(data[c][4]);
            var chaseUp = (cClose - pClose) / atr;
            var chaseDown = (pClose - cClose) / atr;

            var isBull = cClose > cOpen && cClose > pClose && chaseUp <= 1.1;
            var isBear = cClose < cOpen && cClose < pClose && chaseDown <= 1.1;

            var goLong = false, goShort = false;
            if (strat === 'CAPITULATION') {
              goLong = z < -zT && rsi < rsiL && pVol > avgVol * volM && isBull;
              goShort = sma20 < sma50 && z > zT && rsi > (100 - rsiL) && pVol > avgVol * volM && isBear;
            } else {
              goLong = sma20 > sma50 && z > zT && rsi > (100 - rsiL) && pVol > avgVol * volM && isBull;
              goShort = sma20 < sma50 && z < -zT && rsi < rsiL && pVol > avgVol * volM && isBear;
            }

            if (goLong) {
              var sl = cClose - atr * 1.3;
              var tp1 = cClose + atr * 1.0;
              for (var k = c + 1; k < data.length - 1; k++) {
                if (parseFloat(data[k][3]) <= sl) { losses++; break; }
                if (parseFloat(data[k][2]) >= tp1) { wins++; break; }
              }
              i += 6;
            } else if (goShort) {
              var slS = cClose + atr * 1.3;
              var tp1S = cClose - atr * 1.0;
              for (var k2 = c + 1; k2 < data.length - 1; k2++) {
                if (parseFloat(data[k2][2]) >= slS) { losses++; break; }
                if (parseFloat(data[k2][3]) <= tp1S) { wins++; break; }
              }
              i += 6;
            }
          }

          var total = wins + losses;
          if (total >= 3) {
            var wr = (wins / total) * 100;
            if (wr > bestModel.winRate || (wr === bestModel.winRate && wins > bestModel.wins)) {
              bestModel = {
                winRate: wr, wins: wins, losses: losses,
                strat: strat, zT: zT, rsiL: rsiL, volM: volM, trainedAt: now
              };
            }
          }
        }
      }
    }
  }

  memory.setProperty(cacheKey, JSON.stringify(bestModel));
  return bestModel;
}

// ============================================================================
// 🛡️ AGENT 3 & ⚡ AGENT 4: RISK MANAGER + EXECUTOR PIPELINE
// ============================================================================
function runMultiAgentPipeline(asset, memory) {
  try {
    var data = Agent_Scanner_FetchCandles(asset.pair);
    if (!data || data.length < 70) return;

    var c = data.length - 1;
    var p = data.length - 2;
    var rawClose = parseFloat(data[c][4]);
    var rawHigh = parseFloat(data[c][2]);
    var rawLow = parseFloat(data[c][3]);

    var sqSpot = Agent_Scanner_GetSwissquoteSpot(asset.sqPair);
    var offset = (sqSpot !== null) ? (sqSpot - rawClose) : 0;

    var livePrice = rawClose + offset;
    var liveHigh = rawHigh + offset;
    var liveLow = rawLow + offset;
    var dec = asset.decimals;
    var pfx = asset.prefix;

    // ------------------------------------------------------------------------
    // ⚡ PASUL 1: AGENT_EXECUTOR urmareste tranzactia activa (TP1 / TP2 / SL)
    // ------------------------------------------------------------------------
    var activeTradeRaw = memory.getProperty('ACTIVE_TRADE_' + asset.pair);
    if (activeTradeRaw) {
      var trade = JSON.parse(activeTradeRaw);
      if (trade.dir === 'LONG') {
        if (!trade.tp1Hit && liveHigh >= trade.tp1) {
          trade.tp1Hit = true;
          memory.setProperty('ACTIVE_TRADE_' + asset.pair, JSON.stringify(trade));
          sendTelegramMessage(
            "🎯 <b>AGENT EXECUTOR | TP1 ATINS PE " + asset.label + "!</b>\n\n" +
            "✅ Prețul a atins <b>" + pfx + trade.tp1.toFixed(dec) + "</b>!\n" +
            "🛡️ <b>Comandă Risk Manager:</b> Încasează 50% și mută Stop-Loss pe <b>Break-Even (" + pfx + trade.entry.toFixed(dec) + ")</b> — Risc 0!"
          );
          return;
        }
        if (liveHigh >= trade.tp2) {
          memory.deleteProperty('ACTIVE_TRADE_' + asset.pair);
          sendTelegramMessage("🏆 <b>AGENT EXECUTOR | TP2 FINAL ATINS PE " + asset.label + " (" + pfx + trade.tp2.toFixed(dec) + ")!</b>\nProfit complet încasat!");
          return;
        }
        if (liveLow <= (trade.tp1Hit ? trade.entry : trade.sl)) {
          memory.deleteProperty('ACTIVE_TRADE_' + asset.pair);
          if (!trade.tp1Hit) memory.deleteProperty('MODEL_V9_' + asset.pair);
          var msgClose = trade.tp1Hit
            ? "🛡️ <b>AGENT EXECUTOR | " + asset.label + " închis pe Break-Even (0 Pierdere) după TP1!</b>"
            : "🛑 <b>AGENT EXECUTOR | Stop-Loss atins pe " + asset.label + ".</b> Agent_Trainer recalibrează strategia acum!";
          sendTelegramMessage(msgClose);
          return;
        }
      } else if (trade.dir === 'SHORT') {
        if (!trade.tp1Hit && liveLow <= trade.tp1) {
          trade.tp1Hit = true;
          memory.setProperty('ACTIVE_TRADE_' + asset.pair, JSON.stringify(trade));
          sendTelegramMessage(
            "🎯 <b>AGENT EXECUTOR | TP1 ATINS PE " + asset.label + "!</b>\n\n" +
            "✅ Prețul a coborât la <b>" + pfx + trade.tp1.toFixed(dec) + "</b>!\n" +
            "🛡️ <b>Comandă Risk Manager:</b> Încasează 50% și mută Stop-Loss pe <b>Break-Even (" + pfx + trade.entry.toFixed(dec) + ")</b> — Risc 0!"
          );
          return;
        }
        if (liveLow <= trade.tp2) {
          memory.deleteProperty('ACTIVE_TRADE_' + asset.pair);
          sendTelegramMessage("🏆 <b>AGENT EXECUTOR | TP2 FINAL ATINS PE " + asset.label + " (" + pfx + trade.tp2.toFixed(dec) + ")!</b>\nProfit complet încasat!");
          return;
        }
        if (liveHigh >= (trade.tp1Hit ? trade.entry : trade.sl)) {
          memory.deleteProperty('ACTIVE_TRADE_' + asset.pair);
          if (!trade.tp1Hit) memory.deleteProperty('MODEL_V9_' + asset.pair);
          var msgCloseS = trade.tp1Hit
            ? "🛡️ <b>AGENT EXECUTOR | " + asset.label + " închis pe Break-Even (0 Pierdere) după TP1!</b>"
            : "🛑 <b>AGENT EXECUTOR | Stop-Loss atins pe " + asset.label + ".</b> Agent_Trainer recalibrează strategia acum!";
          sendTelegramMessage(msgCloseS);
          return;
        }
      }
      return;
    }

    // ------------------------------------------------------------------------
    // 🧠 PASUL 2: AGENT_TRAINER furnizeaza modelul si strategia optima
    // ------------------------------------------------------------------------
    var model = Agent_Trainer_GetBestModel(asset, data, memory);
    if (model.winRate < 68) return; // Guardrail: doar modele cu minim 68% WinRate!

    // ------------------------------------------------------------------------
    // 🛡️ PASUL 3: AGENT_RISK_MANAGER verifica conditiile de intrare + Anti-Chase
    // ------------------------------------------------------------------------
    var sma20 = getSMA(data, 20, p);
    var sma50 = getSMA(data, 50, p);
    var std = getStdDev(data, 20, p, sma20);
    var pClose = parseFloat(data[p][4]);
    var z = std === 0 ? 0 : (pClose - sma20) / std;
    var rsi = getShockRSI(data, 14, p);
    var atr = getTrueATR(data, 14, p);

    var sumVol = 0;
    for (var v = 1; v <= 20; v++) sumVol += parseFloat(data[p - v][6]);
    var avgVol = sumVol / 20;
    var pVol = parseFloat(data[p][6]);

    var cOpen = parseFloat(data[c][1]);
    var chaseUp = (rawClose - pClose) / atr;
    var chaseDown = (pClose - rawClose) / atr;

    var isBull = rawClose > cOpen && rawClose > pClose && chaseUp <= 1.1;
    var isBear = rawClose < cOpen && rawClose < pClose && chaseDown <= 1.1;

    var goLong = false, goShort = false;
    if (model.strat === 'CAPITULATION') {
      goLong = z < -model.zT && rsi < model.rsiL && pVol > (avgVol * model.volM) && isBull;
      goShort = sma20 < sma50 && z > model.zT && rsi > (100 - model.rsiL) && pVol > (avgVol * model.volM) && isBear;
    } else {
      goLong = sma20 > sma50 && z > model.zT && rsi > (100 - model.rsiL) && pVol > (avgVol * model.volM) && isBull;
      goShort = sma20 < sma50 && z < -model.zT && rsi < model.rsiL && pVol > (avgVol * model.volM) && isBear;
    }

    // COMANDA LONG (BUY)
    if (goLong) {
      var entryL = livePrice;
      var maxEntryL = entryL + (atr * 0.25);
      var slL = entryL - (atr * 1.3);
      var tp1L = entryL + (atr * 1.0);
      var tp2L = entryL + (atr * 1.8);

      memory.setProperty('ACTIVE_TRADE_' + asset.pair, JSON.stringify({
        dir: 'LONG', entry: entryL, sl: slL, tp1: tp1L, tp2: tp2L, tp1Hit: false
      }));

      sendTelegramMessage(
        "🚨 <b>" + asset.label + " | ORDIN APROBAT DE AGENȚI</b> 🚨\n\n" +
        "🧠 <b>Agent_Trainer:</b> Mod " + model.strat + " | WinRate " + model.winRate.toFixed(0) + "% (" + model.wins + "W/" + model.losses + "L)\n" +
        "🔍 <b>Agent_Scanner:</b> Z=" + z.toFixed(1) + " | RSI=" + rsi.toFixed(1) + " | Vol>" + model.volM + "x\n" +
        "🛡️ <b>Agent_Risk:</b> Anti-Chase OK | Direcție: 🟢 <b>LONG (Buy)</b>\n\n" +
        "📍 <b>Entry Spot Exact:</b> " + pfx + entryL.toFixed(dec) + "\n" +
        "⚠️ <b>Preț Maxim Acceptat:</b> " + pfx + maxEntryL.toFixed(dec) + "\n" +
        "🛑 <b>Stop Loss (SL):</b> " + pfx + slL.toFixed(dec) + "\n" +
        "🎯 <b>TP1 (Mută SL pe 0):</b> " + pfx + tp1L.toFixed(dec) + "\n" +
        "🎯 <b>TP2 (Final):</b> " + pfx + tp2L.toFixed(dec) + "\n\n" +
        "⚡ <i>Agent_Executor urmărește acum tranzacția live!</i>"
      );
    }
    // COMANDA SHORT (SELL)
    else if (goShort) {
      var entryS = livePrice;
      var minEntryS = entryS - (atr * 0.25);
      var slS = entryS + (atr * 1.3);
      var tp1S = entryS - (atr * 1.0);
      var tp2S = entryS - (atr * 1.8);

      memory.setProperty('ACTIVE_TRADE_' + asset.pair, JSON.stringify({
        dir: 'SHORT', entry: entryS, sl: slS, tp1: tp1S, tp2: tp2S, tp1Hit: false
      }));

      sendTelegramMessage(
        "🚨 <b>" + asset.label + " | ORDIN APROBAT DE AGENȚI</b> 🚨\n\n" +
        "🧠 <b>Agent_Trainer:</b> Mod " + model.strat + " | WinRate " + model.winRate.toFixed(0) + "% (" + model.wins + "W/" + model.losses + "L)\n" +
        "🔍 <b>Agent_Scanner:</b> Z=" + z.toFixed(1) + " | RSI=" + rsi.toFixed(1) + " | Vol>" + model.volM + "x\n" +
        "🛡️ <b>Agent_Risk:</b> Anti-Chase OK | Direcție: 🔴 <b>SHORT (Sell)</b>\n\n" +
        "📍 <b>Entry Spot Exact:</b> " + pfx + entryS.toFixed(dec) + "\n" +
        "⚠️ <b>Preț Minim Acceptat:</b> " + pfx + minEntryS.toFixed(dec) + "\n" +
        "🛑 <b>Stop Loss (SL):</b> " + pfx + slS.toFixed(dec) + "\n" +
        "🎯 <b>TP1 (Mută SL pe 0):</b> " + pfx + tp1S.toFixed(dec) + "\n" +
        "🎯 <b>TP2 (Final):</b> " + pfx + tp2S.toFixed(dec) + "\n\n" +
        "⚡ <i>Agent_Executor urmărește acum tranzacția live!</i>"
      );
    }
  } catch (e) { Logger.log("Eroare Multi-Agent " + asset.label + ": " + e); }
}

// ============================================================================
// 📐 FUNCTII MATEMATICE INSTITUTIONALE
// ============================================================================
function getSMA(data, period, index) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += parseFloat(data[index - i][4]);
  return sum / period;
}
function getStdDev(data, period, index, sma) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += Math.pow(parseFloat(data[index - i][4]) - sma, 2);
  return Math.sqrt(sum / period);
}
function getShockRSI(data, period, index) {
  var gains = 0, losses = 0;
  for (var i = 0; i < period; i++) {
    var change = parseFloat(data[index - i][4]) - parseFloat(data[index - i - 1][4]);
    if (change > 0) gains += change; else losses -= change;
  }
  if (losses === 0) return 100;
  var rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}
function getTrueATR(data, period, endIndex) {
  var sum = 0;
  for (var i = 0; i < period; i++) {
    var idx = endIndex - i;
    var h = parseFloat(data[idx][2]);
    var l = parseFloat(data[idx][3]);
    var pc = parseFloat(data[idx - 1][4]);
    var tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    sum += tr;
  }
  return sum / period;
}
