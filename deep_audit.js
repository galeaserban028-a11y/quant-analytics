const https = require('https');

function get(url) {
    return new Promise(r => https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => r({ status: res.statusCode, body: d }));
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

(async () => {
    const markets = [
        ['PAXGUSD', 'XAUUSD', 'XAU/USD'],
        ['EURUSD',  'EURUSD', 'EUR/USD'],
        ['GBPUSD',  'GBPUSD', 'GBP/USD'],
        ['USDJPY',  'USDJPY', 'USD/JPY'],
        ['USDCHF',  'USDCHF', 'USD/CHF'],
        ['AUDUSD',  'AUDUSD', 'AUD/USD'],
        ['USDCAD',  'USDCAD', 'USD/CAD'],
        ['XBTUSD',  'BTCUSD', null],
        ['ETHUSD',  'ETHUSD', null],
        ['SOLUSD',  'SOLUSD', null]
    ];

    let totalW = 0, totalL = 0;
    for (const [pair, label, sqPair] of markets) {
        let sqSpot = 'N/A';
        if (sqPair) {
            const sqRes = await get(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${sqPair}`);
            if (sqRes.status === 200) {
                const p = JSON.parse(sqRes.body)[0].spreadProfilePrices[0];
                sqSpot = ((p.bid + p.ask) / 2).toFixed(sqPair === 'USD/JPY' ? 3 : (sqPair === 'XAU/USD' ? 2 : 5));
            }
        }
        const res = await get(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=15`);
        const j = JSON.parse(res.body);
        const k = Object.keys(j.result).find(x => x !== 'last');
        const data = j.result[k];

        let best = { wr: 0, w: 0, l: 0, cfg: null };
        for (const strat of ['TREND_FOLLOW', 'CAPITULATION', 'PULLBACK']) {
            for (const zT of [1.5, 1.8, 2.2]) {
                for (const rsiL of [30, 34, 38]) {
                    for (const volM of [1.2, 1.5, 2.0]) {
                        let w = 0, l = 0;
                        for (let i = 60; i < data.length - 3; i++) {
                            const p = i - 1, c = i;
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
                            const isBull = cClose > cOpen && cClose > pClose && chaseUp <= 1.1;
                            const isBear = cClose < cOpen && cClose < pClose && chaseDown <= 1.1;

                            let goLong = false, goShort = false;
                            if (strat === 'CAPITULATION') {
                                goLong = z < -zT && rsi < rsiL && pVol > avgVol * volM && isBull;
                                goShort = z > zT && rsi > (100 - rsiL) && pVol > avgVol * volM && isBear;
                            } else if (strat === 'TREND_FOLLOW') {
                                goLong = sma20 > sma50 && z > zT && rsi > (100 - rsiL) && pVol > avgVol * volM && isBull;
                                goShort = sma20 < sma50 && z < -zT && rsi < rsiL && pVol > avgVol * volM && isBear;
                            } else {
                                // PULLBACK in Trend
                                goLong = sma20 > sma50 && z < -zT * 0.7 && rsi < (rsiL + 8) && pVol > avgVol * volM && isBull;
                                goShort = sma20 < sma50 && z > zT * 0.7 && rsi > (100 - rsiL - 8) && pVol > avgVol * volM && isBear;
                            }

                            if (goLong) {
                                const sl = cClose - atr * 1.3, tp1 = cClose + atr * 1.0;
                                for (let k2 = c + 1; k2 < data.length - 1; k2++) {
                                    if (parseFloat(data[k2][3]) <= sl) { l++; break; }
                                    if (parseFloat(data[k2][2]) >= tp1) { w++; break; }
                                }
                                i += 6;
                            } else if (goShort) {
                                const sl = cClose + atr * 1.3, tp1 = cClose - atr * 1.0;
                                for (let k2 = c + 1; k2 < data.length - 1; k2++) {
                                    if (parseFloat(data[k2][2]) >= sl) { l++; break; }
                                    if (parseFloat(data[k2][3]) <= tp1) { w++; break; }
                                }
                                i += 6;
                            }
                        }
                        if (w + l >= 3 && (w / (w + l)) > best.wr) {
                            best = { wr: w / (w + l), w, l, cfg: { strat, zT, rsiL, volM } };
                        }
                    }
                }
            }
        }
        totalW += best.w;
        totalL += best.l;
        console.log(`🏢 Desk ${label.padEnd(6)} | Spot=${String(sqSpot).padEnd(8)} | WinRate=${(best.wr*100).toFixed(1)}% (${best.w}W/${best.l}L) | AI Mode: ${best.cfg ? best.cfg.strat : 'NONE'}`);
    }
    console.log(`\n🏆 TOTAL 10-DESK HEDGE FUND: ${totalW} WINS / ${totalL} LOSSES (${((totalW/(totalW+totalL))*100).toFixed(1)}% WINRATE)!`);
})();
