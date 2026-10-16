const https = require('https');

function fetchJson(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e){ resolve([]); }});
        }).on('error', () => resolve([]));
    });
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

async function checkYesterday() {
    console.log("🔍 Caut in arhiva Binance semnalele de ieri...");
    // 200 de lumanari de 15m = aprox 50 de ore (ultimele 2 zile)
    const data = await fetchJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200');
    
    let found = false;
    for (let i = 50; i < data.length - 1; i++) {
        const panicIndex = i - 1;
        const currIndex = i;
        
        const sma20 = getSMA(data, 20, panicIndex);
        const stdDev = getStdDev(data, 20, panicIndex, sma20);
        const panicClose = parseFloat(data[panicIndex][4]);
        
        const zScore = (panicClose - sma20) / stdDev;
        const rsi = getRSI(data, 14, panicIndex);
        
        let sumVol = 0;
        for (let v = 1; v <= 20; v++) sumVol += parseFloat(data[panicIndex - v][5]);
        const avgVol = sumVol / 20;
        const panicVol = parseFloat(data[panicIndex][5]);
        
        const currOpen = parseFloat(data[currIndex][1]);
        const currClose = parseFloat(data[currIndex][4]);
        const isRebounding = currClose > currOpen;
        
        if (zScore < -2.0 && rsi < 30 && panicVol > (avgVol * 2.5) && isRebounding) {
            found = true;
            const entry = currClose;
            const sl = parseFloat(data[panicIndex][3]);
            const tp = sma20;
            
            const date = new Date(data[currIndex][0]).toLocaleString('ro-RO');
            console.log(`\n🚨 SEMNAL GĂSIT PE: ${date}`);
            console.log(`- Entry: $${entry.toFixed(2)}`);
            console.log(`- Stop Loss: $${sl.toFixed(2)}`);
            console.log(`- Take Profit: $${tp.toFixed(2)}`);
            
            // Verificam viitorul dupa acest semnal
            let result = 'În desfășurare / Nedecis';
            let duration = 0;
            for (let j = currIndex + 1; j < data.length; j++) {
                duration++;
                const low = parseFloat(data[j][3]);
                const high = parseFloat(data[j][2]);
                if (low <= sl) { result = `❌ A lovit Stop Loss-ul dupa ${duration * 15} minute`; break; }
                if (high >= tp) { result = `✅ A atins Take Profit-ul dupa ${duration * 15} minute!`; break; }
            }
            console.log(`-> REZULTAT: ${result}`);
        }
    }
    
    if (!found) {
        console.log("Nu am gasit niciun semnal matematic pe setarile supreme in ultimele 48 de ore. Daca ai primit ieri unul, e posibil sa fi fost cel generat de functia initiala (M15 normal) inainte sa punem filtrele SMC.");
    }
}

checkYesterday();
