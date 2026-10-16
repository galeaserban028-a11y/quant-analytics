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

async function getHistoricalData(symbol) {
    let allData = [];
    let endTime = null;
    for (let i = 0; i < 5; i++) {
        const data = await fetchBinance(symbol, '15m', 1000, endTime);
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

async function runResearch() {
    console.log("⏳ INIȚIERE DEEP RESEARCH V2 (The Macro Filter Test)...");
    
    const data = await getHistoricalData('BTCUSDT');
    const z = -2.0, r = 30, v = 2.5; 
    
    console.log("Testează diferența dintre sistemul ORIB (Orbește) vs SISTEMUL MACRO (Filtrat de Trend)...");
    
    let winsNoFilter = 0, lossesNoFilter = 0, netRNoFilter = 0;
    let winsFiltered = 0, lossesFiltered = 0, netRFiltered = 0;
    
    // We start from 200 because we need SMA200
    for (let i = 200; i < data.length - 20; i++) {
        const sma20 = getSMA(data, 20, i);
        const sma200 = getSMA(data, 200, i); // Trendul Macro Instituțional!
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
                
                // Tranzacție Oarbă (cum e codul curent)
                if (result === 'win') { winsNoFilter++; netRNoFilter += (reward/risk); }
                else if (result === 'loss') { lossesNoFilter++; netRNoFilter -= 1; }
                
                // Tranzacție cu Filtru MACRO (Doar dacă suntem deasupra SMA200)
                const isMacroBullish = close > sma200;
                if (isMacroBullish) {
                    if (result === 'win') { winsFiltered++; netRFiltered += (reward/risk); }
                    else if (result === 'loss') { lossesFiltered++; netRFiltered -= 1; }
                }
            }
        }
    }
    
    console.log("\n==============================================");
    console.log("FARA FILTRU MACRO (Codul curent):");
    console.log(`- Wins: ${winsNoFilter} | Losses: ${lossesNoFilter}`);
    console.log(`- Win Rate: ${((winsNoFilter/(winsNoFilter+lossesNoFilter))*100).toFixed(1)}%`);
    console.log(`- Profit (Net R): +${netRNoFilter.toFixed(2)}R`);
    
    console.log("\nCU FILTRUL INSTITUȚIONAL (SMA 200):");
    console.log(`- Wins: ${winsFiltered} | Losses: ${lossesFiltered}`);
    console.log(`- Win Rate: ${((winsFiltered/(winsFiltered+lossesFiltered))*100).toFixed(1)}%`);
    console.log(`- Profit (Net R): +${netRFiltered.toFixed(2)}R`);
    console.log("==============================================");
}

runResearch();
