const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_TOKEN';

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { resolve({ status: 500, error: e.message }); }
            });
        }).on('error', (e) => resolve({ status: 500, error: e.message }));
    });
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

async function runMasterTest() {
    console.log("==========================================");
    console.log("🔧 RULEZ TESTUL SUPREM (SISTEM INTEGRAT)");
    console.log("==========================================\n");

    let allPassed = true;

    // 1. TELEGRAM API TEST
    process.stdout.write("Test 1: Conexiune Telegram Bot API... ");
    const tgRes = await fetchJson(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`);
    if (tgRes.status === 200 && tgRes.data.ok) {
        console.log(`✅ SUCCES (Conectat ca @${tgRes.data.result.username})`);
    } else {
        console.log(`❌ EROARE (${tgRes.status})`);
        allPassed = false;
    }

    // 2. BINANCE BTC TEST
    process.stdout.write("Test 2: Preluare și parsare date Bitcoin (Binance)... ");
    const btcRes = await fetchJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100');
    if (btcRes.status === 200 && Array.isArray(btcRes.data) && btcRes.data.length > 50) {
        console.log(`✅ SUCCES (${btcRes.data.length} lumânări)`);
        const rsi = getRSI(btcRes.data, 14, btcRes.data.length - 2, 4);
        console.log(`        -> RSI Curent Valid: ${rsi.toFixed(2)}`);
    } else {
        console.log(`❌ EROARE`);
        allPassed = false;
    }

    // 3. BINANCE SOL TEST
    process.stdout.write("Test 3: Preluare și parsare date Solana (Binance)... ");
    const solRes = await fetchJson('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=15m&limit=100');
    if (solRes.status === 200 && Array.isArray(solRes.data) && solRes.data.length > 50) {
        console.log(`✅ SUCCES (${solRes.data.length} lumânări)`);
    } else {
        console.log(`❌ EROARE`);
        allPassed = false;
    }

    // 4. YAHOO FINANCE GOLD TEST
    process.stdout.write("Test 4: Preluare și parsare date Aur/Gold (Yahoo Finance)... ");
    const goldRes = await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d');
    if (goldRes.status === 200 && goldRes.data && goldRes.data.chart && goldRes.data.chart.result) {
        console.log(`✅ SUCCES`);
        const quote = goldRes.data.chart.result[0].indicators.quote[0];
        console.log(`        -> Ultimul preț Aur: $${quote.close[quote.close.length - 1].toFixed(2)}`);
    } else {
        console.log(`❌ EROARE`);
        allPassed = false;
    }

    console.log("\n==========================================");
    if (allPassed) {
        console.log("🏆 REZULTAT: 100% PERFECT. TOATE SISTEMELE SUNT OPERAȚIONALE.");
    } else {
        console.log("⚠️ REZULTAT: AU FOST DETECTATE ERORI. VERIFICAȚI LOGURILE.");
    }
    console.log("==========================================");
}

runMasterTest();
