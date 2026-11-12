'use strict';
// Nivelurile zilei (VAH, VAL, POC din sesiunea completă precedentă) + ultimul preț, pentru indicii strategiei M15.
const A = require('../src/strategies/amtAgent');
const { fetchM15Toni } = require('../src/data/toniFeed');
(async () => {
  for (const sym of ['SPX500', 'NAS100', 'GER40']) {
    const mk = A.MARKETS[sym];
    try {
      const bars = (await fetchM15Toni(sym, mk)).filter((b) => b.t + 900e3 <= Date.now());
      const S = A.sessions(bars, mk).filter((s) => s.full);
      const today = A.local(Date.now(), mk.tz).day;
      const prev = S.filter((s) => s.day < today).pop();
      const bin = bars[prev.idx[0]].c * 0.0005;
      const { VAH, VAL, POC } = A.valueArea(bars, prev.idx, bin);
      const last = bars[bars.length - 1];
      const hi = Math.max(...prev.idx.map((i) => bars[i].h)), lo = Math.min(...prev.idx.map((i) => bars[i].l));
      console.log(`::notice::${sym} sesiunea ${prev.day}: VAH ${VAH.toFixed(1)} VAL ${VAL.toFixed(1)} POC ${POC.toFixed(1)} (max ${hi.toFixed(1)} min ${lo.toFixed(1)}) | ultimul preț ${last.c.toFixed(1)} la ${new Date(last.t + 900e3).toISOString()} | sursa ${mk.hl || mk.yahoo}`);
    } catch (e) { console.log(`::error::${sym}: ${e.message}`); }
  }
})();
