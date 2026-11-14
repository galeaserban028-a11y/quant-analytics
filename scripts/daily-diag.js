'use strict';
// Cât de aproape e fiecare indice de semnalele sistemului zilnic (RSI(2), 3 zile de scădere, Bollinger, minimul de 7 zile).
const { fetchDaily } = require('../src/data/dailySources');
const INST = require('../config/forex_instruments.json');
const desk = require('../config/promotions.json').prop.overrides.propDesk;
const sma = (a, n, i) => a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n;
function rsi2(c) { let g = 0, l = 0; const a = 1 / 2; let ag = null, al = null;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; const up = Math.max(0, d), dn = Math.max(0, -d);
    if (ag == null) { ag = up; al = dn; } else { ag = ag + a * (up - ag); al = al + a * (dn - al); } }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
(async () => {
  for (const sym of desk.symbols) {
    try {
      const { candles } = await fetchDaily(INST[sym], { now: Date.now() });
      const c = candles.map((b) => b.close), i = c.length - 1, last = c[i];
      const ma200 = sma(c, 200, i), m10 = sma(c, 10, i);
      const sd = Math.sqrt(c.slice(i - 9, i + 1).reduce((x, y) => x + (y - m10) ** 2, 0) / 10), bbLow = m10 - 1.5 * sd;
      let dn = 0; for (let k = i; k > 0 && c[k] < c[k - 1]; k--) dn++;
      const lo7 = Math.min(...c.slice(i - 6, i + 1));
      const r = rsi2(c.slice(-60));
      const day = new Date(candles[i].timestamp).toISOString().slice(0, 10);
      console.log(`::notice::${sym} (închiderea ${day}): ${last.toFixed(1)} | trend 200 zile: ${last > ma200 ? 'DA, peste' : 'NU, sub'} (${ma200.toFixed(0)}) | RSI2 ${r.toFixed(0)} (cumpără <20) | zile de scădere la rând: ${dn} (cumpără la 3) | Bollinger jos ${bbLow.toFixed(1)}, distanță ${(last - bbLow).toFixed(1)} | minim 7 zile ${lo7.toFixed(1)} ${last <= lo7 ? '(ATINS)' : `, distanță ${(last - lo7).toFixed(1)}`}`);
    } catch (e) { console.log(`::error::${sym}: ${e.message}`); }
  }
})();
