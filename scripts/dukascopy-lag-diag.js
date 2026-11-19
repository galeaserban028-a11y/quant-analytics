'use strict';
// Verifică sursa Dukascopy exact cum o folosește sistemul live: câte lumânări M15, cât de nouă e ultima, nivelurile de azi,
// și comparația cu Börse Frankfurt (întârziat) și Hyperliquid (S&P / Nasdaq). Rulează de 3 ori, la un minut distanță.
const F = require('../src/data/toniFeed');
const A = require('../src/strategies/amtAgent');
(async () => {
  for (let k = 0; k < 3; k++) {
    const now = Date.now();
    for (const sym of ['GER40', 'SPX500', 'NAS100']) {
      const mk = A.MARKETS[sym];
      try {
        const b = await F.fetchM15Dukascopy(mk.duka, now);
        const done = b.filter((x) => x.t + 900e3 <= now - 30e3), L = done[done.length - 1];
        const S = A.sessions(done, mk).filter((x) => x.full), prev = S[S.length - 1];
        const va = A.valueArea(done, prev.idx, done[prev.idx[0]].c * 0.0005);
        let cmp = '';
        if (sym === 'GER40') { const bf = await F.fetchM15BoerseFrankfurt(mk.bf, now); const m = new Map(bf.map((x) => [x.t, x])); const common = done.filter((x) => m.has(x.t)).slice(-200); const diff = common.map((x) => Math.abs(x.c - m.get(x.t).c)); cmp = ` | față de Börse Frankfurt: ${common.length} lumânări comune, dif. medie a close ${(diff.reduce((a, c) => a + c, 0) / diff.length).toFixed(1)} pct; ultima BF închisă: acum ${((now - bf[bf.length - 1].t) / 60000 - 15).toFixed(1)} min`; }
        if (mk.hl) { const h = await F.fetchM15Hyperliquid(mk.hl); const m = new Map(h.map((x) => [x.t, x])); const common = done.filter((x) => m.has(x.t)).slice(-200); const diff = common.map((x) => x.c - m.get(x.t).c); cmp = ` | față de Hyperliquid: ${common.length} comune, dif. medie ${(diff.reduce((a, c) => a + c, 0) / diff.length).toFixed(2)} pct`; }
        console.log(`::notice::#${k} ${sym}: ${b.length} lumânări M15 (${done.length} încheiate), prima ${new Date(b[0].t).toISOString().slice(0, 10)}; ultima încheiată s-a închis acum ${((now - L.t - 900e3) / 60000).toFixed(1)} min (close ${L.c}); sesiuni pline ${S.length}; ieri ${prev.day}: VAH ${va.VAH.toFixed(1)} POC ${va.POC.toFixed(1)} VAL ${va.VAL.toFixed(1)}${cmp}`);
      } catch (e) { console.log(`::notice::#${k} ${sym}: EROARE ${e.message}`); }
    }
    if (k < 2) await new Promise((r) => setTimeout(r, 60000));
  }
})();
