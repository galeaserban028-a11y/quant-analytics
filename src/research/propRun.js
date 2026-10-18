'use strict';

/**
 * Cercetare pentru DEPARTAMENTUL PROP (Forex / aur / indici, zilnic):
 *  1) walk-forward anual al strategiei Pullback (antrenare 3 ani → test anul următor);
 *  2) simulatorul de examen pe tranzacțiile out-of-sample, pentru fiecare firmă și nivel de risc;
 *  3) alege riscul cu cea mai mare șansă de trecere, cu condiția ca șansa de a PICA să fie ≤ 5%.
 *
 *   npm run research:prop                → folosește data/fx/d1/*.csv (le descarcă dacă lipsesc)
 *   npm run research:prop -- --refresh   → re-descarcă istoricul zilnic (Yahoo, din 2000)
 *   npm run research:prop -- --apply     → activează departamentul DOAR dacă trece validarea
 */
const fs = require('fs');
const path = require('path');
const { loadCsv, DATA_DIR } = require('../backtest/dataLoader');
const { cleanSpikes, normalizeCandles } = require('../core/candles');
const { getJson } = require('../data/http');
const { parseYahooChart, validOhlc } = require('../data/dailySources');
const mr = require('../strategies/meanRevDesk');
const { trendWalkForward } = require('./trendResearch');
const { validationLevel } = require('./walkforward');
const { simulateChallenges } = require('../prop/challengeSim');
const { PROP_RULES } = require('../prop/rules');
const { portfolioSim } = require('./portfolio');
const { writePromotionSection } = require('../config');
const { sendTelegram } = require('../notify/telegram');

const D1_DIR = path.join(DATA_DIR, 'fx', 'd1');
const INSTRUMENTS = require('../../config/forex_instruments.json');
const DAY = 864e5;

const GRID = (() => {
  const g = [];
  for (const trendLen of [100, 200]) for (const entryRsi of [5, 10, 20]) for (const exitLen of [3, 5]) for (const stopAtr of [2, 3, 4]) for (const allowShort of [false, true]) {
    g.push({ trendLen, entryRsi, exitLen, stopAtr, maxDays: 10, allowShort });
  }
  return g;
})();

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

