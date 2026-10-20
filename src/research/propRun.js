'use strict';

/**
 * Cercetare pentru DEPARTAMENTUL PROP (indici, grafic zilnic), mai multe strategii:
 *  1) walk-forward anual pentru FIECARE strategie candidată (antrenare 3 ani → test anul următor);
 *     validarea folosește execuția PRUDENTĂ: intrare/ieșire a doua zi la deschidere (cum execută un om dimineața);
 *  2) intră în portofoliu doar strategiile cu nivel de validare LIVE/DEMO;
 *  3) simulatorul de examen pe tranzacțiile out-of-sample combinate, pentru fiecare firmă și nivel de risc;
 *  4) alege riscul cu cea mai bună valoare așteptată, cu condiția ca șansa de a PICA să fie ≤ 5%.
 *
 *   npm run research:prop                → folosește data/fx/d1/*.csv (le descarcă dacă lipsesc)
 *   npm run research:prop -- --refresh   → re-descarcă istoricul zilnic (Yahoo, din 2000)
 *   npm run research:prop -- --apply     → activează departamentul DOAR dacă trece validarea
 *
 * De ce doar indici: datele zilnice gratuite pentru Forex (Yahoo) au închiderea nealiniată cu maximul/minimul zilei
 * (verificat pe lumânări reconstruite din date orare), iar Forex-ul pierde cu execuție realistă. Indicii au date de bursă.
 */
const fs = require('fs');
const path = require('path');
const { loadCsv, DATA_DIR } = require('../backtest/dataLoader');
const { cleanSpikes, normalizeCandles } = require('../core/candles');
const { getJson } = require('../data/http');
const { parseYahooChart, validOhlc } = require('../data/dailySources');
const lab = require('../strategies/dailyLab');
const { teamWalkForward, STAFF } = require('./team');
const { monthDistribution, journey } = require('./scenario');
const { validationLevel } = require('./walkforward');
const { simulateChallenges } = require('../prop/challengeSim');
const { PROP_RULES } = require('../prop/rules');
const { portfolioSim } = require('./portfolio');
const { computeMetrics } = require('../backtest/metrics');
const { writePromotionSection } = require('../config');
const { sendTelegram } = require('../notify/telegram');

const D1_DIR = path.join(DATA_DIR, 'fx', 'd1');
const INSTRUMENTS = require('../../config/forex_instruments.json');
const DAY = 864e5;
const UNIVERSE = ['INDEX'];
// Banca: judecată pe ultimii 5 ani (testat walk-forward pe 20 oct. 2026 față de 3 ani: aceeași valoare așteptată,
// trecere 53% vs 48%, picare 2,3% vs 3,7%, median 240 vs 251 zile; o fereastră mai lungă = mai puțin zgomot).
const BENCH_RULE = { years: 5, belowR: -0.05, minTrades: 15 };
// Modurile de viteză alese de utilizator (simulate pe 20 oct. 2026, The5ers): sigur 3% → median ~8 luni, pică ~2%;
// echilibrat 4% → ~6 luni, pică ~5%; rapid 5% → ~5 luni, pică ~19%. Peste 5%: pică ~80%, câștig mediu negativ.
const PROP_MODES = {
  sigur: { risks: [3], safeties: [0.7], maxOpens: [5] },
  echilibrat: { risks: [4], safeties: [0.8], maxOpens: [5] },
  rapid: { risks: [5], safeties: [0.9], maxOpens: [5] }
};
const AGENTS_CONFIG = require('../../config/agents_config.json');

