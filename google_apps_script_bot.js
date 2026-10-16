var TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';
var CHAT_ID = '5631189371';

function sendTelegramMessage(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage?chat_id=' + CHAT_ID + '&text=' + encodeURIComponent(text) + '&parse_mode=HTML';
  UrlFetchApp.fetch(url);
}

function getSMA(data, period, index, priceType) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += parseFloat(data[index - i][priceType]);
  return sum / period;
}
function getStdDev(data, period, index, sma, priceType) {
  var sum = 0;
  for (var i = 0; i < period; i++) sum += Math.pow(parseFloat(data[index - i][priceType]) - sma, 2);
  return Math.sqrt(sum / period);
}
function getRSI(data, period, index, priceType) {
  var gains = 0, losses = 0;
  for (var i = 0; i < period; i++) {
    var change = parseFloat(data[index - i][priceType]) - parseFloat(data[index - i - 1][priceType]);
    if (change > 0) gains += change; else losses -= change;
  }
  var rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
  return 100 - (100 / (1 + rs));
}

function scanCrypto(symbol, zThreshold, rsiThreshold, volMult) {
  try {
    var response = UrlFetchApp.fetch('https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=15m&limit=100');
    var data = JSON.parse(response.getContentText());
    if (data.length < 50) return;
    
    var currIndex = data.length - 1;  
    var panicIndex = data.length - 2; 
    
    var sma20 = getSMA(data, 20, panicIndex, 4); 
    var stdDev = getStdDev(data, 20, panicIndex, sma20, 4);
    var panicClose = parseFloat(data[panicIndex][4]);
    
    var zScore = stdDev === 0 ? 0 : (panicClose - sma20) / stdDev;
    var rsi = getRSI(data, 14, panicIndex, 4);
    
    var sumVol = 0;
    for (var v = 1; v <= 20; v++) sumVol += parseFloat(data[panicIndex - v][5]);
    var avgVol = sumVol / 20;
    var panicVol = parseFloat(data[panicIndex][5]);
    
    var currOpen = parseFloat(data[currIndex][1]);
    var currClose = parseFloat(data[currIndex][4]);
    var isRebounding = currClose > currOpen; 
    
    if (zScore < zThreshold && rsi < rsiThreshold && panicVol > (avgVol * volMult) && isRebounding) {
      var entry = currClose;
      var sl = parseFloat(data[panicIndex][3]); 
      var tp = sma20; 
      
      if ((tp - entry) > (entry - sl) * 1.5) { 
        var msg = "🚨 <b>" + symbol.replace("USDT", "USD") + " | Capitulare " + Math.abs(zScore).toFixed(1) + " Deviatii</b> 🚨\n\n" +
                  "📈 <b>Sistem:</b> RSI extrem la " + rsi.toFixed(1) + " | Volum " + volMult + "x\n" +
                  "Direcție: 🟢 <b>LONG (Buy)</b>\n\n" +
                  "📍 <b>Entry:</b> $" + entry.toFixed(4) + "\n" +
                  "🛑 <b>SL:</b> $" + sl.toFixed(4) + "\n" +
                  "🎯 <b>TP:</b> $" + tp.toFixed(4) + "\n\n" +
                  "<i>Sistem Optim | M15</i>";
        sendTelegramMessage(msg);
      }
    }
  } catch (e) { Logger.log("Eroare Crypto " + symbol + ": " + e); }
}

function scanGold() {
  try {
    var response = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d');
    var json = JSON.parse(response.getContentText());
    if (!json.chart.result) return;
    
    var quote = json.chart.result[0].indicators.quote[0];
    var closes = quote.close;
    var lows = quote.low;
    
    var data = [];
    for(var i=0; i<closes.length; i++) {
      if(closes[i] !== null) data.push({3: lows[i], 4: closes[i]});
    }
    
    if (data.length < 50) return;
    var currIndex = data.length - 1;
    var panicIndex = data.length - 2;
    
    var rsi = getRSI(data, 14, panicIndex, 4);
    var sma50 = getSMA(data, 50, panicIndex, 4);
    var panicClose = parseFloat(data[panicIndex][4]);
    var currClose = parseFloat(data[currIndex][4]);
    
    if (rsi < 25 && panicClose < sma50 && currClose > panicClose) {
       var entry = currClose;
       var sl = parseFloat(data[panicIndex][3]);
       var tp = sma50; 
       
       if ((tp - entry) > (entry - sl) * 1.5) {
         var msg = "🚨 <b>XAUUSD (Aur) | RSI Reversal</b> 🚨\n\n" +
                   "📈 <b>Sistem:</b> Aur Supravândut (RSI: " + rsi.toFixed(1) + ")\n" +
                   "Direcție: 🟢 <b>LONG (Buy)</b>\n\n" +
                   "📍 <b>Entry:</b> $" + entry.toFixed(2) + "\n" +
                   "🛑 <b>SL:</b> $" + sl.toFixed(2) + "\n" +
                   "🎯 <b>TP (SMA50):</b> $" + tp.toFixed(2) + "\n\n" +
                   "<i>Sistem Optim | M15</i>";
         sendTelegramMessage(msg);
       }
    }
  } catch (e) { Logger.log("Eroare AUR: " + e); }
}

function scanMarkets() {
  scanCrypto('BTCUSDT', -2.0, 30, 2.5);
  scanCrypto('SOLUSDT', -3.0, 20, 3.0);
  scanGold();
}
