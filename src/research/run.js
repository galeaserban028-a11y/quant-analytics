'use strict';

/**
 * Laboratorul de cercetare — evaluarea agenților, promovări și walk-forward.
 *
 *   npm run research                                  → toate simbolurile cu date (CSV / cache / descărcare)
 *   npm run research -- --symbols BTCUSD,ETHUSD --days 365
 *   npm run research -- --apply                       → aplică promovările DOAR dacă au trecut validarea out-of-sample
 *
 * Rezultate: data/research/RAPORT_SMC.md, report_<data>.json, proposed_promotions.json
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, writePromotionSection } = require('../config');
const { loadSymbol, DATA_DIR } = require('../backtest/dataLoader');
const { walkForward, validationLevel } = require('./walkforward');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true; else { a[key] = next; i++; }
  }
  return a;
}

const fmt = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v).toFixed(d));
const metricsLine = (m) => `${m.trades} tranzacții | win rate ${m.winRatePct ?? '–'}% | expectancy ${fmt(m.expectancyR)}R (IC95% ${fmt(m.expectancyCI95[0])} … ${fmt(m.expectancyCI95[1])}) | total ${fmt(m.totalR, 2)}R | profit factor ${m.profitFactor ?? '–'} | max DD ${fmt(m.maxDrawdownR, 2)}R`;

function buildMarkdown({ result, level, symbols, period, generatedAt }) {
  const L = [];
  L.push('# Raport laborator de cercetare — APEX QUANT');
  L.push('');
  L.push(`Generat: ${generatedAt} · Simboluri: ${symbols.join(', ')} · Perioadă: ${period}`);
  L.push('');
  L.push('## Rezultatul care contează: out-of-sample (walk-forward)');
  L.push('');
  L.push(`- **Compania optimizată:** ${metricsLine(result.oos)}`);
  L.push(`- **Configurația de bază (fără optimizare):** ${metricsLine(result.baselineOos)}`);
  L.push(`- **Nivel de validare:** **${level}**`);
  L.push('');
  L.push({
    LIVE: '> Edge demonstrat statistic out-of-sample. Totuși: începe cu risc mic și compară lunar rezultatele live cu backtest-ul.',
    DEMO: '> Rezultat pozitiv out-of-sample, dar încă nedemonstrat statistic. Promovările pot fi aplicate pentru forward-test pe cont DEMO, nu pe bani reali.',
    NIMIC: '> Nicio configurație nu a produs un rezultat pozitiv out-of-sample. Promovările NU se aplică. Nu tranzacționa cu bani reali această strategie.'
  }[level]);
  L.push('');
  L.push('## Ferestrele walk-forward');
  L.push('');
  L.push('| Test | Decizie | Geometrie aleasă | Prag scor | Cost max | Antrenare (E) | OOS | Baseline OOS |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const f of result.folds) {
    const c = f.choice || {};
    const g = c.geometry ? `stop ≥ ${c.geometry.minRiskAtr}×ATR, TP2 ${c.geometry.tp2RiskReward}R` : '–';
    L.push(`| ${f.testFrom.slice(0, 10)} → ${f.testTo.slice(0, 10)} | ${f.decision} | ${g} | ${c.threshold ?? '–'} | ${c.maxCost ?? '–'} | ${fmt(c.trainMetrics && c.trainMetrics.expectancyR)}R (${c.trainMetrics ? c.trainMetrics.trades : 0}) | ${fmt(f.oos.expectancyR)}R (${f.oos.trades}) | ${fmt(f.baselineOos.expectancyR)}R (${f.baselineOos.trades}) |`);
  }
  L.push('');
  if (result.latest) {
    const rv = result.latest.review;
    L.push('## Organigrama actuală (evaluarea pe cea mai recentă fereastră)');
    L.push('');
    L.push(`Tranzacții-umbră evaluate: ${rv.candidates} (dintre care ${rv.tradable} ar fi trecut de filtre). Expectancy toate: ${fmt(rv.candidateExpectancy)}R · după filtre: ${fmt(rv.tradableExpectancy)}R.`);
    L.push('');
    L.push('### Agenți de scor (lift = cât adaugă la R când votează DA)');
    L.push('');
    L.push('| Agent | Grad | Lift | IC95% | Voturi DA | E dacă DA | E dacă NU |');
    L.push('|---|---|---|---|---|---|---|');
    for (const a of rv.agents.filter((x) => x.department === 'SCOR')) {
      L.push(`| ${a.id} ${a.name} | ${a.grade} | ${fmt(a.lift)} | ${fmt(a.liftCI95[0])} … ${fmt(a.liftCI95[1])} | ${a.nYes} | ${fmt(a.expectancyYes)} | ${fmt(a.expectancyNo)} |`);
    }
    L.push('');
    L.push('### Filtre (lift pozitiv = blochează tranzacții mai proaste decât cele lăsate să treacă)');
    L.push('');
    L.push('| Filtru | Grad | Lift | IC95% | Blocate | E blocate | E trecute | R economisit |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const a of rv.agents.filter((x) => x.department === 'FILTRE')) {
      L.push(`| ${a.id} ${a.name}${a.protected ? ' 🔒' : ''} | ${a.grade} | ${fmt(a.lift)} | ${fmt(a.liftCI95[0])} … ${fmt(a.liftCI95[1])} | ${a.nBlocked} | ${fmt(a.expectancyBlocked)} | ${fmt(a.expectancyPassed)} | ${fmt(a.rSavedTotal, 1)} |`);
    }
    L.push('');
    L.push('🔒 = filtru protejat (date, geometrie, corelație, drawdown): nu poate fi retrogradat automat.');
    L.push('');
    L.push('### Birouri pe instrumente');
    L.push('');
    L.push('| Birou | Grad | Tranzacții | Expectancy | IC95% |');
    L.push('|---|---|---|---|---|');
    for (const d of rv.desks) L.push(`| ${d.symbol} | ${d.grade} | ${d.n} | ${fmt(d.expectancy)} | ${fmt(d.ci95[0])} … ${fmt(d.ci95[1])} |`);
    L.push('');
    L.push('### Mutări propuse de consiliu');
    L.push('');
    if (!result.latest.moves.length) L.push('Nicio mutare: niciun agent nu a avut o contribuție semnificativ diferită de zero.');
    for (const m of result.latest.moves) L.push(`- **${m.id} ${m.name}:** ${m.action}${m.from !== undefined ? ` (pondere ${m.from} → ${m.to})` : ''}`);
    L.push('');
    L.push('### Configurația propusă (antrenată pe cele mai recente date)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(result.latest.overrides, null, 2));
    L.push('```');
  }
  L.push('');
  L.push('## Cum se citește');
  L.push('');
  L.push('- **R** = multiplu al riscului. +1R = ai câștigat cât ai riscat. Costurile (spread + comision) sunt deja scăzute.');
  L.push('- **IC95%** = intervalul în care se află, cu 95% încredere, valoarea reală. Dacă include 0, rezultatul poate fi noroc.');
  L.push('- **Out-of-sample** = perioade pe care selecția parametrilor nu le-a văzut. Doar aceste cifre estimează performanța viitoare.');
  L.push('- Limitări: fără calendar de știri istoric; fill-uri la close; model intrabar pesimist; performanța trecută nu garantează viitorul.');
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ ignorePromotions: true });
  const days = parseInt(args.days || '400', 10);
  const symbols = args.symbols ? String(args.symbols).split(',').map((s) => s.trim().toUpperCase()) : Object.keys(config.instruments);

  const data = {};
  for (const s of symbols) {
    if (!config.instruments[s]) continue;
    try {
      const { candles } = await loadSymbol(s, config.instruments[s], { days, log: (m) => console.log('  ' + m) });
      if (candles.length > 2000) data[s] = candles; else console.log(`  ${s}: prea puține date pentru walk-forward (${candles.length})`);
    } catch (err) { console.log(`  ${s}: ${err.message}`); }
  }
  if (!Object.keys(data).length) { console.log('Nu există suficiente date.'); process.exitCode = 1; return; }

  const t0 = Date.now();
  const result = await walkForward({
    dataBySymbol: data,
    config,
    options: {
      trainDays: args.train ? +args.train : 120,
      testDays: args.test ? +args.test : 60,
      log: (m) => console.log(m)
    }
  });
  const level = validationLevel(result.oos, result.baselineOos);
  let from = Infinity, to = -Infinity;
  for (const c of Object.values(data)) { from = Math.min(from, c[0].timestamp); to = Math.max(to, c[c.length - 1].timestamp); }
  const period = `${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}`;

  console.log(`\nOUT-OF-SAMPLE compania optimizată: ${metricsLine(result.oos)}`);
  console.log(`OUT-OF-SAMPLE configurația de bază: ${metricsLine(result.baselineOos)}`);
  console.log(`Nivel de validare: ${level} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const outDir = path.join(DATA_DIR, 'research');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const md = buildMarkdown({ result, level, symbols: Object.keys(data), period, generatedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(outDir, 'RAPORT_SMC.md'), md);
  const { oosTrades, ...slim } = result;
  fs.writeFileSync(path.join(outDir, `report_${stamp}.json`), JSON.stringify(Object.assign({ level, period }, slim), null, 2));
  const proposed = { generatedAt: new Date().toISOString(), level, validatedOOS: level !== 'NIMIC', oos: result.oos, baselineOos: result.baselineOos, overrides: result.latest ? result.latest.overrides : null, moves: result.latest ? result.latest.moves : [] };
  fs.writeFileSync(path.join(outDir, 'proposed_promotions.json'), JSON.stringify(proposed, null, 2));
  console.log('Raport: data/research/RAPORT_SMC.md');

  if (args.apply) {
    if (level === 'NIMIC' || !result.latest || !result.latest.tradeable) {
      console.log('NU am aplicat promovările: nu au trecut validarea out-of-sample (sau ultima fereastră nu are edge).');
    } else {
      proposed.overrides = Object.assign({}, proposed.overrides, { smcDesk: { enabled: true } });
      writePromotionSection('smc', proposed);
      console.log(`Promovări aplicate în config/promotions.json (secțiunea smc, nivel ${level}). Live-ul le va folosi la următoarea pornire.`);
    }
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });

module.exports = { buildMarkdown };
