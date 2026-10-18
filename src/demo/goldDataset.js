'use strict';

/**
 * Set de date SINTETIC, construit manual, care reproduce un setup SMC "de manual" pe XAUUSD.
 * Folosit DOAR pentru demo și teste de regresie — NU dovedește nimic despre profitabilitate.
 *
 * Referință fixă: miercuri 2026-10-14 14:30 UTC (NY killzone), ca demo-ul să fie determinist.
 */
const REFERENCE_TIME = Date.UTC(2026, 9, 14, 14, 30, 0);

function buildInstitutionalGoldDataset(referenceTime = REFERENCE_TIME) {
  const h1Candles = [];
  for (let i = 0; i < 60; i++) {
    const open = Number((2610 + i * 0.65 + Math.sin(i / 3) * 1.2).toFixed(2));
    const close = Number((open + 0.55).toFixed(2));
    h1Candles.push({ timestamp: referenceTime - (60 - i) * 3600e3, open, high: Number((close + 0.9).toFixed(2)), low: Number((open - 0.6).toFixed(2)), close, volume: 1200 + (i % 7) * 110 });
  }

  // 15 lumânări de context înainte de structura propriu-zisă (necesare pentru fereastra ATR50 a 7A)
  const pre = [];
  for (let i = 0; i < 15; i++) {
    const open = 2651.2 + (i % 3) * 0.3;
    const close = open + (i % 2 ? -0.2 : 0.25);
    pre.push({ open, high: Math.max(open, close) + 0.7, low: Math.min(open, close) - 0.6, close, volume: 500 + (i % 4) * 20 });
  }

  const core = [];
  for (let i = 0; i < 40; i++) {
    let c;
    if (i < 25) {
      if (i === 12) c = { open: 2655.0, high: 2658.0, low: 2654.2, close: 2657.1, volume: 620 };
      else if (i === 18) c = { open: 2649.5, high: 2650.2, low: 2648.0, close: 2648.8, volume: 540 };
      else { const open = 2651.0 + (i % 4) * 0.4; c = { open, high: open + 1.05, low: open - 0.7, close: open + 0.25, volume: 480 + (i % 5) * 25 }; }
    } else if (i <= 33) {
      const open = 2649.4 + (i % 3) * 0.35;
      c = { open, high: i === 29 ? 2651.2 : open + 0.65, low: 2648.35, close: open + 0.2, volume: 490 };
    } else if (i === 34) c = { open: 2649.85, high: 2649.9, low: 2648.2, close: 2648.3, volume: 650 };        // ultima lumânare bearish
    else if (i === 35) c = { open: 2648.3, high: 2649.4, low: 2646.2, close: 2649.2, volume: 1150 };          // SWEEP sub 2648.00
    else if (i === 36) c = { open: 2649.2, high: 2652.3, low: 2649.15, close: 2652.1, volume: 1450 };         // displacement
    else if (i === 37) c = { open: 2652.1, high: 2652.6, low: 2650.4, close: 2651.6, volume: 780 };           // lasă FVG [2649.40–2650.40]
    else if (i === 38) c = { open: 2651.6, high: 2651.7, low: 2649.85, close: 2649.95, volume: 520 };         // pullback
    else c = { open: 2649.95, high: 2650.35, low: 2649.55, close: 2650.1, volume: 920 };                      // respingere în zonă
    core.push(c);
  }

  const all = pre.concat(core);
  // Ultima lumânare M15 s-a închis exact la referenceTime
  const m15Candles = all.map((c, idx) => Object.assign({ timestamp: referenceTime - (all.length - idx) * 15 * 60e3 }, c));

  return {
    spotBid: 2650.0,
    spotAsk: 2650.2,
    spotMid: 2650.1,
    spotTimestamp: referenceTime,
    usdBias: 'BEARISH_USD',
    newsFeedAvailable: true,
    newsEvents: [],
    h1Candles,
    m15Candles
  };
}

module.exports = { buildInstitutionalGoldDataset, REFERENCE_TIME };
