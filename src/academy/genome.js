'use strict';

/**
 * ADN-ul unui agent din Academia Forex: familia de strategie, perechea valutară și parametrii.
 * Agenții se nasc la întâmplare (prima generație) sau din părinți buni, cu mici mutații.
 * Totul e determinist (seed), ca rezultatele să poată fi verificate și repetate.
 */

const FAMILIES = {
  rsi2: { name: 'Pullback RSI(2)', style: 'revenire', space: { trendLen: [0, 100, 200], entryRsi: [5, 10, 15, 20, 30], exitLen: [3, 5, 10], stopAtr: [1.5, 2, 3, 4], maxDays: [5, 10, 15], allowShort: [false, true] } },
  down: { name: 'Zile de scădere', style: 'revenire', space: { trendLen: [0, 100, 200], nDays: [2, 3, 4, 5], exitLen: [3, 5], stopAtr: [1.5, 2, 3, 4], maxDays: [5, 10], allowShort: [false, true] } },
  ibs: { name: 'Închidere la extremă (IBS)', style: 'revenire', space: { trendLen: [0, 200], ibsEntry: [0.1, 0.15, 0.2, 0.3], stopAtr: [1.5, 2, 3], maxDays: [3, 5], allowShort: [false, true] } },
  d7: { name: 'Minim de N zile', style: 'revenire', space: { trendLen: [0, 100, 200], lookback: [5, 7, 10, 15], stopAtr: [2, 3, 4], maxDays: [10, 15], allowShort: [false, true] } },
  bb: { name: 'Bandă Bollinger', style: 'revenire', space: { len: [10, 20, 30], k: [1.5, 2, 2.5], trendLen: [0, 200], stopAtr: [2, 3, 4], maxDays: [10, 20], allowShort: [false, true] } },
  mom: { name: 'Momentum', style: 'trend', space: { lookback: [20, 40, 60, 90, 120, 180, 250], stopAtr: [2, 3, 4, 5], maxDays: [250], allowShort: [true] } },
  donch: { name: 'Breakout Donchian', style: 'trend', space: { entryLen: [20, 40, 55, 80, 100], exitLen: [10, 20, 30], stopAtr: [2, 3, 4, 5], maxDays: [250], allowShort: [true] } },
  carry: { name: 'Carry (dobânzi)', style: 'dobânzi', space: { minDiff: [0.5, 1, 2, 3], trendLen: [0, 50, 100, 200], stopAtr: [3, 4, 5], maxDays: [250], allowShort: [true] } },
  macross: { name: 'Încrucișare de medii', style: 'trend', space: { fast: [10, 20, 50], slow: [50, 100, 200], stopAtr: [2, 3, 4, 5], maxDays: [250], allowShort: [true] } }
};

const FIRST = ['Andrei', 'Maria', 'Mihai', 'Elena', 'Radu', 'Ioana', 'Vlad', 'Ana', 'Cristian', 'Diana', 'Bogdan', 'Irina', 'Alexandru', 'Raluca', 'Tudor', 'Bianca', 'Matei', 'Sara', 'Ștefan', 'Larisa',
  'George', 'Andreea', 'Ionuț', 'Cristina', 'Florin', 'Alina', 'Dragoș', 'Simona', 'Marius', 'Roxana', 'Sorin', 'Oana', 'Adrian', 'Gabriela', 'Victor', 'Laura', 'Paul', 'Monica', 'Dan', 'Ramona',
  'Lucian', 'Teodora', 'Cosmin', 'Denisa', 'Răzvan', 'Corina', 'Ovidiu', 'Iulia', 'Silviu', 'Delia', 'Horia', 'Anca', 'Emil', 'Adina', 'Liviu', 'Camelia', 'Sebastian', 'Mădălina', 'Nicolae', 'Petra'];
const LAST = ['Popescu', 'Ionescu', 'Popa', 'Dumitru', 'Stan', 'Stoica', 'Gheorghe', 'Matei', 'Ciobanu', 'Rusu', 'Munteanu', 'Constantin', 'Marin', 'Tudor', 'Dobre', 'Barbu', 'Nistor', 'Florea', 'Ene', 'Dinu',
  'Lazăr', 'Toma', 'Moldovan', 'Sandu', 'Cristea', 'Ungureanu', 'Neagu', 'Mocanu', 'Oprea', 'Voicu', 'Radu', 'Ilie', 'Preda', 'Badea', 'Vasile', 'Sârbu', 'Iordache', 'Manole', 'Coman', 'Grigore'];

