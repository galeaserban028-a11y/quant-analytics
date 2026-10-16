const https = require('https');

function fetchYahoo(ticker) {
    return new Promise((resolve) => {
        https.get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=15m&range=5d`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });
}

function getSMA(data, period, index) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[index - i].c;
    return sum / period;
}
function getStdDev(data, period, index, sma) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += Math.pow(data[index - i].c - sma, 2);
    return Math.sqrt(sum / period);
}
function getRSI(data, period, index) {
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        let change = data[index - i].c - data[index - i - 1].c;
        if (change > 0) gains += change; else losses -= change;
    }
    let rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
    return 100 - (100 / (1 + rs));
}

(async () => {
    for (const [ticker, name, isGold] of [['BTC-USD', 'BTCUSD', false], ['SOL-USD', 'SOLUSD', false], ['GC=F', 'XAUUSD (Aur)', true]]) {
        const json = await fetchYahoo(ticker);
        const res0 = json.chart.result[0];
        const q = res0.indicators.quote[0];
        const ts = res0.timestamp;
        const data = [];
        for (let i = 0; i < q.close.length; i++) {
            if (q.close[i] !== null && q.open[i] !== null && q.high[i] !== null && q.low[i] !== null) {
                data.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
            }
        }
        let wins = 0, losses = 0;
        for (let i = 60; i < data.length - 1; i++) {
            const p = i - 1;
            const c = i;
            const sma20 = getSMA(data, 20, p);
            const sma50 = getSMA(data, 50, p);
            const std = getStdDev(data, 20, p, sma20);
            const z = std === 0 ? 0 : (data[p].c - sma20) / std;
            const rsi = getRSI(data, 14, p);

            const isBullRebound = data[c].c > data[c].o && data[c].c > data[p].c;
            const isBearReject = data[c].c < data[c].o && data[c].c < data[p].c;

            if ((isGold ? (z < -2.8 && rsi < 25) : (sma20 > sma50 && z < -1.8 && rsi < 32)) && isBullRebound) {
                const entry = data[c].c;
                const tp = sma20;
                const reward = tp - entry;
                const sl = entry - reward;
                let res = 'OPEN';
                for (let j = c + 1; j < data.length; j++) {
                    if (data[j].l <= sl) { res = 'LOSS'; losses++; break; }
                    if (data[j].h >= tp) { res = 'WIN'; wins++; break; }
                }
                console.log(`[${name} LONG] ${new Date(data[c].t * 1000).toISOString()} => ${res}`);
                i += 6;
            } else if (!isGold && sma20 < sma50 && z > 1.8 && rsi > 67 && isBearReject) {
                const entry = data[c].c;
                const tp = sma20;
                const reward = entry - tp;
                const sl = entry + reward;
                let res = 'OPEN';
                for (let j = c + 1; j < data.length; j++) {
                    if (data[j].h >= sl) { res = 'LOSS'; losses++; break; }
                    if (data[j].l <= tp) { res = 'WIN'; wins++; break; }
                }
                console.log(`[${name} SHORT] ${new Date(data[c].t * 1000).toISOString()} => ${res}`);
                i += 6;
            }
        }
        console.log(`==> ${name}: Wins=${wins}, Losses=${losses} (WinRate: ${wins+losses ? ((wins/(wins+losses))*100).toFixed(0) : 0}%)\n`);
    }
})();
