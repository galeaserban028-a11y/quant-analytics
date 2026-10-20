'use strict';

/**
 * Regulile examenelor prop (verificate pe surse publice, sept.–oct. 2026; firmele le schimbă des —
 * VERIFICĂ întotdeauna pe site-ul firmei înainte de a cumpăra).
 *
 * Câmpuri:
 *  phases[]         ținta de profit pe fiecare fază (fracție din soldul inițial)
 *  dailyLoss        pierderea maximă pe zi (fracție din soldul inițial), măsurată față de soldul de la miezul nopții
 *  maxLoss          pierderea maximă totală (fracție din soldul inițial)
 *  maxLossType      'static' (față de soldul inițial) sau 'trailingEod' (față de cel mai mare sold de la final de zi)
 *  minDays          zile minime de tranzacționare pe fază
 *  split            procentul tău din profit pe contul finanțat
 *  fee10k           taxa aproximativă pentru un cont ~10.000 $ (USD)
 *  resetTz          fusul orar în care se resetează limita zilnică (miezul nopții la firmă)
 */
const PROP_RULES = {
  FTMO_2STEP: {
    name: 'FTMO 2-Step (Swing)', phases: [0.10, 0.05], dailyLoss: 0.05, maxLoss: 0.10, maxLossType: 'static',
    minDays: 4, split: 0.8, fee10k: 170, resetTz: 'Europe/Prague', notes: 'Fără limită de timp. Contul Swing permite poziții peste weekend.'
  },
  FUNDEDNEXT_STELLAR_2STEP: {
    name: 'FundedNext Stellar 2-Step', phases: [0.08, 0.05], dailyLoss: 0.05, maxLoss: 0.10, maxLossType: 'static',
    minDays: 5, split: 0.8, fee10k: 99, resetTz: 'UTC', notes: 'Cont 6.000 $ ≈ 59 $, 15.000 $ ≈ 119 $. Reset zilnic la miezul nopții UTC.'
  },
  THE5ERS_HIGH_STAKES: {
    name: 'The5ers High Stakes 2-Step', phases: [0.08, 0.05], dailyLoss: 0.05, maxLoss: 0.10, maxLossType: 'static',
    minDays: 3, split: 0.8, fee10k: 78, resetTz: 'Europe/Athens', notes: 'Varianta CLASICĂ (8% / 5%); ~70–78 $ pentru 10.000 $ (oct. 2026). Există și varianta „Nouă” 10% / 5%, mai ieftină (~62–69 $), dar mai lentă. Weekend permis, EA permise. Minim 3 zile cu cel puțin 0,5% profit.'
  },
  FUNDINGPIPS_2STEP: {
    name: 'FundingPips 2-Step', phases: [0.08, 0.05], dailyLoss: 0.05, maxLoss: 0.10, maxLossType: 'static',
    minDays: 3, split: 0.8, fee10k: 66, resetTz: 'Europe/Moscow', weekendFunded: false,
    notes: 'Aceleași ținte și limite ca The5ers, mai ieftin (~53–66 $). DAR pe contul finanțat pozițiile se închid automat vineri (sept. 2026), iar strategiile noastre țin până la 10 zile: nu e recomandat până nu se ridică restricția.'
  },
  FTMO_1STEP: {
    name: 'FTMO 1-Step', phases: [0.10], dailyLoss: 0.03, maxLoss: 0.10, maxLossType: 'trailingEod',
    minDays: 4, split: 0.9, fee10k: 150, resetTz: 'Europe/Prague', notes: 'Pierdere zilnică doar 3% și drawdown care urcă odată cu profitul. Mai greu pentru strategii cu serii de pierderi.'
  }
};

module.exports = { PROP_RULES };
