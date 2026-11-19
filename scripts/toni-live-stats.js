'use strict';
// Statistica strategiei M15 pe prețurile din sursele LIVE: Dukascopy (2026, date pe care strategia nu le-a văzut) și Hyperliquid
// (ultimele ~50 de zile, exact ce vede sistemul live pentru US500/US100). Afișează fiecare tranzacție pe un rând TRADE.
const A = require('../src/strategies/amtAgent');
const F = require('../src/data/toniFeed');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function page(inst, ts) {
  const u = `https://freeserv.dukascopy.com/2.0/?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=15MIN&splits=true&stocks=true&limit=1000&time_direction=P&timestamp=${ts}&jsonp=_cb`;
  for (let k = 0; k < 3; k++) {
    try { const t = await (await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=' + inst } })).text();
      return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))).map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })); } catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw new Error('pagina a eșuat');
}
async function history(inst, from) {
  const m = new Map(); let ts = Date.now();
  while (ts > from) { const a = await page(inst, ts); if (!a.length) break; for (const b of a) m.set(b.t, b); const o = Math.min(...a.map((b) => b.t)); if (o >= ts) break; ts = o - 1; }
  return [...m.values()].filter((b) => b.h >= b.l && b.l > 0 && !(b.h === b.l && b.o === b.c)).sort((x, y) => x.t - y.t);
}
function run(tag, sym, bars, from) {
  const mk = A.MARKETS[sym]; let n = 0;
  for (const s of A.findSignals(bars, mk)) {
    if (s.t < from) continue;
    const r = A.settle(bars, s.i + 1, s, mk, Date.now());
    if (!r || r.invalid) continue;
    n++; console.log(`TRADE ${tag} ${sym} ${s.day} ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.inside ? (s.edge ? 'edge' : 'mid') : 'out'} ${r.outcome} ${r.r.toFixed(3)}`);
  }
  console.log(`INFO ${tag} ${sym}: ${bars.length} lumânări, de la ${new Date(bars[0].t).toISOString().slice(0, 10)} la ${new Date(bars[bars.length - 1].t).toISOString().slice(0, 16)}, ${n} tranzacții`);
}
(async () => {
  const from = Date.parse(process.env.FROM || '2026-01-01T00:00:00Z');
  for (const sym of ['SPX500', 'NAS100', 'GER40']) {
    try { run('duka', sym, await history(A.MARKETS[sym].duka, Date.parse(process.env.HIST || '2025-10-15')), from); } catch (e) { console.log(`INFO duka ${sym} EROARE ${e.message}`); }
    if (A.MARKETS[sym].hl) { try { const b = await F.fetchM15Hyperliquid(A.MARKETS[sym].hl); run('hl', sym, b, 0); } catch (e) { console.log(`INFO hl ${sym} EROARE ${e.message}`); } }
  }
})();
