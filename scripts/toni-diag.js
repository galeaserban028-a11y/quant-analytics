'use strict';
// Diagnostic pentru sistemul de test Toni: datele Yahoo M15 pe fiecare piață + semnalele și rezultatele din ultimele ~60 de zile
// (aceleași reguli ca live) + un ciclu complet cu salvare/reîncărcare a stării. Nu trimite nimic pe Telegram.
const os = require('os'), fs = require('fs'), path = require('path');
const A = require('../src/strategies/amtAgent');
const { runToniCycle, stats } = require('../src/academy/toniLive');
const { applyContractSizes } = require('../src/propLive');
const MarketStateBus = require('../src/core/MarketStateBus');

const { fetchM15Toni: fetchBars } = require('../src/data/toniFeed');
(async () => {
  const cache = {};
  for (const [sym, mk] of Object.entries(A.MARKETS)) {
    try {
      const bars = (cache[sym] = await fetchBars(sym, mk));
      const S = A.sessions(bars, mk), full = S.filter((s) => s.full).length;
      const sig = A.findSignals(bars, mk); const T = [];
      for (const s of sig) { if (s.i + 1 >= bars.length) continue; const r = A.settle(bars, s.i + 1, s, mk); if (r && !r.invalid) T.push({ r: r.r }); }
      const st = stats(T);
      console.log(`::notice::${sym} (${mk.hl || mk.yahoo}${mk.v2 ? ', varianta 2' : ''}): ${bars.length} lumânări, ultima deschisă acum ${((Date.now() - bars[bars.length - 1].t) / 60000).toFixed(1)} min, sesiuni ${S.length} (complete ${full}), semnale 60 zile ${sig.length}, închise ${st.n}, media ${st.mean}R, total ${st.totalR}R`);
    } catch (err) { console.log(`::error::${sym}: ${err.message}`); }
  }
  // ciclu complet, de două ori, cu stare salvată pe disc între ele (ca în bucla live)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toni-')), 'state.json');
  const inst = applyContractSizes(require('../config/forex_instruments.json'), 'SPX500=50,NAS100=20,GER40=25');
  const msgs = [];
  for (let k = 0; k < 2; k++) {
    const bus = new MarketStateBus({}, { snapshotPath: file });
    const rep = await runToniCycle({ bus, instruments: inst, fetchBars: async (s) => cache[s] || [], notify: async (m) => msgs.push(m), now: Date.now(), env: {} });
    bus.saveSnapshot();
    console.log(`::notice::ciclul ${k + 1}: ${JSON.stringify({ opened: rep.opened, closed: rep.closed, errors: rep.errors, startedAt: bus.state.toni.startedAt, seen: Object.keys(bus.state.toni.seen).length })}`);
  }
  console.log(`::notice::mesaje trimise în diagnostic (ar trebui 0 sau doar rezumat): ${msgs.length}`);
})();
