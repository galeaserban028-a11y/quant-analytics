'use strict';

const { getJson } = require('./http');
const { parseYahooChart, validOhlc } = require('./dailySources');

/**
 * Lumânări de 15 minute pentru sistemul Toni, cât mai LIVE:
 *  - Nasdaq, S&P 500, aur: Hyperliquid (piețele HIP-3 xyz:XYZ100 / xyz:SP500 / xyz:GOLD), gratuit, fără cont, fără întârziere;
 *    Yahoo (futures CME) întârzie ~12 minute, așa că rămâne doar rezervă dacă Hyperliquid nu răspunde;
 *  - EUR/USD, GBP/USD: Yahoo (forexul e live acolo);
 *  - DAX: Yahoo ^GDAXI (întârzie ~15 minute; nu există o sursă live gratuită).
 */
async function fetchM15Hyperliquid(coin) {
  const now = Date.now();
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: now - 52 * 864e5, endTime: now } }) });
  if (!r.ok) throw new Error(`HYPERLIQUID_HTTP_${r.status}`);
  const a = await r.json();
  if (!Array.isArray(a) || a.length < 300) throw new Error(`HYPERLIQUID_DATE_INSUFICIENTE(${Array.isArray(a) ? a.length : 0})`);
  return a.map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c) })).filter((b) => b.h >= b.l && b.l > 0);
}
async function fetchM15Toni(sym, mk) {
  if (mk.hl) {
    try { return await fetchM15Hyperliquid(mk.hl); } catch (err) { console.log(`Toni ${sym}: Hyperliquid indisponibil (${err.message}), folosesc Yahoo (întârziat)`); }
  }
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mk.yahoo)}?interval=15m&range=60d`, { retries: 1 });
  return validOhlc(parseYahooChart(d)).map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close }));
}

module.exports = { fetchM15Toni, fetchM15Hyperliquid };
