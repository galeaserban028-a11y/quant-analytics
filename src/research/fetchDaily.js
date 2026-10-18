'use strict';

/**
 * Descarcă istoricul ZILNIC (Yahoo, din 2000) pentru instrumentele din config/forex_instruments.json
 * care nu au încă fișier în data/fx/d1 (sau pentru toate, cu --all). Rulat de workflow-ul „APEX date”
 * pe GitHub, pentru că mediul de cercetare nu are acces direct la Yahoo.
 *
 *   node src/research/fetchDaily.js            → doar instrumentele lipsă
 *   node src/research/fetchDaily.js --all      → toate
 *   node src/research/fetchDaily.js EURAUD UK100
 */
const fs = require('fs');
const path = require('path');
const { loadDaily, D1_DIR } = require('./propRun');
const INSTRUMENTS = require('../../config/forex_instruments.json');

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const named = args.filter((a) => !a.startsWith('--'));
  const syms = Object.keys(INSTRUMENTS).filter((s) => !s.startsWith('_'))
    .filter((s) => (named.length ? named.includes(s) : all || !fs.existsSync(path.join(D1_DIR, `${s}.csv`))));
  let ok = 0;
  for (const s of syms) {
    try {
      const c = await loadDaily(s, INSTRUMENTS[s], true);
      console.log(`${s}: ${c.length} zile (${new Date(c[0].timestamp).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1].timestamp).toISOString().slice(0, 10)})`);
      ok += 1;
    } catch (err) { console.log(`${s}: EROARE ${err.message}`); }
  }
  console.log(`Gata: ${ok}/${syms.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
