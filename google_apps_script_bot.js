var TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';
var CHAT_ID = '5631189371';

function getLiveSpotGold() {
  try {
    var sq = UrlFetchApp.fetch('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD');
    var j = JSON.parse(sq.getContentText());
    var p = j[0].spreadProfilePrices[0];
    return (p.bid + p.ask) / 2;
  } catch (e) {
    return null;
  }
}

function getLiveSpotCrypto(pair) {
  try {
    var cb = UrlFetchApp.fetch('https://api.exchange.coinbase.com/products/' + pair + '/ticker');
    var j = JSON.parse(cb.getContentText());
    return parseFloat(j.price);
  } catch (e) {
    return null;
  }
}

// 1. FUNCTIA PRINCIPALA (selectata automat de Google)
function scanMarkets() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SPOT_CALIBRATED_V3')) {
      var spotGold = getLiveSpotGold();
      var spotBtc = getLiveSpotCrypto('BTC-USD');
      sendTelegramMessage(
        "✅ <b>CALIBRARE SPOT ACTIVATĂ (0 DIFERENȚĂ FAȚĂ DE BROKER)!</b>\n\n" +
        "🎯 Am eliminat diferența de +$22 dintre Futures și Spot:\n" +
        "• <b>XAUUSD Spot Real:</b> $" + (spotGold ? spotGold.toFixed(2) : "Live") + "\n" +
        "• <b>BTCUSD Spot Real:</b> $" + (spotBtc ? spotBtc.toFixed(2) : "Live") + "\n\n" +
        "<i>Toate prețurile de Entry, SL și TP sunt acum sincronizate la dolar cu graficul tău!</i>"
      );
      props.setProperty('SPOT_CALIBRATED_V3', 'true');
    }
  } catch (e) {
    Logger.log("Eroare init: " + e);
  }

  scanYahooAsset('BTC-USD', 'BTCUSD', false, -2.2, 1.8);
  scanYahooAsset('SOL-USD', 'SOLUSD', false, -1.8, 1.8);
  scanYahooAsset('GC=F', 'XAUUSD (Aur)', true, -1.2, 99);
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
        // Ignoram ultimul tick sintetic de 1 secunda adaugat de Yahoo unde O==H==L==C
        if (i === q.close.length - 1 && q.open[i] === q.close[i] && q.high[i] === q.low[i]) continue;
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

    // Calculam offset-ul fata de pretul SPOT REAL de pe broker (Swissquote pentru Aur, Coinbase pentru Crypto)
    var liveSpot = isGold ? getLiveSpotGold() : getLiveSpotCrypto(ticker);
    var offset = (liveSpot !== null) ? (liveSpot - data[c].c) : 0;

    var isBullRebound = data[c].c > data[c].o && data[c].c > data[p].c;
    var isBearReject = data[c].c < data[c].o && data[c].c < data[p].c;

    // CONDITIE LONG (Cumparare)
    if ((isGold ? (z < longZ && rsi < 25) : (sma20 > sma50 && z < longZ && rsi < 32)) && isBullRebound) {
      var rewardL = sma20 - data[c].c;
      if (rewardL > (isGold ? 4 : 0)) {
        var entryL = data[c].c + offset;
        var tpL = sma20 + offset;
        var slL = entryL - (rewardL / 1.5);
        props.setProperty('LAST_' + ticker, data[c].t);
        var msgL = "🚨 <b>" + label + " | Semnal LONG (Spot)</b> 🚨\n\n" +
                   "📈 <b>Sistem:</b> Revenire (RSI: " + rsi.toFixed(1) + " | Z: " + z.toFixed(1) + ")\n" +
                   "Direcție: 🟢 <b>LONG (Buy)</b>\n\n" +
                   "📍 <b>Entry (Spot):</b> $" + entryL.toFixed(2) + "\n" +
                   "🛑 <b>SL:</b> $" + slL.toFixed(2) + "\n" +
                   "🎯 <b>TP (SMA20):</b> $" + tpL.toFixed(2) + "\n\n" +
                   "<i>Spot Calibrated | M15</i>";
        sendTelegramMessage(msgL);
      }
    }
    // CONDITIE SHORT (Vanzare pe scadere)
    else if (!isGold && sma20 < sma50 && z > shortZ && rsi > 67 && isBearReject) {
      var rewardS = data[c].c - sma20;
      if (rewardS > 0) {
        var entryS = data[c].c + offset;
        var tpS = sma20 + offset;
        var slS = entryS + (rewardS / 1.5);
        props.setProperty('LAST_' + ticker, data[c].t);
        var msgS = "🚨 <b>" + label + " | Semnal SHORT (Spot)</b> 🚨\n\n" +
                   "📉 <b>Sistem:</b> Respingere pe Trend Descendent (RSI: " + rsi.toFixed(1) + " | Z: +" + z.toFixed(1) + ")\n" +
                   "Direcție: 🔴 <b>SHORT (Sell)</b>\n\n" +
                   "📍 <b>Entry (Spot):</b> $" + entryS.toFixed(2) + "\n" +
                   "🛑 <b>SL:</b> $" + slS.toFixed(2) + "\n" +
                   "🎯 <b>TP (SMA20):</b> $" + tpS.toFixed(2) + "\n\n" +
                   "<i>Spot Calibrated | M15</i>";
        sendTelegramMessage(msgS);
      }
    }
  } catch (e) { Logger.log("Eroare " + label + ": " + e); }
}
