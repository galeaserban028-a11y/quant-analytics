var TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';
var CHAT_ID = '5631189371';

// 1. FUNCTIA PRINCIPALA (selectata automat de Google)
function scanMarkets() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('YAHOO_ENGINE_V2')) {
      sendTelegramMessage("✅ <b>SNIPER BOT REPARAT ȘI CONECTAT 24/7!</b>\n\n🟢 Am eliminat blocajul Binance SUA și am trecut totul pe <b>Yahoo Finance US Engine</b>:\n• <b>BTCUSD</b> (Long & Short)\n• <b>SOLUSD</b> (Long & Short)\n• <b>XAUUSD / Aur</b> (Reversal)\n\n<i>Dacă citești acest mesaj pe telefon, legătura cu Google funcționează 100%!</i>");
      props.setProperty('YAHOO_ENGINE_V2', 'true');
    }
  } catch (e) {
    Logger.log("Eroare init: " + e);
  }

  scanYahooAsset('BTC-USD', 'BTCUSD', false, -2.2, 1.8);
  scanYahooAsset('SOL-USD', 'SOLUSD', false, -1.8, 1.8);
  scanYahooAsset('GC=F', 'XAUUSD (Aur)', true, -2.8, 99);
}

// 2. REDIRECTIONARE AUTOMATA DACA CEASUL (TRIGGER-UL) E PUS PE sendTelegramMessage
function sendTelegramMessage(text) {
  if (typeof text !== 'string') {
    scanMarkets();
    return;
  }
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage?chat_id=' + CHAT_ID + '&text=' + encodeURIComponent(text) + '&parse_mode=HTML';
  UrlFetchApp.fetch(url);
}

function getSMA(data, period, index) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += data[index - i].c;
  return sum / period;
}
function getStdDev(data, period, index, sma) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += Math.pow(data[index - i].c - sma, 2);
  return Math.sqrt(sum / period);
}
function getRSI(data, period, index) {
  var gains = 0, losses = 0;
  for (var i = 0; i < period; i++) {
    var change = data[index - i].c - data[index - i - 1].c;
    if (change > 0) gains += change; else losses -= change;
  }
  var rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
  return 100 - (100 / (1 + rs));
}

function scanYahooAsset(ticker, label, isGold, longZ, shortZ) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=15m&range=5d';
    var response = UrlFetchApp.fetch(url);
    var json = JSON.parse(response.getContentText());
    if (!json.chart || !json.chart.result) return;

    var res0 = json.chart.result[0];
    var q = res0.indicators.quote[0];
    var ts = res0.timestamp;

    var data = [];
    for (var i = 0; i < q.close.length; i++) {
      if (q.close[i] !== null && q.open[i] !== null && q.high[i] !== null && q.low[i] !== null) {
        data.push({ t: String(ts[i]), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
    }

    if (data.length < 60) return;
    var c = data.length - 1;
    var p = data.length - 2;

    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('LAST_' + ticker) === data[c].t) return;

    var sma20 = getSMA(data, 20, p);
    var sma50 = getSMA(data, 50, p);
    var std = getStdDev(data, 20, p, sma20);
    var z = std === 0 ? 0 : (data[p].c - sma20) / std;
    var rsi = getRSI(data, 14, p);

    var isBullRebound = data[c].c > data[c].o && data[c].c > data[p].c;
    var isBearReject = data[c].c < data[c].o && data[c].c < data[p].c;
    var decimals = ticker === 'SOL-USD' ? 2 : 2;

    // CONDITIE LONG (Cumparare)
    if ((isGold ? (z < longZ && rsi < 25) : (sma20 > sma50 && z < longZ && rsi < 32)) && isBullRebound) {
      var entryL = data[c].c;
      var tpL = sma20;
      var rewardL = tpL - entryL;
      if (rewardL > 0) {
        var slL = entryL - rewardL;
        props.setProperty('LAST_' + ticker, data[c].t);
        var msgL = "🚨 <b>" + label + " | Semnal LONG</b> 🚨\n\n" +
                   "📈 <b>Sistem:</b> Revenire pe Trend (RSI: " + rsi.toFixed(1) + " | Z: " + z.toFixed(1) + ")\n" +
                   "Direcție: 🟢 <b>LONG (Buy)</b>\n\n" +
                   "📍 <b>Entry:</b> $" + entryL.toFixed(decimals) + "\n" +
                   "🛑 <b>SL:</b> $" + slL.toFixed(decimals) + "\n" +
                   "🎯 <b>TP:</b> $" + tpL.toFixed(decimals) + "\n\n" +
                   "<i>Yahoo Quant Engine | M15</i>";
        sendTelegramMessage(msgL);
      }
    }
    // CONDITIE SHORT (Vanzare pe scadere)
    else if (!isGold && sma20 < sma50 && z > shortZ && rsi > 67 && isBearReject) {
      var entryS = data[c].c;
      var tpS = sma20;
      var rewardS = entryS - tpS;
      if (rewardS > 0) {
        var slS = entryS + rewardS;
        props.setProperty('LAST_' + ticker, data[c].t);
        var msgS = "🚨 <b>" + label + " | Semnal SHORT</b> 🚨\n\n" +
                   "📉 <b>Sistem:</b> Respingere pe Trend Descendent (RSI: " + rsi.toFixed(1) + " | Z: +" + z.toFixed(1) + ")\n" +
                   "Direcție: 🔴 <b>SHORT (Sell)</b>\n\n" +
                   "📍 <b>Entry:</b> $" + entryS.toFixed(decimals) + "\n" +
                   "🛑 <b>SL:</b> $" + slS.toFixed(decimals) + "\n" +
                   "🎯 <b>TP:</b> $" + tpS.toFixed(decimals) + "\n\n" +
                   "<i>Yahoo Quant Engine | M15</i>";
        sendTelegramMessage(msgS);
      }
    }
  } catch (e) { Logger.log("Eroare " + label + ": " + e); }
}
