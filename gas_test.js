const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });
}

(async () => {
    const gcf = await fetchUrl('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d');
    const q = gcf.chart.result[0].indicators.quote[0];
    const lastFutures = q.close.filter(x => x !== null).pop();

    const sq = await fetchUrl('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD');
    const prices = sq[0].spreadProfilePrices[0];
    const liveSpotGold = (prices.bid + prices.ask) / 2;
    const offset = liveSpotGold - lastFutures;

    console.log("Gold Futures (GC=F):", lastFutures.toFixed(2));
    console.log("Gold Spot (XAUUSD real pe Broker):", liveSpotGold.toFixed(2));
    console.log("Diferenta Futures vs Spot:", offset.toFixed(2));
    console.log("Semnalul de la 11:12 convertit pe Spot XAUUSD:");
    console.log("  Entry Spot:", (4185.10 + offset).toFixed(2));
    console.log("  SL Spot:   ", (4179.65 + offset).toFixed(2));
    console.log("  TP Spot:   ", (4193.27 + offset).toFixed(2));
})();
