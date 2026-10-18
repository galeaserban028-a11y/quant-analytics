'use strict';

/**
 * GARDIANUL PROP: decide, pentru fiecare semnal nou, dacă ai voie să intri și cu ce risc, astfel încât
 * chiar dacă TOATE pozițiile deschise își ating stopul în aceeași zi, să NU încalci regulile firmei.
 * Aceeași funcție e folosită în simulatorul de examen și live (nu pot diverge).
 *
 * Reguli de siguranță (pe lângă regulile firmei):
 *  - buffer: folosim doar `safety` (implicit 70%) din limita zilnică și din limita totală;
 *  - după ce ținta fazei e atinsă → nu mai deschidem nimic (doar zilele minime, cu risc minuscul);
 *  - în drawdown riscul se reduce automat (la jumătate sub −4%, la un sfert sub −6%).
 *
 * @param {object} acct { initial, balance, dayStartBalance, openRisk, highestEod, phaseTarget, tradingDays }
 * @param {object} rules un element din PROP_RULES
 * @param {object} cfg { riskPct, safety, maxOpen, openCount }
 * @returns {{ allow: boolean, riskAmount: number, reason: string }}
 */
function decide(acct, rules, cfg) {
  const safety = cfg.safety != null ? cfg.safety : 0.7;
  const initial = acct.initial;
  const balance = acct.balance;
  const hasTarget = acct.phaseTarget != null; // contul finanțat nu are țintă
  const targetBalance = hasTarget ? initial * (1 + acct.phaseTarget) : Infinity;

  if (hasTarget && balance >= targetBalance) {
    return { allow: false, riskAmount: 0, reason: 'ȚINTA_ATINSĂ' };
  }
  if (cfg.maxOpen != null && cfg.openCount >= cfg.maxOpen) {
    return { allow: false, riskAmount: 0, reason: 'PREA_MULTE_POZIȚII' };
  }

  // Riscul de bază, redus în drawdown
  let riskPct = cfg.riskPct;
  const dd = (initial - balance) / initial;
  if (dd > 0.06) riskPct *= 0.25;
  else if (dd > 0.04) riskPct *= 0.5;
  // Nu risca mai mult decât lipsește până la țintă (+ puțin): evită să dai „tot” când ești aproape
  let risk = initial * riskPct / 100;
  if (hasTarget) risk = Math.min(risk, Math.max(initial * 0.0025, targetBalance - balance));

  // Limita totală (static sau trailing la final de zi)
  const floor = rules.maxLossType === 'trailingEod'
    ? Math.max(initial, acct.highestEod || initial) - initial * rules.maxLoss
    : initial * (1 - rules.maxLoss);
  const roomTotal = (balance - floor) * safety - acct.openRisk;
  // Limita zilnică: pierderea de azi + tot riscul deschis + riscul nou ≤ safety × limită
  const lostToday = Math.max(0, acct.dayStartBalance - balance);
  const roomDaily = initial * rules.dailyLoss * safety - lostToday - acct.openRisk;

  risk = Math.min(risk, roomTotal, roomDaily);
  if (!(risk > initial * 0.0005)) return { allow: false, riskAmount: 0, reason: roomDaily <= roomTotal ? 'LIMITA_ZILNICĂ' : 'LIMITA_TOTALĂ' };
  return { allow: true, riskAmount: risk, reason: 'OK' };
}

module.exports = { decide };
