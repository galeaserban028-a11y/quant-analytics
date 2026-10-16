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
    for (const ticker of ['BTC-USD', 'SOL-USD', 'GC=F']) {
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
        console.log(`=== ${ticker} (Meta regularMarketPrice: ${res0.meta.regularMarketPrice}) ===`);
        for (let c = data.length - 20; c < data.length; c++) {
            const p = c - 1;
            const sma20 = getSMA(data, 20, p);
            const sma50 = getSMA(data, 50, p);
            const std = getStdDev(data, 20, p, sma20);
            const z = std === 0 ? 0 : (data[p].c - sma20) / std;
            const rsi = getRSI(data, 14, p);
            console.log(`${new Date(data[c].t * 1000).toISOString()} | O=${data[c].o.toFixed(2)} H=${data[c].h.toFixed(2)} L=${data[c].l.toFixed(2)} C=${data[c].c.toFixed(2)} | p.Z=${z.toFixed(2)} p.RSI=${rsi.toFixed(1)} sma20=${sma20.toFixed(2)} sma50=${sma50.toFixed(2)}`);
        }
    }
})();