/** Strategiile candidate și grilele lor (alegerea parametrilor se face DOAR pe anii de antrenare). */
const STRATEGIES = {
  rsi2: {
    name: 'Pullback RSI(2)',
    grid: (() => {
      const g = [];
      for (const trendLen of [100, 200]) for (const entryRsi of [5, 10, 20]) for (const exitLen of [3, 5]) for (const stopAtr of [2, 3, 4]) for (const allowShort of [false, true]) {
        g.push({ kind: 'rsi2', trendLen, entryRsi, exitLen, stopAtr, maxDays: 10, allowShort });
      }
      return g;
    })()
  },
  down: {
    name: '3 zile de scădere',
    grid: (() => {
      const g = [];
      for (const trendLen of [100, 200]) for (const nDays of [3, 4]) for (const exitLen of [3, 5]) for (const stopAtr of [2, 3]) for (const allowShort of [false, true]) {
        g.push({ kind: 'down', trendLen, nDays, exitLen, stopAtr, maxDays: 10, allowShort });
      }
      return g;
    })()
  },
  bb: {
    name: 'Banda Bollinger',
    grid: (() => {
      const g = [];
      for (const len of [10, 20]) for (const k of [1.5, 2, 2.5]) for (const trendLen of [0, 200]) for (const stopAtr of [2, 3, 4]) for (const allowShort of [false, true]) {
        g.push({ kind: 'bb', len, k, trendLen, stopAtr, maxDays: 10, allowShort });
      }
      return g;
    })()
  },
  d7: {
    name: 'Minimul de N zile',
    grid: (() => {
      const g = [];
      for (const trendLen of [100, 200]) for (const lookback of [5, 7, 10]) for (const stopAtr of [2, 3, 4]) for (const maxDays of [10, 15]) {
        g.push({ kind: 'd7', trendLen, lookback, stopAtr, maxDays, allowShort: false });
      }
      return g;
    })()
  }
};
// Respinse după testare (păstrate în raport ca să nu le mai încercăm orbește): IBS (0 pe indici; „miracolul” de pe Forex
// era un defect de date), trend (momentum, breakout Donchian, încrucișare de medii: negative pe indici cu execuție
// prudentă), efectul de sfârșit de lună (≈0 după costuri). Banda Bollinger și Minimul de N zile au fost adăugate pe
// 20 octombrie 2026, după ce au trecut același walk-forward (și Bollinger chiar cu costuri duble).
// Testate tot pe 20 oct. 2026 și NEADĂUGATE: RSI cumulat (crsi) și canalul Keltner (kc) trec singure (E ≈ +0,06…+0,08R),
// dar adăugate la cele 4 înrăutățesc examenul (trece 37% în loc de 47%, pică 9% în loc de 5%): semnale pe aceleași zile
// proaste, deci pierderi grupate. Minimele descrescătoare (ll) nu trec nici singure. Semnalele „de consens” (2–4 traderi
// pe același indice) nu sunt mai bune decât cele singulare.
const GRID = STRATEGIES.rsi2.grid; // compatibilitate

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}

async function loadDaily(symbol, inst, refresh) {
  const file = path.join(D1_DIR, `${symbol}.csv`);
  if (!refresh && fs.existsSync(file)) return cleanSpikes(loadCsv(file));
  try {
    return await downloadDaily(file, inst);
  } catch (err) {
    // Yahoo refuză uneori serverele cloud: continuăm cu istoricul salvat (mai vechi cu o lună, dar valid)
    if (fs.existsSync(file)) { console.log(`  ${symbol}: descărcare eșuată (${err.message}), folosesc istoricul salvat`); return cleanSpikes(loadCsv(file)); }
    throw err;
  }
}

async function downloadDaily(file, inst) {
  const now = Math.floor(Date.now() / 1000);
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?interval=1d&period1=946684800&period2=${now}`);
  const candles = validOhlc(normalizeCandles(parseYahooChart(d)));
  fs.mkdirSync(D1_DIR, { recursive: true });
  fs.writeFileSync(file, 'timestamp,open,high,low,close,volume\n' + candles.map((c) => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},0`).join('\n') + '\n');
  return cleanSpikes(candles);
}

function nextFirstOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 2, 30));
}

const fmt = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v).toFixed(d));

