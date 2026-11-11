'use strict';
// Ce surse GRATUITE, fără cont, dau prețuri LIVE (fără întârziere) de pe serverele GitHub? Măsoară întârzierea ultimei lumânări.
const get = async (url, opt = {}) => { const r = await fetch(url, Object.assign({ headers: { 'User-Agent': 'Mozilla/5.0' } }, opt)); const txt = await r.text(); return { status: r.status, txt }; };
const ago = (ms) => `${((Date.now() - ms) / 60000).toFixed(1)} min în urmă`;
const out = (k, v) => console.log(`::notice::${k}: ${v}`);
(async () => {
  // 1. Yahoo: cât întârzie de fapt
  for (const s of ['NQ=F', 'ES=F', 'GC=F', '^GDAXI', 'EURUSD=X', 'GBPUSD=X', '^NDX', '^GSPC']) {
    try { const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d`); const j = JSON.parse(r.txt).chart.result[0];
      const ts = j.timestamp; const m = j.meta; out(`Yahoo ${s}`, `ultima lumânare 1m ${ago(ts[ts.length - 1] * 1000)}, regularMarketTime ${ago(m.regularMarketTime * 1000)}, preț ${m.regularMarketPrice}, exchangeDataDelayedBy=${m.exchangeDataDelayedBy ?? '?'} ${m.exchangeName}`); }
    catch (e) { out(`Yahoo ${s}`, 'EROARE ' + e.message); }
  }
  // 2. Binance futures (TradFi perps)
  for (const host of ['https://fapi.binance.com', 'https://fapi1.binance.com']) {
    try { const r = await get(`${host}/fapi/v1/klines?symbol=XAUUSDT&interval=15m&limit=3`); out(`Binance ${host} XAUUSDT`, `HTTP ${r.status} ${r.status === 200 ? 'ultima lumânare deschisă ' + ago(JSON.parse(r.txt).slice(-1)[0][0]) + ', close ' + JSON.parse(r.txt).slice(-1)[0][4] : r.txt.slice(0, 150)}`); }
    catch (e) { out(`Binance ${host}`, 'EROARE ' + e.message); }
  }
  try { const r = await get('https://fapi.binance.com/fapi/v1/exchangeInfo'); if (r.status === 200) { const syms = JSON.parse(r.txt).symbols.filter((x) => x.status === 'TRADING').map((x) => x.symbol);
    out('Binance simboluri TradFi', syms.filter((s) => /XAU|XAG|NAS|NDX|SPX|SP500|US500|US100|DAX|GER|EUR|GBP|QQQ|SPY|US30|DJI/.test(s)).join(',')); } else out('Binance exchangeInfo', `HTTP ${r.status} ${r.txt.slice(0, 120)}`); }
  catch (e) { out('Binance exchangeInfo', 'EROARE ' + e.message); }
  // 3. Hyperliquid (HIP-3: piețe pe indici/aur)
  const hl = async (body) => { const r = await get('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r; };
  try { const r = await hl({ type: 'perpDexs' }); const dexs = JSON.parse(r.txt).filter(Boolean).map((d) => d.name); out('Hyperliquid dex-uri', dexs.join(','));
    for (const dex of dexs) { const m = await hl({ type: 'meta', dex }); const names = JSON.parse(m.txt).universe.map((u) => u.name); const pick = names.filter((n) => /100|500|SP|NDX|NAS|GOLD|XAU|DAX|GER|EUR|GBP|US30|DJ|JP|SILVER/i.test(n)); if (pick.length) out(`Hyperliquid ${dex}`, pick.join(',')); }
  } catch (e) { out('Hyperliquid', 'EROARE ' + e.message); }
  for (const coin of ['xyz:XYZ100', 'xyz:GOLD', 'xyz:SP500', 'xyz:US500']) {
    try { const r = await hl({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: Date.now() - 3 * 3600e3, endTime: Date.now() } }); const a = JSON.parse(r.txt);
      out(`Hyperliquid ${coin}`, Array.isArray(a) && a.length ? `${a.length} lumânări, ultima deschisă ${ago(a[a.length - 1].t)}, close ${a[a.length - 1].c}` : r.txt.slice(0, 120)); }
    catch (e) { out(`Hyperliquid ${coin}`, 'EROARE ' + e.message); }
  }
})();
