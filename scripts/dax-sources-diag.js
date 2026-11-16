'use strict';
// Caută o sursă GRATUITĂ, fără cont, cu DAX live (nu întârziat 15 min). Afișează statusul și începutul răspunsului.
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json, text/plain, */*' };
const now = Date.now(), d0 = new Date(now - 3 * 864e5).toISOString().slice(0, 10), d1 = new Date(now + 864e5).toISOString().slice(0, 10);
const urls = {
  onvista_search: 'https://api.onvista.de/api/v1/instruments/query?searchValue=DAX',
  onvista_snapshot: 'https://api.onvista.de/api/v1/instruments/INDEX/20735/snapshot',
  onvista_chart: `https://api.onvista.de/api/v1/instruments/INDEX/20735/chart_history?chartType=PRICE&endDate=${d1}&idNotation=20735&resolution=15m&startDate=${d0}&withEarnings=false`,
  bf_price: 'https://api.boerse-frankfurt.de/v1/data/price_information/single?isin=DE0008469008&mic=XETR',
  bf_history: 'https://api.boerse-frankfurt.de/v1/data/price_history?limit=50&offset=0&isin=DE0008469008&mic=XETR&minDate='+d0+'&maxDate='+d1,
  bf_intraday: 'https://api.boerse-frankfurt.de/v1/tradingview/history?symbol=XETR%3ADE0008469008&resolution=15&from='+Math.floor((now-3*864e5)/1000)+'&to='+Math.floor(now/1000),
  ls_search: 'https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=DAX&localeId=2',
  bf_1m: 'https://api.boerse-frankfurt.de/v1/tradingview/history?symbol=XETR%3ADE0008469008&resolution=1&from='+Math.floor((now-3600e3)/1000)+'&to='+Math.floor(now/1000),
  stoxx: 'https://www.stoxx.com/document/Indices/Current/HistoricalData/h_3dax.txt',
  yahoo_quote: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGDAXI?interval=1m&range=1d',
  yahoo_fdax: 'https://query1.finance.yahoo.com/v8/finance/chart/FDAX%3DF?interval=1m&range=1d',
  yahoo_dax_etf: 'https://query1.finance.yahoo.com/v8/finance/chart/EXS1.DE?interval=1m&range=1d'
};
(async () => {
  for (const [k, u] of Object.entries(urls)) {
    try {
      const r = await fetch(u, { headers: H }); const t = await r.text();
      let extra = '';
      if (k.startsWith('bf_') && r.ok) { try { const j = JSON.parse(t); if (j.t) extra = ` | ultima lumânare deschisă acum ${((now - j.t[j.t.length - 1] * 1000) / 60000).toFixed(1)} min, close ${j.c[j.c.length - 1]}`; if (j.timestampLastPrice) extra = ` | timestampLastPrice acum ${((now - Date.parse(j.timestampLastPrice)) / 60000).toFixed(1)} min, preț ${j.lastPrice}`; } catch (e) {} }
      if (k.startsWith('yahoo') && r.ok) { const j = JSON.parse(t).chart.result[0]; const ts = j.timestamp || []; extra = ` | ultima lumânare acum ${((now - ts[ts.length - 1] * 1000) / 60000).toFixed(1)} min, regularMarketTime acum ${((now - j.meta.regularMarketTime * 1000) / 60000).toFixed(1)} min`; }
      console.log(`::notice::${k}: HTTP ${r.status}${extra} :: ${t.replace(/\s+/g, ' ').slice(0, 700)}`);
    } catch (e) { console.log(`::notice::${k}: EROARE ${e.message}`); }
  }
})();
