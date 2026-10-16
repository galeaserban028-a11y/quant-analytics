const https = require('https');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_TOKEN';
const CHAT_ID = process.env.CHAT_ID || '5631189371';

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=${encodeURIComponent(text)}&parse_mode=HTML`;
    return new Promise((resolve) => {
        https.get(url, () => resolve());
    });
}

async function run() {
    const msg = `🚨 <b>BTC Institutional Breaker</b> 🚨

Direcție: 🟢 <b>LONG (Buy)</b>

📍 <b>Entry:</b> $63,250.00
🛑 <b>SL (Stop Loss):</b> $62,900.00
🎯 <b>TP (Take Profit):</b> $63,950.00

<i>(Acesta este mesajul tău de test - generat de noul sistem!)</i>`;
    await sendTelegramMessage(msg);
    console.log("Mesaj fortat trimis!");
}

run();
