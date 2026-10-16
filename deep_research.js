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

// Fetch 5000 candles
async function getHistoricalData(symbol) {
    let allData = [];
    let endTime = null;
    for (let i = 0; i < 5; i++) {
        const data = await fetchBinance(symbol, '15m', 1000, endTime);
        if (!data || data.length === 0) break;
        allData = data.concat(allData);
        endTime = data[0][0] - 1; // get timestamp of oldest candle - 1 ms
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

async function runDeepResearch() {
    console.log("⏳ Încep descărcarea și procesarea masivă de date (DEEP RESEARCH)...");
    const btcData = await getHistoricalData('BTCUSDT');
    console.log(`✅ Am descărcat ${btcData.length} lumânări M15 (aprox. ultimele 50 de zile reale de tranzacționare).`);
    
    // Testăm ZECI de variante matematice pentru a găsi PERFECȚIUNEA
    const zScores = [-2.0, -2.5, -3.0];
    const rsiLevels = [25, 30, 35];
    const volMultipliers = [1.5, 2.0, 2.5];
    
    let bestConfig = null;
    let bestNetR = -9999;
    
    console.log("⚙️ Testez peste 27 de variante structurale de inteligență cantitativă...");

    for (let z of zScores) {
        for (let r of rsiLevels) {
            for (let v of volMultipliers) {
                
                let wins = 0, losses = 0, netR = 0;
                
                for (let i = 50; i < btcData.length - 20; i++) {
                    const sma20 = getSMA(btcData, 20, i);
                    const stdDev = getStdDev(btcData, 20, i, sma20);
                    const close = parseFloat(btcData[i][4]);
                    
                    const zScore = (close - sma20) / stdDev;
                    const rsi = getRSI(btcData, 14, i);
                    
                    let sumVol = 0;
                    for (let j = 1; j <= 20; j++) sumVol += parseFloat(btcData[i - j][5]);
                    const avgVol = sumVol / 20;
                    const vol = parseFloat(btcData[i][5]);
                    
                    const nextOpen = parseFloat(btcData[i+1][1]);
                    const nextClose = parseFloat(btcData[i+1][4]);
                    const isRebounding = nextClose > nextOpen;
                    
                    if (zScore < z && rsi < r && vol > (avgVol * v) && isRebounding) {
                        const entryPrice = nextClose;
                        const stopLoss = parseFloat(btcData[i][3]); // Low of panic candle
                        const takeProfit = sma20; // Mean reversion target
                        
                        const risk = entryPrice - stopLoss;
                        const reward = takeProfit - entryPrice;
                        
                        if (reward > (risk * 1.5)) {
                            // Simulăm viitorul
                            let result = 'none';
                            for (let k = i + 2; k < i + 50 && k < btcData.length; k++) {
                                if (parseFloat(btcData[k][3]) <= stopLoss) { result = 'loss'; break; }
                                if (parseFloat(btcData[k][2]) >= takeProfit) { result = 'win'; break; }
                            }
                            if (result === 'win') { wins++; netR += (reward/risk); }
                            else if (result === 'loss') { losses++; netR -= 1; }
                        }
                    }
                }
                
                if (netR > bestNetR) {
                    bestNetR = netR;
                    bestConfig = { z, r, v, wins, losses, netR };
                }
            }
        }
    }
    
    console.log("\n==============================================");
    console.log("🏆 REZULTAT DEEP RESEARCH (Cea mai profitabilă setare pe ultimele 50 zile):");
    console.log("==============================================");
    console.log(`- Z-Score Optim: ${bestConfig.z} (Cât de adâncă să fie panica)`);
    console.log(`- RSI Optim: sub ${bestConfig.r} (Oversold level)`);
    console.log(`- Multiplicator Volum: ${bestConfig.v}x`);
    console.log(`- Tranzacții Câștigate: ${bestConfig.wins}`);
    console.log(`- Tranzacții Pierdute: ${bestConfig.losses}`);
    console.log(`- Profit Pur (Net R): +${bestConfig.netR.toFixed(2)}R`);
    console.log("==============================================");
}

runDeepResearch();
