'use strict';

const { getJson } = require('./http');
const { parseYahooChart, validOhlc } = require('./dailySources');

/**
 * Lumânări de 15 minute pentru sistemul Toni, cât mai LIVE:
 *  - Nasdaq, S&P 500, aur: Hyperliquid (piețele HIP-3 xyz:XYZ100 / xyz:SP500 / xyz:GOLD), gratuit, fără cont, fără întârziere;
 *    Yahoo (futures CME) întârzie ~12 minute, așa că rămâne doar rezervă dacă Hyperliquid nu răspunde;
 *  - EUR/USD, GBP/USD: Yahoo (forexul e live acolo);
 *  - DAX: Dukascopy (aceeași sursă ca datele de backtest; lumânările de 1 minut apar la ~1 minut după închidere, verificat
 *    19.11.2026 față de prețul live Ostium). Ultimele lumânări M15 se construiesc din M1, ca să nu așteptăm agregarea lor.
 *    Börse Frankfurt și Yahoo (ambele întârziate ~15 minute) rămân doar rezervă.
 *  - Dukascopy e și rezerva pentru S&P / Nasdaq când Hyperliquid nu răspunde (înaintea lui Yahoo, care e întârziat).
 */
const DUKA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function dukaPage(inst, interval, limit, ts) {
  const url = `https://freeserv.dukascopy.com/2.0/?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=${interval}&splits=true&stocks=true&limit=${limit}&time_direction=P&timestamp=${ts}&jsonp=_cb`;
  const r = await fetch(url, { headers: { 'User-Agent': DUKA_UA, Referer: 'https://freeserv.dukascopy.com/2.0/?path=chart/index&showUI=true&instrument=' + inst } });
  if (!r.ok) throw new Error(`DUKASCOPY_HTTP_${r.status}`);
  const t = await r.text();
  const a = JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')));
  if (!Array.isArray(a)) throw new Error('DUKASCOPY_FORMAT');
  return a.map((x) => ({ t: Number(x[0]), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]), c: Number(x[4]) })).filter((b) => b.h >= b.l && b.l > 0);
}
/** Lumânări M15 de la Dukascopy: istoric ~50 de zile (pagini de M15) + ultimele ore refăcute din M1 (doar sferturile încheiate). */
async function fetchM15Dukascopy(inst, now = Date.now()) {
  const M15 = 900e3, from = now - 50 * 864e5, map = new Map();
  let ts = now;
  for (let page = 0; page < 20 && ts > from; page++) {
    const a = await dukaPage(inst, '15MIN', 1000, ts);
    if (!a.length) break;
    for (const b of a) map.set(b.t, b);
    const oldest = Math.min(...a.map((b) => b.t));
    if (oldest >= ts) break;
    ts = oldest - 1;
  }
  // ultimele ~3 ore din M1: un sfert e încheiat dacă există deja un minut din sfertul următor
  const m1 = (await dukaPage(inst, '1MIN', 180, now)).sort((x, y) => x.t - y.t);
  if (m1.length) {
    const newest = m1[m1.length - 1].t, agg = new Map();
    for (const b of m1) {
      const k = Math.floor(b.t / M15) * M15, q = agg.get(k);
      if (!q) agg.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, n: 1 });
      else { q.h = Math.max(q.h, b.h); q.l = Math.min(q.l, b.l); q.c = b.c; q.n++; }
    }
    const firstFull = Math.floor(m1[0].t / M15) * M15 === m1[0].t ? m1[0].t : Math.floor(m1[0].t / M15) * M15 + M15;
    for (const q of agg.values()) if (q.t >= firstFull && q.t + M15 <= newest) map.set(q.t, { t: q.t, o: q.o, h: q.h, l: q.l, c: q.c });
  }
  const out = [...map.values()].filter((b) => b.t >= from).sort((x, y) => x.t - y.t);
  if (out.length < 300) throw new Error(`DUKASCOPY_DATE_INSUFICIENTE(${out.length})`);
  return out;
}
async function fetchM15Hyperliquid(coin) {
  const now = Date.now();
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: now - 52 * 864e5, endTime: now } }) });
  if (!r.ok) throw new Error(`HYPERLIQUID_HTTP_${r.status}`);
  const a = await r.json();
  if (!Array.isArray(a) || a.length < 300) throw new Error(`HYPERLIQUID_DATE_INSUFICIENTE(${Array.isArray(a) ? a.length : 0})`);
  return a.map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c) })).filter((b) => b.h >= b.l && b.l > 0);
}
/** Lumânări de 15 minute de la Börse Frankfurt (bursa oficială a DAX-ului), endpoint public de grafic, fără cont. */
async function fetchM15BoerseFrankfurt(symbol, now = Date.now()) {
  const url = `https://api.boerse-frankfurt.de/v1/tradingview/history?symbol=${encodeURIComponent(symbol)}&resolution=15&from=${Math.floor((now - 70 * 864e5) / 1000)}&to=${Math.floor(now / 1000)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`BOERSE_FRANKFURT_HTTP_${r.status}`);
  const j = await r.json();
  if (j.s !== 'ok' || !Array.isArray(j.t) || j.t.length < 300) throw new Error(`BOERSE_FRANKFURT_DATE_INSUFICIENTE(${Array.isArray(j.t) ? j.t.length : 0})`);
  return j.t.map((t, i) => ({ t: t * 1000, o: +j.o[i], h: +j.h[i], l: +j.l[i], c: +j.c[i] })).filter((b) => b.h >= b.l && b.l > 0);
}
async function fetchM15Toni(sym, mk) {
  if (mk.hl) {
    try { return await fetchM15Hyperliquid(mk.hl); } catch (err) { console.log(`Toni ${sym}: Hyperliquid indisponibil (${err.message}), încerc rezerva`); }
  }
  if (mk.duka) {
    try { const b = await fetchM15Dukascopy(mk.duka); b.source = 'dukascopy'; return b; } catch (err) { console.log(`Toni ${sym}: Dukascopy indisponibil (${err.message}), încerc rezerva (întârziată)`); }
  }
  if (mk.bf) {
    try { const b = await fetchM15BoerseFrankfurt(mk.bf); b.delayed = true; return b; } catch (err) { console.log(`Toni ${sym}: Börse Frankfurt indisponibil (${err.message}), folosesc Yahoo (întârziat)`); }
  }
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mk.yahoo)}?interval=15m&range=60d`, { retries: 1 });
  const y = validOhlc(parseYahooChart(d)).map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close }));
  if (!/=X$/.test(mk.yahoo)) y.delayed = true; // forexul e live pe Yahoo; indicii și futures-urile sunt întârziate
  return y;
}

module.exports = { fetchM15Toni, fetchM15Hyperliquid, fetchM15BoerseFrankfurt, fetchM15Dukascopy };
