'use strict';

/**
 * Calculul lotului pentru un risc în USD și o distanță de stop în preț.
 *   valoare_per_lot_per_unitate_de_preț (în USD) = contractSize × (1 USD per unitate de monedă cotată)
 *   lot = risc_USD / (distanță_stop × contractSize × conversie_cotată→USD)
 * Exemple: EURUSD (cotată USD): conversie 1. USDJPY (cotată JPY): conversie = 1 / USDJPY. GER40 (cotat EUR): conversie = EURUSD.
 * Rotunjim în JOS la 0.01 loturi (niciodată nu riscăm mai mult decât trebuie).
 */
const PAIR_FOR = { JPY: ['USDJPY', true], CAD: ['USDCAD', true], CHF: ['USDCHF', true], GBP: ['GBPUSD', false], EUR: ['EURUSD', false], AUD: ['AUDUSD', false], NZD: ['NZDUSD', false] };

/** Câți USD valorează o unitate din moneda cotată, din prețurile curente. */
function quoteToUsd(quote, prices) {
  if (quote === 'USD') return 1;
  const m = PAIR_FOR[quote];
  if (!m) return null;
  const px = prices[m[0]];
  if (!(px > 0)) return null;
  return m[1] ? 1 / px : px;
}

function lotsFor(inst, riskUsd, stopDistance, prices) {
  const conv = quoteToUsd(inst.quoteCurrency, prices);
  if (!conv || !(stopDistance > 0) || !(riskUsd > 0)) return { lots: 0, ok: false, reason: 'CONVERSIE_LIPSĂ' };
  const perLot = stopDistance * (inst.contractSize || 1) * conv; // USD pierduți cu 1 lot dacă se atinge stopul
  const raw = riskUsd / perLot;
  const lots = Math.floor(raw * 100) / 100;
  if (lots < 0.01) return { lots: 0, ok: false, reason: 'LOT_SUB_MINIM', rawLots: raw, perLotRiskUsd: perLot };
  return { lots, ok: true, rawLots: raw, perLotRiskUsd: perLot, actualRiskUsd: lots * perLot };
}

module.exports = { lotsFor, quoteToUsd };
