const https = require('https');

function fetchBinance(symbol, interval, limit, endTime = null) {
    return new Promise((resolve) => {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (endTime) url += `&endTime=${endTime}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e){ resolve([]); }});
        }).on('error', () => resolve([]));
    });
}

// Fetch 5000 candles (1H candles = 208 days / > 6 months)
async function getHistoricalData(symbol) {
    let allData = [];
    let endTime = null;
    for (let i = 0; i < 5; i++) {
        const data = await fetchBinance(symbol, '1h', 1000, endTime);
        if (!data || data.length === 0) break;
        allData = data.concat(allData);
        endTime = data[0][0] - 1; 
    }
    return allData;
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
        if (change > 0) gains += change;
        else losses -= change;
    }
    let rs = (gains / period) / (losses / period === 0 ? 0.0001 : (losses / period));
    return 100 - (100 / (1 + rs));
}

async function runUltraDeepResearch() {
    console.log("⏳ INIȚIERE ULTRA DEEP RESEARCH (Cross-Asset & Long-Term Validation)...");
    
    const assets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const z = -2.0, r = 30, v = 2.5; // Cei mai buni parametri gasiți anterior
    
    let totalWins = 0, totalLosses = 0, totalNetR = 0;
    
    console.log(`\n🔍 Setări testate: Z-Score < ${z} | RSI < ${r} | Volum > ${v}x`);
    console.log(`📊 Date analizate: 5000 lumânări H1 (Aprox. 208 ZILE / 6 LUNI de istoric)\n`);
    
    for (const symbol of assets) {
        console.log(`[${symbol}] Descarc și procesez datele din ultimele 6 luni...`);
        const data = await getHistoricalData(symbol);
        
        let wins = 0, losses = 0, netR = 0;
        for (let i = 50; i < data.length - 20; i++) {
            const sma20 = getSMA(data, 20, i);
            const stdDev = getStdDev(data, 20, i, sma20);
            const close = parseFloat(data[i][4]);
            const zScore = (close - sma20) / stdDev;
            const rsi = getRSI(data, 14, i);
            
            let sumVol = 0;
            for (let j = 1; j <= 20; j++) sumVol += parseFloat(data[i - j][5]);
            const avgVol = sumVol / 20;
            const vol = parseFloat(data[i][5]);
            
            const nextOpen = parseFloat(data[i+1][1]);
            const nextClose = parseFloat(data[i+1][4]);
            const isRebounding = nextClose > nextOpen;
            
            if (zScore < z && rsi < r && vol > (avgVol * v) && isRebounding) {
                const entryPrice = nextClose;
                const stopLoss = parseFloat(data[i][3]); 
                const takeProfit = sma20; 
                
                const risk = entryPrice - stopLoss;
                const reward = takeProfit - entryPrice;
                
                if (reward > (risk * 1.5)) {
                    let result = 'none';
                    for (let k = i + 2; k < i + 100 && k < data.length; k++) {
                        if (parseFloat(data[k][3]) <= stopLoss) { result = 'loss'; break; }
                        if (parseFloat(data[k][2]) >= takeProfit) { result = 'win'; break; }
                    }
                    if (result === 'win') { wins++; netR += (reward/risk); }
                    else if (result === 'loss') { losses++; netR -= 1; }
                }
            }
        }
        
        console.log(` > ${symbol}: ${wins} Wins | ${losses} Losses | Net Profit: +${netR.toFixed(2)}R`);
        totalWins += wins; totalLosses += losses; totalNetR += netR;
    }
    
    console.log("\n==============================================");
    console.log("🏆 VERDICT FINAL MULTI-ASSET (Ultimele 6 LUNI):");
    console.log("==============================================");
    console.log(`- Tranzacții Câștigate Total: ${totalWins}`);
    console.log(`- Tranzacții Pierdute Total: ${totalLosses}`);
    console.log(`- Win Rate Mediu: ${((totalWins/(totalWins+totalLosses))*100).toFixed(1)}%`);
    console.log(`- PROFIT PUR (Net R) Combinat: +${totalNetR.toFixed(2)}R`);
    console.log("==============================================");
}

runUltraDeepResearch();
