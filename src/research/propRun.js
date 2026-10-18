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
const { trendWalkForward } = require('./trendResearch');
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
  }
};
// Respinse după testare (păstrate în raport ca să nu le mai încercăm orbește): IBS (0 pe indici; „miracolul” de pe Forex
// era un defect de date), Double Seven (prea slab pentru examen), efectul de sfârșit de lună (≈0 după costuri).
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

/** Cea mai bună valoare așteptată dintre variantele cu P(pică) ≤ 5% (dacă nu există niciuna: dintre toate). */
function pickBest(table, maxFailPct = 5) {
  const ok = table.filter((r) => r.failPct <= maxFailPct);
  return (ok.length ? ok : table).slice().sort((a, b) => b.expectedValuePerAttempt - a.expectedValuePerAttempt || a.failPct - b.failPct)[0];
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

  const results = {};
  for (const [kind, st] of Object.entries(STRATEGIES)) {
    console.log(`\n== ${st.name} ==`);
    const wf = trendWalkForward(data, INSTRUMENTS, { simulate: prudentSim, barMs: DAY, trainYears: 3, grid: st.grid, minTrades: 40, fixedParams: st.grid[0], log: (m) => console.log(m.slice(0, 200)) });
    const level = validationLevel(wf.oosSelected, { expectancyR: 0 });
    results[kind] = { name: st.name, wf, level, params: wf.latest ? wf.latest.params : st.grid[0] };
    console.log(`${st.name}: OOS ${wf.oosSelected.trades} tranzacții, E=${fmt(wf.oosSelected.expectancyR)}R (IC95% ${fmt(wf.oosSelected.expectancyCI95[0])} … ${fmt(wf.oosSelected.expectancyCI95[1])}) → ${level}`);
  }
  const accepted = Object.entries(results).filter(([, r]) => r.level !== 'NIMIC');
  const trades = accepted.flatMap(([, r]) => r.wf.oosSelectedTrades);
  const combined = computeMetrics(trades);
  const level = accepted.length ? validationLevel(combined, { expectancyR: 0 }) : 'NIMIC';
  const port = trades.length ? portfolioSim(trades, { riskPct: 1, maxOpen: 5, maxOpenRiskPct: 5 }) : null;

  const firms = {};
  if (trades.length) for (const [key, rules] of Object.entries(PROP_RULES)) firms[key] = chooseRisk(trades, rules);
  const ranking = Object.entries(firms).map(([k, v]) => ({ key: k, ...v.best })).sort((a, b) => b.expectedValuePerAttempt - a.expectedValuePerAttempt || b.passPct - a.passPct);
  const top = ranking[0] || {};
  const proposed = {
    enabled: level !== 'NIMIC',
    firm: top.key,
    riskPct: top.riskPct,
    safety: top.safety,
    maxOpen: top.maxOpen,
    strategies: accepted.map(([kind, r]) => ({ kind, name: r.name, params: r.params })),
    symbols: Object.keys(data)
  };

  console.log(`\nPortofoliu: ${combined.trades} tranzacții, E=${fmt(combined.expectancyR)}R → ${level}`);
  for (const r of ranking) console.log(`  ${r.rules.padEnd(28)} risc ${r.riskPct}% (siguranță ${r.safety}, max ${r.maxOpen} poziții): trece ${r.passPct}% | pică ${r.failPct}% | zile mediane ${r.medianDaysToPass} | ≤6 luni ${r.passWithin180Pct}% | EV ${r.expectedValuePerAttempt}$`);

  const L = [];
  L.push('# Raport — Departamentul PROP (indici, grafic zilnic, 2 strategii)');
  L.push('');
  L.push(`Generat: ${new Date().toISOString()} · ${Object.keys(data).length} indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere`);
  L.push('');
  L.push('## 1. Strategiile (out-of-sample)');
  L.push('');
  L.push('| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |');
  L.push('|---|---|---|---|---|---|');
  for (const r of Object.values(results)) {
    const o = r.wf.oosSelected;
    L.push(`| ${r.name} | ${o.trades} | ${o.winRatePct}% | ${fmt(o.expectancyR)} (${fmt(o.expectancyCI95[0])} … ${fmt(o.expectancyCI95[1])}) | ${r.wf.folds.filter((f) => f.oosSelected.expectancyR > 0).length}/${r.wf.folds.length} | **${r.level}** |`);
  }
  L.push(`| **Portofoliu** | ${combined.trades} | ${combined.winRatePct}% | ${fmt(combined.expectancyR)} | – | **${level}** |`);
  L.push('');
  if (port) L.push(`Portofoliu la risc 1%/tranzacție (fără reguli prop): ${port.cagrPct}% pe an, scădere maximă ${port.maxDrawdownPct}%.`);
  L.push('');
  L.push('Respinse după testare: Forex (date zilnice nealiniate; pierde cu execuție realistă), IBS (≈0 pe indici), Double Seven (prea slab), sfârșit de lună (≈0 după costuri).');
  L.push('');
  L.push(`## 2. Șansele la examen (${top.attempts || 0} date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)`);
  L.push('');
  L.push('| Firmă | Risc | Trece | Pică | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of ranking) L.push(`| ${r.rules} | ${r.riskPct}% (siguranță ${r.safety}, max ${r.maxOpen} poz.) | **${r.passPct}%** | ${r.failPct}% | ${r.medianDaysToPass ?? '–'} | ${r.passWithin180Pct}% | ${r.passWithin365Pct}% | ${r.fee}$ | ${r.expectedValuePerAttempt}$ |`);
  L.push('');
  if (top.rules) L.push(`**Recomandare:** ${top.rules}, risc ${top.riskPct}% pe tranzacție, Gardianul Prop activ.`);
  L.push('');
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
    strategies: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { level: r.level, oos: r.wf.oosSelected, params: r.params, folds: r.wf.folds.map((f) => ({ test: f.testFrom, params: f.chosen, oos: f.oosSelected.expectancyR, n: f.oosSelected.trades })) }])),
    combined, ranking, proposed,
    portfolio: port ? Object.assign({}, port, { monthly: undefined }) : null
  }, null, 2));
  console.log('Raport: data/research/RAPORT_PROP.md');

  if (process.env.LIVE_TELEGRAM === '1' && top.rules) {
    await sendTelegram(`🔬 <b>APEX: cercetarea lunară (Departamentul Prop)</b>\n${accepted.map(([, r]) => `${r.name}: ${fmt(r.wf.oosSelected.expectancyR)}R/tranzacție → ${r.level}`).join('\n')}\nRecomandare: ${top.rules}, risc ${top.riskPct}%: trece ${top.passPct}%, pică ${top.failPct}% (simulat, execuție prudentă).`, { enabled: true });
  }
  if (args.apply) {
    writePromotionSection('prop', { generatedAt: new Date().toISOString(), level, validatedOOS: level !== 'NIMIC', oos: combined, overrides: { propDesk: proposed } });
    console.log(level !== 'NIMIC' ? `Departamentul Prop ACTIVAT (nivel ${level}).` : 'Departamentul Prop DEZACTIVAT: nu trece validarea.');
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { chooseRisk, pickBest, GRID, STRATEGIES, loadDaily, D1_DIR, prudentSim };
