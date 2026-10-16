const https = require('https');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        }).on('error', reject);
    });
}

async function runBacktest() {
    console.log("=========================================");
    console.log("📊 INIȚIERE BACKTEST (TESTARE STRATEGII)");
    console.log("=========================================\n");

    try {
        // --- TEST BTC (Institutional Breaker Block) pe M15 ---
        console.log("⏳ Descarc ultimele 500 de lumânări M15 pentru BTCUSDT (Date reale de pe piață)...");
        const btcData = await fetchJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=500');
        
        let btcWins = 0;
        let btcLosses = 0;
        let btcNetR = 0;

        // Simulăm strategia: Breaker Block
        // Dacă prețul face o lumânare roșie puternică urmată de una verde care o 'înghite' (engulfing) + volum.
        for (let i = 1; i < btcData.length - 10; i++) {
            const prevCandle = btcData[i-1];
            const currCandle = btcData[i];
            
            const prevOpen = parseFloat(prevCandle[1]);
            const prevClose = parseFloat(prevCandle[4]);
            const currOpen = parseFloat(currCandle[1]);
            const currClose = parseFloat(currCandle[4]);
            const currHigh = parseFloat(currCandle[2]);
            const currLow = parseFloat(currCandle[3]);

            const isRed = prevClose < prevOpen;
            const isGreen = currClose > currOpen;
            const engulfing = currClose > prevOpen && currOpen <= prevClose;

            if (isRed && isGreen && engulfing) {
                // Avem semnal de BUY
                const entryPrice = currClose;
                const atr = (currHigh - currLow) * 1.5; // Calcul simplificat de stop loss
                const stopLoss = entryPrice - atr;
                const takeProfit = entryPrice + (atr * 2); // Risc Reward 1:2

                // Verificăm ce se întâmplă în următoarele lumânări
                let result = 'none';
                for (let j = i + 1; j < i + 10; j++) {
                    const futureLow = parseFloat(btcData[j][3]);
                    const futureHigh = parseFloat(btcData[j][2]);
                    if (futureLow <= stopLoss) {
                        result = 'loss';
                        break;
                    }
                    if (futureHigh >= takeProfit) {
                        result = 'win';
                        break;
                    }
                }

                if (result === 'win') {
                    btcWins++;
                    btcNetR += 2; // Ai câștigat 2R
                } else if (result === 'loss') {
                    btcLosses++;
                    btcNetR -= 1; // Ai pierdut 1R
                }
            }
        }

        const totalTrades = btcWins + btcLosses;
        const winRate = totalTrades > 0 ? ((btcWins / totalTrades) * 100).toFixed(1) : 0;

        console.log("\n✅ REZULTATE TEST BTCUSD (Institutional Breaker Block - M15)");
        console.log(`- Total Semnale Găsite: ${totalTrades}`);
        console.log(`- Tranzacții Câștigătoare (Hit TP): ${btcWins}`);
        console.log(`- Tranzacții Pierzătoare (Hit SL): ${btcLosses}`);
        console.log(`- RATA DE CÂȘTIG (Win Rate): ${winRate}%`);
        console.log(`- PROFIT PUR (Net R): +${btcNetR}R`);
        console.log(btcNetR > 0 ? "Strategia este PROFITABILĂ matematic pe acest eșantion!" : "Strategia are nevoie de optimizare.");
        
        console.log("\n=========================================");
    } catch (e) {
        console.error("Eroare la backtest:", e.message);
    }
}

runBacktest();
