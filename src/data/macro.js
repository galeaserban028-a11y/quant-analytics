'use strict';

/**
 * Indice USD sintetic din coșul de perechi disponibile: media variațiilor procentuale H1 pe `lookback` ore,
 * cu semn inversat pentru perechile unde USD e valuta cotată (EURUSD urcă ⇒ USD slăbește).
 * Este un substitut transparent pentru DXY (care are ponderi diferite, dominate de EUR).
 */
function computeUsdBias(h1BySymbol, instruments, { lookback = 20, thresholdPct = 0.1 } = {}) {
  const contributions = [];
  for (const [symbol, h1] of Object.entries(h1BySymbol)) {
    const inst = instruments[symbol];
    if (!inst || !Array.isArray(h1) || h1.length < lookback + 1) continue;
    if (inst.category === 'INDICES_CRYPTO' || inst.category === 'GOLD_METALS') continue; // doar FX
    let sign = 0;
    if (inst.baseCurrency === 'USD') sign = 1;
    else if (inst.quoteCurrency === 'USD') sign = -1;
    if (!sign) continue;
    const now = h1[h1.length - 1].close;
    const then = h1[h1.length - 1 - lookback].close;
    if (!(then > 0)) continue;
    contributions.push(sign * ((now - then) / then) * 100);
  }
  if (contributions.length < 3) return { usdBias: null, usdStrengthPct: null, pairsUsed: contributions.length };
  const avg = contributions.reduce((s, v) => s + v, 0) / contributions.length;
  const usdBias = avg >= thresholdPct ? 'BULLISH_USD' : (avg <= -thresholdPct ? 'BEARISH_USD' : 'NEUTRAL');
  return { usdBias, usdStrengthPct: Number(avg.toFixed(3)), pairsUsed: contributions.length };
}

module.exports = { computeUsdBias };
