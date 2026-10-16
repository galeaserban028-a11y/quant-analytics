const https = require('https');

function get(url) {
    return new Promise(r => https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => r(JSON.parse(d)));
    }));
}
function getSMA(data, period, index) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += parseFloat(data[index - i][4]);
    return sum / period;
}
function getStdDev(data, period, index, sma) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += Math.pow(parseFloat(data[index - i][4]) - sma, 2);
    return Math.sqrt(sum / period);
}
function getRSI(data, period, index) {
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        let change = parseFloat(data[index - i][4]) - parseFloat(data[index - i - 1][4]);
        if (change > 0) gains += change; else losses -= change;
    }
    let rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
    return 100 - (100 / (1 + rs));
}
function getATR(data, period, index) {
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += (parseFloat(data[index - i][2]) - parseFloat(data[index - i][3]));
    }
    return sum / period;
}

(async () => {
    const j = await get(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15`);
    const key = Object.keys(j.result).find(k => k !== 'last');
    const data = j.result[key];

    let wins = 0, losses = 0, log = [];
    for (let i = 60; i < data.length - 2; i++) {
        const p = i - 1;
        const c = i;
        const sma20 = getSMA(data, 20, p);
        const sma50 = getSMA(data, 50, p);
        const std = getStdDev(data, 20, p, sma20);
        const z = std === 0 ? 0 : (parseFloat(data[p][4]) - sma20) / std;
        const rsi = getRSI(data, 14, p);
        const atr = getATR(data, 14, p);

        let sumVol = 0;
        for (let v = 1; v <= 20; v++) sumVol += parseFloat(data[p - v][6]);
        const avgVol = sumVol / 20;
        const pVol = parseFloat(data[p][6]);

        const pClose = parseFloat(data[p][4]);
        const cOpen = parseFloat(data[c][1]), cClose = parseFloat(data[c][4]);
        const isBull = cClose > cOpen && cClose > pClose;
        const isBear = cClose < cOpen && cClose < pClose;

        if (sma20 > sma50 && z < -1.8 && rsi < 32 && pVol > avgVol * 1.2 && isBull) {
            const entry = cClose;
            const tp = entry + atr * 1.2;
            const sl = entry - atr * 1.5;
            for (let k = c + 1; k < data.length; k++) {
                if (parseFloat(data[k][3]) <= sl) { losses++; log.push(`L LONG ${new Date(data[c][0]*1000).toISOString()}`); break; }
                if (parseFloat(data[k][2]) >= tp) { wins++; log.push(`W LONG ${new Date(data[c][0]*1000).toISOString()}`); break; }
            }
            i += 6;
        } else if (sma20 < sma50 && z > 1.8 && rsi > 68 && pVol > avgVol * 1.2 && isBear) {
            const entry = cClose;
            const tp = entry - atr * 1.2;
            const sl = entry + atr * 1.5;
            for (let k = c + 1; k < data.length; k++) {
                if (parseFloat(data[k][2]) >= sl) { losses++; log.push(`L SHORT ${new Date(data[c][0]*1000).toISOString()}`); break; }
                if (parseFloat(data[k][3]) <= tp) { wins++; log.push(`W SHORT ${new Date(data[c][0]*1000).toISOString()}`); break; }
            }
            i += 6;
        }
    }
    console.log(`🏆 BTCUSD Trend-Aligned: Wins=${wins}, Losses=${losses} (WinRate: ${((wins/(wins+losses))*100).toFixed(1)}%)`);
    console.log(`   Trades:`, log.join(' | '));
})();