function chooseRisk(trades, rules) {
  const table = [];
  for (const riskPct of [1, 1.5, 2, 2.5, 3]) {
    for (const safety of [0.7, 0.8, 0.9]) {
      const r = simulateChallenges(trades, rules, { riskPct, safety, maxOpen: 5 }, { horizonDays: 1095, fundedMonths: 12, stepDays: 14 }); // EV = P(trece) × plăți în primele 12 luni − taxa
      if (r) table.push(Object.assign({ safety }, r));
    }
  }
  const ok = table.filter((r) => r.failPct <= 5);
  const best = (ok.length ? ok : table).slice().sort((a, b) => b.passPct - a.passPct || a.failPct - b.failPct)[0];
  return { best, table };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = {};
  for (const [s, inst] of Object.entries(INSTRUMENTS)) {
    if (s.startsWith('_')) continue;
    try {
      const c = await loadDaily(s, inst, Boolean(args.refresh));
      if (c.length > 1500) data[s] = c; else console.log(`  ${s}: prea puține date (${c.length})`);
    } catch (err) { console.log(`  ${s}: ${err.message}`); }
  }
  if (Object.keys(data).length < 5) { console.log('Prea puține instrumente cu date.'); process.exitCode = 1; return; }

  const wf = trendWalkForward(data, INSTRUMENTS, { simulate: mr.simulate, barMs: DAY, trainYears: 3, grid: GRID, minTrades: 40, fixedParams: mr.DEFAULT_PARAMS, log: (m) => console.log(m.slice(0, 180)) });
  const level = validationLevel(wf.oosSelected, { expectancyR: 0 });
  const port = portfolioSim(wf.oosSelectedTrades, { riskPct: 1, maxOpen: 5, maxOpenRiskPct: 5 });

  const firms = {};
  for (const [key, rules] of Object.entries(PROP_RULES)) firms[key] = chooseRisk(wf.oosSelectedTrades, rules);
  const ranking = Object.entries(firms).map(([k, v]) => ({ key: k, ...v.best })).sort((a, b) => b.expectedValuePerAttempt - a.expectedValuePerAttempt || b.passPct - a.passPct); // taxa contează: ordonăm după valoarea așteptată
  const top = ranking[0];
  const params = wf.latest ? wf.latest.params : mr.DEFAULT_PARAMS;
  const proposed = {
    enabled: level !== 'NIMIC',
    firm: top.key,
    riskPct: top.riskPct,
    safety: top.safety,
    maxOpen: 5,
    params,
    symbols: Object.keys(data)
  };

  console.log(`\nOOS: ${wf.oosSelected.trades} tranzacții, E=${fmt(wf.oosSelected.expectancyR)}R (IC95% ${fmt(wf.oosSelected.expectancyCI95[0])} … ${fmt(wf.oosSelected.expectancyCI95[1])}), win rate ${wf.oosSelected.winRatePct}% → ${level}`);
  for (const r of ranking) console.log(`  ${r.rules.padEnd(28)} risc ${r.riskPct}% (siguranță ${r.safety}): trece ${r.passPct}% | pică ${r.failPct}% | zile mediane ${r.medianDaysToPass} | EV ${r.expectedValuePerAttempt}$`);

  const L = [];
  L.push('# Raport — Departamentul PROP (Forex, aur, indici; grafic zilnic)');
  L.push('');
  L.push(`Generat: ${new Date().toISOString()} · ${Object.keys(data).length} instrumente · walk-forward anual (antrenare 3 ani → test 1 an)`);
  L.push('');
  L.push('## 1. Are strategia avantaj real? (out-of-sample)');
  L.push('');
  L.push(`- **${wf.oosSelected.trades} tranzacții**, **${wf.oosSelected.winRatePct}% câștigătoare**, **${fmt(wf.oosSelected.expectancyR)}R** pe tranzacție (IC95% ${fmt(wf.oosSelected.expectancyCI95[0])} … ${fmt(wf.oosSelected.expectancyCI95[1])}), profit factor ${wf.oosSelected.profitFactor}`);
  L.push(`- Nivel de validare: **${level}**`);
  L.push(`- Ani de test pozitivi: ${wf.folds.filter((f) => f.oosSelected.expectancyR > 0).length} din ${wf.folds.length}`);
  L.push(`- Portofoliu la risc 1%/tranzacție: ${port.cagrPct}% pe an, scădere maximă ${port.maxDrawdownPct}%`);
  L.push('');
  L.push(`## 2. Șansele la examen (simulare pe istoria reală, ${top.attempts} date de start diferite, orizont 3 ani, apoi 12 luni pe contul finanțat)`);
  L.push('');
  L.push('| Firmă | Risc ales | Trece (interval) | Pică | Neterminat în 3 ani | Zile mediane | Taxă ~10k | Valoare așteptată/încercare |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of ranking) L.push(`| ${r.rules} | ${r.riskPct}% (siguranță ${r.safety}) | **${r.passPct}%** (${(r.passPctRange || []).join('–')}%) | ${r.failPct}% | ${r.timeoutPct}% | ${r.medianDaysToPass ?? '–'} | ${r.fee}$ | ${r.expectedValuePerAttempt}$ |`);
  L.push('');
  L.push(`**Recomandare:** ${top.rules}, risc ${top.riskPct}% pe tranzacție, cu Gardianul Prop activ.`);
  L.push('');
  L.push('## 3. Ce înseamnă pe înțeles');
  L.push('');
  L.push('- Strategia are un avantaj mic, dar real și stabil. Cele mai bune rezultate le dă pe indici (US30, SPX500, NAS100).');
  L.push('- Gardianul aproape elimină picarea examenului din cauza limitelor. Prețul e viteza: trecerea durează de obicei luni, nu săptămâni.');
  L.push('- Nicio firmă nu are limită de timp pe fazele de examen (FTMO, FundedNext), așa că încetineala nu te costă bani în plus.');
  L.push('- **Taxa examenului e singurul risc**: nu poți pierde mai mult decât ea. Începe pe contul GRATUIT de probă și plătește doar după ce vezi că semnalele merg.');
  L.push('');
  L.push('## Configurația propusă');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(proposed, null, 2));
  L.push('```');
  L.push('');
  L.push('Limitări: date zilnice gratuite (Yahoo); aurul din contracte futures; intrare la închiderea zilei; capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare.');

  const outDir = path.join(DATA_DIR, 'research');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'RAPORT_PROP.md'), L.join('\n'));
  fs.writeFileSync(path.join(outDir, 'prop_report.json'), JSON.stringify({ level, oos: wf.oosSelected, folds: wf.folds.map((f) => ({ test: f.testFrom, params: f.chosen, oos: f.oosSelected.expectancyR, n: f.oosSelected.trades })), ranking, proposed, portfolio: Object.assign({}, port, { monthly: undefined }) }, null, 2));
  console.log('Raport: data/research/RAPORT_PROP.md');

  if (process.env.LIVE_TELEGRAM === '1') {
    await sendTelegram(`🔬 <b>APEX: cercetarea lunară (Departamentul Prop)</b>\nOut-of-sample: ${wf.oosSelected.trades} tranzacții, ${wf.oosSelected.winRatePct}% câștigătoare, ${fmt(wf.oosSelected.expectancyR)}R/tranzacție → <b>${level}</b>.\nRecomandare: ${top.rules}, risc ${top.riskPct}%: trece ${top.passPct}%, pică ${top.failPct}% (simulat).`, { enabled: true });
  }
  if (args.apply) {
    writePromotionSection('prop', { generatedAt: new Date().toISOString(), level, validatedOOS: level !== 'NIMIC', oos: wf.oosSelected, overrides: { propDesk: proposed } });
    console.log(level !== 'NIMIC' ? `Departamentul Prop ACTIVAT (nivel ${level}).` : 'Departamentul Prop DEZACTIVAT: nu trece validarea.');
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { chooseRisk, GRID };
