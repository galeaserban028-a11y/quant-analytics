'use strict';

/**
 * GARDIANUL PROP: decide, pentru fiecare semnal nou, dacă ai voie să intri și cu ce risc, astfel încât
 * chiar dacă TOATE pozițiile deschise își ating stopul în aceeași zi, să NU încalci regulile firmei.
 * Aceeași funcție e folosită în simulatorul de examen și live (nu pot diverge).
 *
 * Reguli de siguranță (pe lângă regulile firmei):
 *  - buffer: folosim doar `safety` (implicit 70%) din limita zilnică și din limita totală;
 *  - după ce ținta fazei e atinsă → nu mai deschidem nimic, cu excepția pozițiilor minuscule (0,25%) cât lipsesc zilele minime;
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

  // Ținta atinsă: nu mai riscăm nimic serios. Dacă firma cere încă zile minime de tranzacționare,
  // permitem doar poziții minuscule (0,25% din cont), cât să bifăm zilele fără să punem examenul în pericol.
  const needsDays = rules.minDays && acct.tradingDays != null && acct.tradingDays < rules.minDays;
  if (hasTarget && balance >= targetBalance && !needsDays) {
    return { allow: false, riskAmount: 0, reason: 'ȚINTA_ATINSĂ' };
  }
  const onlyDays = hasTarget && balance >= targetBalance && needsDays;
  if (cfg.maxOpen != null && cfg.openCount >= cfg.maxOpen) {
    return { allow: false, riskAmount: 0, reason: 'PREA_MULTE_POZIȚII' };
  }

  // Riscul de bază, redus în drawdown
  let riskPct = cfg.riskPct;
  // Contul finanțat (fără țintă) poate merge cu risc mai mic: acolo contează să-l păstrezi, ca să încasezi lunar
  if (!hasTarget && cfg.fundedRiskPct != null) riskPct = Math.min(riskPct, cfg.fundedRiskPct);
  const dd = (initial - balance) / initial;
  // Reducerea în drawdown: implicit la jumătate sub −4% și la un sfert sub −6% (configurabil pentru cercetare)
  const steps = cfg.ddSteps || [[0.06, 0.25], [0.04, 0.5]];
  for (const [lvl, mult] of steps) { if (dd > lvl) { riskPct *= mult; break; } }
  // Opțional: altă mărime de risc când ești deja pe plus în fază (ex. protejezi câștigul sau apeși accelerația)
  if (hasTarget && cfg.ahead && balance >= initial * (1 + cfg.ahead[0])) riskPct *= cfg.ahead[1];
  // Nu risca mai mult decât lipsește până la țintă (+ puțin): evită să dai „tot” când ești aproape
  let risk = initial * riskPct / 100;
  if (hasTarget) risk = Math.min(risk, Math.max(initial * 0.0025, targetBalance - balance));
  if (onlyDays) risk = initial * 0.0025;

  // Limita totală (static sau trailing la final de zi)
  const floor = rules.maxLossType === 'trailingEod'
    ? Math.max(initial, acct.highestEod || initial) - initial * rules.maxLoss
    : initial * (1 - rules.maxLoss);
  const roomTotal = (balance - floor) * safety - acct.openRisk;
  // Limita zilnică: pierderea de azi + tot riscul deschis + riscul nou ≤ safety × limită
  const lostToday = Math.max(0, acct.dayStartBalance - balance);
  // Gap-urile peste stop (deschideri după știri/weekend) pot pierde mai mult de 1R: rezervăm `gapFactor` × riscul
  const g = cfg.gapFactor != null ? cfg.gapFactor : 1;
  const roomDaily = (initial * rules.dailyLoss * safety - lostToday - acct.openRisk * g) / g;

  const base = risk;
  risk = Math.min(risk, roomTotal, roomDaily);
  // Opțional: nu trimite poziții minuscule (ex. 4 $ când normal riști 200 $) — doar zgomot pe Telegram
  if (!onlyDays && cfg.minRiskFrac && risk < base * cfg.minRiskFrac) return { allow: false, riskAmount: 0, reason: roomDaily <= roomTotal ? 'LIMITA_ZILNICĂ' : 'LIMITA_TOTALĂ' };
  if (!(risk > initial * 0.0005)) return { allow: false, riskAmount: 0, reason: roomDaily <= roomTotal ? 'LIMITA_ZILNICĂ' : 'LIMITA_TOTALĂ' };
  return { allow: true, riskAmount: risk, reason: onlyDays ? 'ZILE_MINIME' : 'OK' };
}

module.exports = { decide };
