'use strict';
// Descarcă lumânări M15 de la Dukascopy (freeserv) și le scrie lunar în data/fx/dk/m15/<FILE>_<an>_<lună>.csv.gz,
// în același format ca istoricul (timestamp,open,high,low,close,spread). FROM=yyyy-mm-dd (implicit 2025-12-01).
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const ALL = { 'USA500.IDX/USD': 'USA500IDXUSD', 'USATECH.IDX/USD': 'USATECHIDXUSD', 'DEU.IDX/EUR': 'DEUIDXEUR', 'USA30.IDX/USD': 'USA30IDXUSD',
  'GBR.IDX/GBP': 'GBRIDXGBP', 'JPN.IDX/JPY': 'JPNIDXJPY', 'FRA.IDX/EUR': 'FRAIDXEUR', 'EUS.IDX/EUR': 'EUSIDXEUR', 'XAU/USD': 'XAUUSD', 'EUR/USD': 'EURUSD', 'GBP/USD': 'GBPUSD' };
// INST=listă separată prin virgulă (implicit primii 4, indicii semnalelor)
const LIST = process.env.INST ? Object.fromEntries(process.env.INST.split(',').map((x) => [x.trim(), ALL[x.trim()]])) : Object.fromEntries(Object.entries(ALL).slice(0, 4));
async function page(inst, ts) {
  const u = `https://freeserv.dukascopy.com/2.0/?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=15MIN&splits=true&stocks=true&limit=1000&time_direction=P&timestamp=${ts}&jsonp=_cb`;
  for (let k = 0; k < 4; k++) {
    try { const t = await (await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=' + inst } })).text();
      return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))); } catch (e) { await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw new Error('pagina a eșuat ' + inst);
}
(async () => {
  const from = Date.parse(process.env.FROM || '2025-12-01'), dir = path.join(__dirname, '..', 'data', 'fx', 'dk', 'm15');
  for (const [inst, file] of Object.entries(LIST)) {
    const m = new Map(); let ts = Date.now();
    while (ts > from) { const a = await page(inst, ts); if (!a.length) break; for (const x of a) m.set(+x[0], x); const o = Math.min(...a.map((x) => +x[0])); if (o >= ts) break; ts = o - 1; }
    const now = Date.now(), byMonth = {};
    for (const x of [...m.values()].sort((p, q) => p[0] - q[0])) {
      if (x[0] < from || x[0] + 900e3 > now) continue; // doar lumânări încheiate
      const d = new Date(x[0]), k = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      (byMonth[k] = byMonth[k] || []).push(`${x[0]},${(+x[1]).toFixed(4)},${(+x[2]).toFixed(4)},${(+x[3]).toFixed(4)},${(+x[4]).toFixed(4)},0`);
    }
    for (const [k, rows] of Object.entries(byMonth)) {
      fs.writeFileSync(path.join(dir, `${file}_${k}.csv.gz`), zlib.gzipSync('timestamp,open,high,low,close,spread\n' + rows.join('\n') + '\n'));
      console.log(`${file}_${k}: ${rows.length} lumânări`);
    }
  }
})();