/** Alege riscul: cea mai bună valoare așteptată, cu P(pică) ≤ 5%. */
function chooseRisk(trades, rules, opts = {}) {
  const table = [];
  for (const riskPct of opts.risks || [2, 3, 4]) {
    for (const safety of opts.safeties || [0.6, 0.7]) {
      for (const maxOpen of opts.maxOpens || [3, 5]) {
        const r = simulateChallenges(trades, rules, { riskPct, safety, maxOpen }, { horizonDays: 1095, fundedMonths: 12, stepDays: 14, orderSeeds: opts.orderSeeds || 8 }); // EV = P(trece) × plăți în primele 12 luni − taxa
        if (r) table.push(Object.assign({ safety, maxOpen }, r));
      }
    }
  }
  return { best: pickBest(table), table };
}

/** Ordinea firmelor: valoarea așteptată; la egalitate practică (diferență ≤ 3%) câștigă cea la care treci mai repede. */
function rankFirms(a, b) {
  const ea = a.expectedValuePerAttempt, eb = b.expectedValuePerAttempt;
  if (Math.abs(ea - eb) <= 0.03 * Math.max(Math.abs(ea), Math.abs(eb), 1)) return (b.passWithin180Pct - a.passWithin180Pct) || (a.failPct - b.failPct) || (eb - ea);
  return eb - ea;
}

/**
 * Alegerea variantei: doar cele cu P(pică) ≤ 5% (dacă nu există niciuna: dintre toate). Dintre ele, cele cu valoare
 * așteptată practic egală cu cea mai bună (cel mult 5% sub ea); iar dintre acestea, cea la care treci CEL MAI REPEDE
 * (șansa de a trece în ≤1 an, apoi în ≤6 luni). Așa nu plătim viteza cu bani pierduți în medie.
 */
function pickBest(table, maxFailPct = 5, evTolerance = 0.05) {
  const ok = table.filter((r) => r.failPct <= maxFailPct);
  const pool = ok.length ? ok : table;
  const top = Math.max(...pool.map((r) => r.expectedValuePerAttempt));
  const near = pool.filter((r) => r.expectedValuePerAttempt >= top - evTolerance * Math.abs(top));
  const speed = (r) => [r.passWithin365Pct || 0, r.passWithin180Pct || 0];
  return near.slice().sort((a, b) => (speed(b)[0] - speed(a)[0]) || (speed(b)[1] - speed(a)[1]) || (b.expectedValuePerAttempt - a.expectedValuePerAttempt) || (a.failPct - b.failPct))[0];
}

