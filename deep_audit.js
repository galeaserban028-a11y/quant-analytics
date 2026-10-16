const https = require('https');

function get(url) {
    return new Promise(r => https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => r(JSON.parse(d)));
    }));
}

function getShockRSI(data, period, index) {
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        let change = parseFloat(data[index - i][4]) - parseFloat(data[index - i - 1][4]);
        if (change > 0) gains += change; else losses -= change;
    }
    if (losses === 0) return 100;
    let rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
}

function getTrueATR(data, period, endIndex) {
    let sum = 0;
    for (let i = 0; i < period; i++) {
        let idx = endIndex - i;
        let h = parseFloat(data[idx][2]);
        let l = parseFloat(data[idx][3]);
        let pc = parseFloat(data[idx - 1][4]);
        let tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        sum += tr;
    }
    return sum / period;
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

(async () => {
    const configs = [
        ['XBTUSD', 'BTCUSD', false, 1.8, 32, 1.2, true],
        ['SOLUSD', 'SOLUSD', false, 2.2, 35, 1.2, false],
        ['PAXGUSD', 'XAUUSD (Aur Spot)', true, 1.8, 35, 2.5, false]
    ];

    for (const [pair, name, isGold, zT, rsiL, volM, strictTrendLong] of configs) {
        const j = await get(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=15`);
        const key = Object.keys(j.result).find(k => k !== 'last');
        const data = j.result[key];

        let w1 = 0, w2 = 0, l = 0;
        for (let i = 60; i < data.length - 2; i++) {
            const p = i - 1;
            const c = i;
            const sma20 = getSMA(data, 20, p);
            const sma50 = getSMA(data, 50, p);
            const std = getStdDev(data, 20, p, sma20);
            const pClose = parseFloat(data[p][4]);
            const z = std === 0 ? 0 : (pClose - sma20) / std;
            const rsi = getShockRSI(data, 14, p);
            const atr = getTrueATR(data, 14, p);

            let sumVol = 0;
            for (let v = 1; v <= 20; v++) sumVol += parseFloat(data[p - v][6]);
            const avgVol = sumVol / 20;
            const pVol = parseFloat(data[p][6]);

            const cOpen = parseFloat(data[c][1]), cClose = parseFloat(data[c][4]);
            const chaseUp = (cClose - pClose) / atr;
            const chaseDown = (pClose - cClose) / atr;

            const isBull = cClose > cOpen && cClose > pClose && chaseUp <= 1.2;
            const isBear = cClose < cOpen && cClose < pClose && chaseDown <= 1.2;
            const allowLong = strictTrendLong ? (sma20 > sma50) : true;

            if (allowLong && z < -zT && rsi < rsiL && pVol > avgVol * volM && isBull) {
                const entry = cClose;
                const sl = entry - atr * 1.3;
                const tp1 = entry + atr * 1.0;
                const tp2 = entry + atr * 1.8;
                let hitTP1 = false;
                for (let k = c + 1; k < data.length; k++) {
                    const kL = parseFloat(data[k][3]), kH = parseFloat(data[k][2]);
                    if (!hitTP1 && kL <= sl) { l++; break; }
                    if (kH >= tp1) hitTP1 = true;
                    if (hitTP1 && kH >= tp2) { w2++; w1++; break; }
                    if (hitTP1 && kL <= entry) { w1++; break; }
                }
                i += 6;
            } else if (!isGold && sma20 < sma50 && z > zT && rsi > (100 - rsiL) && pVol > avgVol * volM && isBear) {
                const entry = cClose;
                const sl = entry + atr * 1.3;
                const tp1 = entry - atr * 1.0;
                const tp2 = entry - atr * 1.8;
                let hitTP1 = false;
                for (let k = c + 1; k < data.length; k++) {
                    const kL = parseFloat(data[k][3]), kH = parseFloat(data[k][2]);
                    if (!hitTP1 && kH >= sl) { l++; break; }
                    if (kL <= tp1) hitTP1 = true;
                    if (hitTP1 && kL <= tp2) { w2++; w1++; break; }
                    if (hitTP1 && kH >= entry) { w1++; break; }
                }
                i += 6;
            }
        }
        console.log(`🏆 ${name}: Total=${w1+l} | Wins=${w1} (Full TP2=${w2}) | Losses=${l} | WinRate=${((w1/(w1+l))*100).toFixed(1)}%`);
    }
})();
