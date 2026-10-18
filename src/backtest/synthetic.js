'use strict';

const { rng } = require('./metrics');
const { M15_MS } = require('../core/candles');

/**
 * Random walk realist (volatilitate variabilă în timp + sezonalitate pe sesiuni + cozi groase),
 * FĂRĂ niciun edge predictibil. Folosit ca test de sănătate: o strategie corect testată
 * NU trebuie să arate profit semnificativ pe zgomot pur. Dacă ar arăta, backtester-ul ar avea un bug.
 */
function generateRandomWalk({ seed = 1, days = 60, startPrice = 1.1, pipSize = 0.0001, baseVolPips = 6, weekdaysOnly = true, startTs = Date.UTC(2026, 0, 5) } = {}) {
  const r = rng(seed);
  const gauss = () => {
    const u = Math.max(1e-12, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out = [];
  let price = startPrice;
  let vol = 1;
  const bars = days * 96;
  for (let k = 0; k < bars; k++) {
    const ts = startTs + k * M15_MS;
    const d = new Date(ts);
    if (weekdaysOnly && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
    const h = d.getUTCHours();
    const session = h >= 7 && h < 21 ? 1.3 : 0.6;
    vol = Math.max(0.3, Math.min(3, vol + 0.05 * (1 - vol) + 0.08 * gauss())); // volatilitate cu memorie
    const sigma = baseVolPips * pipSize * vol * session;
    const tail = r() < 0.02 ? 3 : 1; // ocazional, mișcări mari
    const open = price;
    const close = open + gauss() * sigma * tail;
    const high = Math.max(open, close) + Math.abs(gauss()) * sigma * 0.6;
    const low = Math.min(open, close) - Math.abs(gauss()) * sigma * 0.6;
    out.push({ timestamp: ts, open, high, low, close, volume: Math.round(500 * vol * session * (0.7 + 0.6 * r())) });
    price = close;
  }
  return out;
}

/** Univers sintetic cu 6 perechi FX USD independente (ca indicele USD și filtrul de corelație să funcționeze). */
function generateSyntheticUniverse({ seed = 1, days = 60 } = {}) {
  const specs = [
    ['EURUSD', 1.1, 0.0001, 6], ['GBPUSD', 1.27, 0.0001, 7], ['AUDUSD', 0.66, 0.0001, 5],
    ['USDJPY', 150, 0.01, 7], ['USDCHF', 0.88, 0.0001, 5], ['USDCAD', 1.36, 0.0001, 5]
  ];
  const out = {};
  specs.forEach(([sym, price, pip, vol], i) => {
    out[sym] = generateRandomWalk({ seed: seed * 1000 + i, days, startPrice: price, pipSize: pip, baseVolPips: vol });
  });
  return out;
}

module.exports = { generateRandomWalk, generateSyntheticUniverse };
