const https = require('https');

function fetchJson(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, data: null }); }
            });
        }).on('error', () => resolve({ status: 500, data: null }));
    });
}

function getSMA(data, period, index, priceType) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += parseFloat(data[index - i][priceType]);
    return sum / period;
}
function getRSI(data, period, index, priceType) {
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        let change = parseFloat(data[index - i][priceType]) - parseFloat(data[index - i - 1][priceType]);
        if (change > 0) gains += change; else losses -= change;
    }
    let rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
    return 100 - (100 / (1 + rs));
}

async function testGoldFixed() {
    const goldRes = await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d');
    const quote = goldRes.data.chart.result[0].indicators.quote[0];
    const ts = goldRes.data.chart.result[0].timestamp;
    const data = [];
    for (let i = 0; i < quote.close.length; i++) {
        if (quote.close[i] !== null) data.push({ t: ts[i] * 1000, 2: quote.high[i], 3: quote.low[i], 4: quote.close[i] });
    }
    let gWins = 0, gLosses = 0;
    for (let i = 55; i < data.length - 1; i++) {
        const panicIndex = i - 1;
        const currIndex = i;
        const rsi = getRSI(data, 14, panicIndex, 4);
        const sma20 = getSMA(data, 20, panicIndex, 4);
        const panicClose = parseFloat(data[panicIndex][4]);
        const currClose = parseFloat(data[currIndex][4]);
        if (rsi < 25 && panicClose < sma20 && currClose > panicClose) {
            const entry = currClose;
            const tp = sma20;
            const reward = tp - entry;
            if (reward > 5) {
                const sl = entry - (reward / 1.5); // 1:1.5 Risk-Reward with breathing room
                let outcome = "OPEN";
                for (let j = currIndex + 1; j < data.length; j++) {
                    if (data[j][3] <= sl) { outcome = "LOSS"; gLosses++; break; }
                    if (data[j][2] >= tp) { outcome = "WIN"; gWins++; break; }
                }
                console.log(`[GOLD] ${new Date(data[currIndex].t).toISOString()} | Entry: ${entry.toFixed(2)} | SL: ${sl.toFixed(2)} | TP: ${tp.toFixed(2)} => ${outcome}`);
                i += 8; // cooldown 2 hours between signals
            }
        }
    }
    console.log(`==> GOLD FIXED: Wins=${gWins}, Losses=${gLosses}`);
}

testGoldFixed();