function pick(arr, r) { return arr[Math.floor(r() * arr.length) % arr.length]; }

function randomGenome(r, pairs, families = Object.keys(FAMILIES)) {
  const family = pick(families, r);
  const params = { kind: family };
  for (const [k, vals] of Object.entries(FAMILIES[family].space)) params[k] = pick(vals, r);
  return fix({ family, pair: pick(pairs, r), params });
}

/** O mutație mică: schimbă unul sau doi parametri cu o valoare vecină; uneori schimbă perechea. */
function mutate(g, r, pairs) {
  const child = { family: g.family, pair: g.pair, params: Object.assign({}, g.params) };
  const keys = Object.keys(FAMILIES[g.family].space).filter((k) => FAMILIES[g.family].space[k].length > 1);
  const n = r() < 0.6 ? 1 : 2;
  for (let i = 0; i < n && keys.length; i++) {
    const k = pick(keys, r);
    const vals = FAMILIES[g.family].space[k];
    const idx = vals.indexOf(child.params[k]);
    const step = r() < 0.5 ? -1 : 1;
    const j = idx < 0 ? Math.floor(r() * vals.length) : Math.min(vals.length - 1, Math.max(0, idx + step));
    child.params[k] = vals[j === idx ? (idx + 1) % vals.length : j];
  }
  if (r() < 0.25) child.pair = pick(pairs, r);
  return fix(child);
}

function fix(g) {
  if (g.family === 'macross' && g.params.fast >= g.params.slow) g.params.fast = Math.min(...FAMILIES.macross.space.fast.filter((v) => v < g.params.slow));
  if (g.family === 'donch' && g.params.exitLen >= g.params.entryLen) g.params.exitLen = Math.min(...FAMILIES.donch.space.exitLen);
  return g;
}

function genomeKey(g) {
  const p = Object.entries(g.params).filter(([k]) => k !== 'kind').map(([k, v]) => `${k}=${v}`).join(',');
  return `${g.pair}|${g.family}|${p}`;
}

/** Nume de om, unic în populație (prenume + nume, cu inițială la nevoie). */
function makeNamer(r) {
  const used = new Set();
  return () => {
    for (let t = 0; t < 50; t++) {
      const n = `${pick(FIRST, r)} ${pick(LAST, r)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    let k = 2;
    const base = `${pick(FIRST, r)} ${pick(LAST, r)}`;
    while (used.has(`${base} ${k}`)) k++;
    used.add(`${base} ${k}`);
    return `${base} ${k}`;
  };
}

function describe(g) {
  const p = g.params;
  switch (g.family) {
    case 'rsi2': return `cumpără${p.allowShort ? '/vinde' : ''} după o scădere bruscă (RSI2 < ${p.entryRsi})${p.trendLen ? ` în trend de ${p.trendLen} zile` : ''}; iese peste media de ${p.exitLen} zile`;
    case 'down': return `${p.nDays} zile la rând de scădere${p.trendLen ? ` în trend de ${p.trendLen} zile` : ''}; iese peste media de ${p.exitLen} zile`;
    case 'ibs': return `închidere în ultimii ${Math.round(p.ibsEntry * 100)}% ai zilei${p.trendLen ? ` în trend de ${p.trendLen} zile` : ''}; iese peste maximul de ieri`;
    case 'd7': return `închidere la minimul de ${p.lookback} zile${p.trendLen ? ` în trend de ${p.trendLen} zile` : ''}; iese la maximul de ${p.lookback} zile`;
    case 'bb': return `sub banda Bollinger (${p.len} zile, ${p.k} deviații); iese la medie`;
    case 'mom': return `în direcția mișcării pe ${p.lookback} zile; iese când se întoarce`;
    case 'donch': return `breakout la extrema de ${p.entryLen} zile; iese la extrema opusă de ${p.exitLen} zile`;
    case 'macross': return `media de ${p.fast} zile peste/sub media de ${p.slow} zile`;
    case 'carry': return `ține moneda cu dobânda mai mare (diferență ≥ ${p.minDiff} puncte)${p.trendLen ? ` doar în trendul de ${p.trendLen} zile` : ''}; primește swap`;
    default: return g.family;
  }
}

module.exports = { FAMILIES, randomGenome, mutate, genomeKey, makeNamer, describe, FIRST, LAST };
