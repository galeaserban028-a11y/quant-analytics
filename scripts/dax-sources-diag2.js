'use strict';
// Runda 2: caută DAX LIVE (nu întârziat 15 min). Pentru fiecare sursă: status, cât de veche e ultima valoare, începutul răspunsului.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const now = Date.now(), s = Math.floor(now / 1000);
const age = (ms) => `${((now - ms) / 60000).toFixed(1)} min`;
const log = (k, m) => console.log(`::notice::${k}: ${m}`.replace(/\s+/g, ' ').slice(0, 900));
async function get(k, url, opt = {}, inspect = null) {
  try {
    const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, Accept: '*/*', ...(opt.headers || {}) } });
    const t = await r.text(); let extra = '';
    if (inspect && r.ok) { try { extra = ' | ' + inspect(t); } catch (e) { extra = ' | parse: ' + e.message; } }
    log(k, `HTTP ${r.status}${extra} :: ${t.slice(0, 500)}`);
    return r.ok ? t : null;
  } catch (e) { log(k, 'EROARE ' + e.message); return null; }
}
const hl = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
(async () => {
  // 1. Dukascopy (aceeași sursă ca datele de backtest)
  for (const inst of ['DEU.IDX/EUR', 'USA500.IDX/USD']) {
    const u = `https://freeserv.dukascopy.com/2.0/?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=15MIN&splits=true&stocks=true&limit=10&time_direction=P&timestamp=${now}&jsonp=_cb`;
    await get('dukascopy ' + inst, u, { headers: { Referer: 'https://freeserv.dukascopy.com/2.0/?path=chart/index&showUI=true&instrument=DEU.IDX/EUR' } },
      (t) => { const a = JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))); const L = a[a.length - 1]; return `ultima lumânare deschisă acum ${age(L[0])}, close ${L[4]}`; });
  }
  // 2. Pyth (căutare + istoric în formatul TradingView)
  const srch = await get('pyth search', 'https://benchmarks.pyth.network/v1/shims/tradingview/search?query=DAX&limit=20');
  await get('pyth search GER', 'https://benchmarks.pyth.network/v1/shims/tradingview/search?query=GER&limit=20');
  await get('pyth search DE40', 'https://benchmarks.pyth.network/v1/shims/tradingview/search?query=DE40&limit=20');
  const cands = new Set();
  try { for (const x of JSON.parse(srch || '[]')) cands.add(x.symbol || x.ticker); } catch (e) {}
  for (const sym of [...cands].slice(0, 6)) await get('pyth hist ' + sym, `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(sym)}&resolution=15&from=${s - 86400}&to=${s}`, {}, (t) => { const j = JSON.parse(t); return `ultima lumânare acum ${age(j.t[j.t.length - 1] * 1000)}, close ${j.c[j.c.length - 1]}`; });
  // 3. Hyperliquid: toate DEX-urile HIP-3 și activele lor (căutăm DAX / GER / DE40)
  const dexs = await get('hl perpDexs', 'https://api.hyperliquid.xyz/info', hl({ type: 'perpDexs' }));
  try {
    for (const d of JSON.parse(dexs).filter(Boolean)) {
      const m = await (await fetch('https://api.hyperliquid.xyz/info', hl({ type: 'meta', dex: d.name }))).json();
      const names = m.universe.map((u) => u.name);
      log('hl dex ' + d.name, names.join(','));
      for (const n of names.filter((x) => /DAX|GER|DE40|DE30|EU50|STOXX|EURO/i.test(x))) {
        await get('hl candles ' + n, 'https://api.hyperliquid.xyz/info', hl({ type: 'candleSnapshot', req: { coin: n, interval: '15m', startTime: now - 864e5, endTime: now } }), (t) => { const a = JSON.parse(t); const L = a[a.length - 1]; return `n=${a.length}, ultima deschisă acum ${age(L.t)}, close ${L.c}`; });
      }
    }
  } catch (e) { log('hl', 'EROARE ' + e.message); }
  // 4. Lang & Schwarz (indicație DAX în timp real)
  const ls = await get('ls search', 'https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=DE0008469008&localeId=2');
  let lsId = null; try { const a = JSON.parse(ls); const x = a.find((y) => /INDEX|IND/i.test(y.categorySymbol || '')) || a[0]; lsId = x && x.instrumentId; log('ls pick', JSON.stringify(x)); } catch (e) {}
  for (const id of [lsId, 19000].filter(Boolean)) {
    await get('ls chart ' + id, `https://www.ls-tc.de/_rpc/json/instrument/chart/dataForInstrument?instrumentId=${id}&marketId=1&quotetype=mid&series=intraday&type=mini&localeId=2`, { headers: { Referer: 'https://www.ls-tc.de/de/index/' + id } },
      (t) => { const j = JSON.parse(t); const ser = j.series && (j.series.intraday || Object.values(j.series)[0]); const d = ser.data; const L = d[d.length - 1]; return `n=${d.length}, ultima valoare acum ${age(L[0])}, preț ${L[1]}`; });
  }
  // 5. TradingView scanner (CFD-uri de la brokeri, de obicei în timp real)
  await get('tv scanner', 'https://scanner.tradingview.com/cfd/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: { tickers: ['PEPPERSTONE:GER40', 'CAPITALCOM:DE40', 'OANDA:DE30EUR', 'FOREXCOM:GER40', 'PEPPERSTONE:US500'] }, columns: ['close', 'update_mode', 'high', 'low'] }) });
  // 6. Ostium (perpetue on-chain pe indici)
  await get('ostium prices', 'https://metadata-backend.ostium.io/PricePublish/latest-prices', {}, (t) => { const a = JSON.parse(t); const x = a.filter((y) => /DAX|GER|DE40/i.test(JSON.stringify(y))); return JSON.stringify(x).slice(0, 300); });
  // 7. Yahoo: contractul futures DAX pe Eurex (alte simboluri)
  for (const y of ['FDAX%3DF', 'DY%3DF', '%5EGDAXI', 'DAX']) await get('yahoo ' + y, `https://query1.finance.yahoo.com/v8/finance/chart/${y}?interval=1m&range=1d`, {}, (t) => { const j = JSON.parse(t).chart.result[0]; const ts = j.timestamp; return `ultima lumânare acum ${age(ts[ts.length - 1] * 1000)}`; });
})();