/** Simulatorul folosit în validare: execuție prudentă (a doua zi la deschidere). */
const prudentSim = (data, inst, params, o) => lab.simulate(data, inst, params, Object.assign({}, o, { execution: 'nextOpen' }));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = {};
  for (const [s, inst] of Object.entries(INSTRUMENTS)) {
    if (s.startsWith('_') || !UNIVERSE.includes(inst.category)) continue;
    try {
      const c = await loadDaily(s, inst, Boolean(args.refresh));
      if (c.length > 1500) data[s] = c; else console.log(`  ${s}: prea puține date (${c.length})`);
    } catch (err) { console.log(`  ${s}: ${err.message}`); }
  }
  if (Object.keys(data).length < 4) { console.log('Prea puține instrumente cu date.'); process.exitCode = 1; return; }

  const team = teamWalkForward(data, INSTRUMENTS, STRATEGIES, prudentSim, { trainYears: 3, minTrades: 40, bench: BENCH_RULE, log: (m) => console.log(m.slice(0, 220)) });
  const results = {};
  for (const [kind, st] of Object.entries(STRATEGIES)) {
    const S = team.byStrategy[kind];
    const oos = computeMetrics(S.oos);
    const level = validationLevel(oos, { expectancyR: 0 });
    results[kind] = { name: st.name, oos, folds: S.folds, level, params: S.latest ? S.latest.params : st.grid[0], trades: S.oos };
    console.log(`${st.name}: OOS ${oos.trades} tranzacții, E=${fmt(oos.expectancyR)}R (IC95% ${fmt(oos.expectancyCI95[0])} … ${fmt(oos.expectancyCI95[1])}) → ${level}`);
  }
  const accepted = Object.entries(results).filter(([, r]) => r.level !== 'NIMIC');
  const acceptedKinds = accepted.map(([k]) => k);
  const trades = accepted.flatMap(([, r]) => r.trades);
  const combined = computeMetrics(trades);
  const level = accepted.length ? validationLevel(combined, { expectancyR: 0 }) : 'NIMIC';
  const port = trades.length ? portfolioSim(trades, { riskPct: 1, maxOpen: 5, maxOpenRiskPct: 5 }) : null;

  const firms = {};
  const mode = PROP_MODES[args.mode || AGENTS_CONFIG.propMode] || null; // modul ales de utilizator (viteză vs. siguranță)
  if (mode) console.log(`Mod: ${args.mode || AGENTS_CONFIG.propMode} (risc ${mode.risks[0]}%, siguranță ${mode.safeties[0]})`);
  if (trades.length) for (const [key, rules] of Object.entries(PROP_RULES)) firms[key] = chooseRisk(trades, rules, mode || {});
  const ranking = Object.entries(firms).map(([k, v]) => ({ key: k, ...v.best })).sort(rankFirms);
  const top = ranking[0] || {};
  const agents = team.agents.filter((a) => acceptedKinds.includes(a.strategy));
  const proposed = {
    enabled: level !== 'NIMIC',
    firm: top.key,
    riskPct: top.riskPct,
    safety: top.safety,
    maxOpen: top.maxOpen,
    strategies: accepted.map(([kind, r]) => ({ kind, name: r.name, params: r.params })),
    symbols: Object.keys(data),
    benched: agents.filter((a) => a.status === 'BANCĂ').map((a) => a.id),
    expectedR: combined.expectancyR // folosit de frâna de urgență live
  };

  // Scenarii (cu configurația aleasă)
  let scenario = null;
  if (top.key) {
    const rules = PROP_RULES[top.key];
    const cfg = { riskPct: top.riskPct, safety: top.safety, maxOpen: top.maxOpen };
    scenario = {
      firm: rules.name, config: cfg, fee: top.fee,
      challengeMonth: monthDistribution(trades, rules, cfg, { target: rules.phases[0] }),
      fundedMonth: monthDistribution(trades, rules, cfg, { target: null }),
      journey: journey(trades, rules, cfg, { months: 12, fee: top.fee })
    };
    const cm = scenario.challengeMonth, fm = scenario.fundedMonth;
    console.log(`Luna în examen: mediană ${cm.median}$ (10% ${cm.p10}$ … 90% ${cm.p90}$), pe plus ${cm.positivePct}%, semnale ~${cm.tradesMedian}`);
    console.log(`Luna pe finanțat: mediană ${fm.median}$ (10% ${fm.p10}$ … 90% ${fm.p90}$), pe plus ${fm.positivePct}%`);
    for (const m of scenario.journey.byMonth.filter((x) => [1, 3, 6, 9, 12].includes(x.month))) console.log(`  luna ${m.month}: faza1 ${m.phase1Pct}% faza2 ${m.phase2Pct}% finanțat ${m.fundedPct}% picat ${m.failedPct}% | încasat mediu ${m.cumPayoutAvg}$`);
  }

  console.log(`\nPortofoliu: ${combined.trades} tranzacții, E=${fmt(combined.expectancyR)}R → ${level}`);
  for (const r of ranking) console.log(`  ${r.rules.padEnd(28)} risc ${r.riskPct}% (siguranță ${r.safety}, max ${r.maxOpen} poziții): trece ${r.passPct}% | pică ${r.failPct}% | zile mediane ${r.medianDaysToPass} | ≤6 luni ${r.passWithin180Pct}% | EV ${r.expectedValuePerAttempt}$`);

  const L = [];
  L.push(`# Raport — Departamentul PROP (indici, grafic zilnic, ${Object.keys(STRATEGIES).length} strategii candidate)`);
  L.push('');
  L.push(`Generat: ${new Date().toISOString()} · ${Object.keys(data).length} indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere`);
  L.push('');
  L.push('## 1. Strategiile (out-of-sample)');
  L.push('');
  L.push('| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |');
  L.push('|---|---|---|---|---|---|');
  for (const r of Object.values(results)) {
    const o = r.oos;
    L.push(`| ${r.name} | ${o.trades} | ${o.winRatePct}% | ${fmt(o.expectancyR)} (${fmt(o.expectancyCI95[0])} … ${fmt(o.expectancyCI95[1])}) | ${r.folds.filter((f) => f.oos.expectancyR > 0).length}/${r.folds.length} | **${r.level}** |`);
  }
  L.push(`| **Portofoliu** | ${combined.trades} | ${combined.winRatePct}% | ${fmt(combined.expectancyR)} | – | **${level}** |`);
  L.push('');
  if (port) L.push(`Portofoliu la risc 1%/tranzacție (fără reguli prop): ${port.cagrPct}% pe an, scădere maximă ${port.maxDrawdownPct}%.`);
  L.push('');
  L.push('Respinse după testare: Forex (fără avantaj real pe date Dukascopy), IBS (≈0 pe indici), strategiile de trend (momentum, breakout, medii: negative pe indici), sfârșit de lună (≈0 după costuri).');
  L.push('');
  L.push(`## 2. Șansele la examen (${top.attempts || 0} date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)`);
  L.push('');
  L.push('| Firmă | Risc | Trece | Pică | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of ranking) L.push(`| ${r.rules} | ${r.riskPct}% (siguranță ${r.safety}, max ${r.maxOpen} poz.) | **${r.passPct}%** | ${r.failPct}% | ${r.medianDaysToPass ?? '–'} | ${r.passWithin180Pct}% | ${r.passWithin365Pct}% | ${r.fee}$ | ${r.expectedValuePerAttempt}$ |`);
  L.push('');
  if (top.rules) L.push(`**Recomandare:** ${top.rules}, risc ${top.riskPct}% pe tranzacție, Gardianul Prop activ.`);
  L.push('');
  L.push('## 3. Echipa (strategie × indice)');
  L.push('');
  L.push('| Trader | Strategie | Indice | Status | Tranzacții OOS | Câștigătoare | R / tranzacție | Ani pe plus | Ultimii 5 ani |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const a of agents) L.push(`| ${a.name} | ${a.strategyName} | ${a.symbol} | ${a.status} | ${a.record.trades} | ${a.record.winRatePct}% | ${fmt(a.record.expectancyR)} | ${a.record.yearsPositive}/${a.record.years} | ${fmt(a.last3y.expectancyR)} (${a.last3y.trades}) |`);
  L.push('');
  L.push('Regula băncii (testată walk-forward): un trader care a pierdut peste 0,05R pe tranzacție în ultimii 5 ani (minim 15 tranzacții) stă pe bancă până își revine.');
  L.push('');
  if (scenario) {
    const cm = scenario.challengeMonth, fm = scenario.fundedMonth;
    L.push('## 4. Scenarii (cont 10.000 $)');
    L.push('');
    L.push(`- **O lună în examen:** mediană ${cm.median} $; 1 lună din 10 sub ${cm.p10} $, 1 din 10 peste ${cm.p90} $; ${cm.positivePct}% din luni pe plus; ~${cm.tradesMedian} tranzacții pe lună.`);
    L.push(`- **O lună pe contul finanțat (înainte de split):** mediană ${fm.median} $; 1 din 10 sub ${fm.p10} $, 1 din 10 peste ${fm.p90} $; ${fm.positivePct}% din luni pe plus.`);
    L.push('');
    L.push('| Luna | Încă în faza 1 | În faza 2 | Finanțat | Picat | Încasat cumulat (medie) |');
    L.push('|---|---|---|---|---|---|');
    for (const m of scenario.journey.byMonth) L.push(`| ${m.month} | ${m.phase1Pct}% | ${m.phase2Pct}% | ${m.fundedPct}% | ${m.failedPct}% | ${m.cumPayoutAvg} $ |`);
    L.push('');
  }
  L.push('## Configurația propusă');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(proposed, null, 2));
  L.push('```');
  L.push('');
  L.push('Limitări: date zilnice gratuite (Yahoo, de bursă pentru indici); capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare. Dacă intri imediat după mesaj (la ~10 minute după închidere), rezultatele sunt de obicei mai bune decât estimarea prudentă de aici.');

  const outDir = path.join(DATA_DIR, 'research');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'RAPORT_PROP.md'), L.join('\n'));
  fs.writeFileSync(path.join(outDir, 'prop_report.json'), JSON.stringify({
    level,
    strategies: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { level: r.level, oos: r.oos, params: r.params, folds: r.folds.map((f) => ({ test: f.testFrom, params: f.params, benched: f.benched, oos: f.oos.expectancyR, n: f.oos.trades })) }])),
    combined, ranking, proposed,
    portfolio: port ? Object.assign({}, port, { monthly: undefined }) : null
  }, null, 2));
  fs.writeFileSync(path.join(outDir, 'team.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    nextSchool: nextFirstOfMonth(new Date()).toISOString(),
    config: proposed,
    agents, staff: STAFF,
    strategies: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { name: r.name, level: r.level, params: r.params, oos: { trades: r.oos.trades, winRatePct: r.oos.winRatePct, expectancyR: r.oos.expectancyR, ci: r.oos.expectancyCI95 } }])),
    exam: ranking.map((r) => ({ key: r.key, name: r.rules, riskPct: r.riskPct, safety: r.safety, maxOpen: r.maxOpen, passPct: r.passPct, failPct: r.failPct, timeoutPct: r.timeoutPct, medianDaysToPass: r.medianDaysToPass, passWithin180Pct: r.passWithin180Pct, passWithin365Pct: r.passWithin365Pct, fee: r.fee, ev: r.expectedValuePerAttempt })),
    scenario
  }, null, 2));
  console.log('Raport: data/research/RAPORT_PROP.md');

  if (process.env.LIVE_TELEGRAM === '1' && top.rules) {
    await sendTelegram(`🔬 <b>APEX: școala lunară (Departamentul Prop)</b>\n${accepted.map(([, r]) => `${r.name}: ${fmt(r.oos.expectancyR)}R/tranzacție → ${r.level}`).join('\n')}\nPe bancă: ${agents.filter((a) => a.status === 'BANCĂ').map((a) => `${a.name} (${a.symbol})`).join(', ') || 'nimeni'}\nRecomandare: ${top.rules}, risc ${top.riskPct}%: trece ${top.passPct}%, pică ${top.failPct}% (simulat, execuție prudentă).`, { enabled: true });
  }
  if (args.apply) {
    writePromotionSection('prop', { generatedAt: new Date().toISOString(), level, validatedOOS: level !== 'NIMIC', oos: combined, overrides: { propDesk: proposed } });
    console.log(level !== 'NIMIC' ? `Departamentul Prop ACTIVAT (nivel ${level}).` : 'Departamentul Prop DEZACTIVAT: nu trece validarea.');
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { PROP_MODES, chooseRisk, pickBest, rankFirms, GRID, STRATEGIES, loadDaily, D1_DIR, prudentSim };
