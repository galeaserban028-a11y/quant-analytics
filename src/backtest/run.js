'use strict';

/**
 * Backtest din linia de comandă.
 *
 *   npm run backtest                                  → toate simbolurile, 60 de zile
 *   npm run backtest -- --symbols BTCUSD,ETHUSD --days 180
 *   npm run backtest -- --spread 1.5                  → test de stres: spread × 1.5
 *   npm run backtest -- --synthetic                   → random walk (test de sănătate, fără internet)
 *
 * Rezultate: data/backtest/report_<data>.json + trades_<data>.csv
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config/agents_config.json');
const { runBacktest } = require('./engine');
const { loadSymbol, DATA_DIR } = require('./dataLoader');
const { generateSyntheticUniverse } = require('./synthetic');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

function printMetrics(title, m) {
  const ci = m.expectancyCI95 || [];
  console.log(`\n${title}`);
  console.log(`  Tranzacții: ${m.trades} | Win rate: ${m.winRatePct ?? '-'}% | Câștig mediu: ${m.avgWinR ?? '-'}R | Pierdere medie: ${m.avgLossR ?? '-'}R`);
  console.log(`  Expectancy: ${m.expectancyR ?? '-'}R/tranzacție (IC95%: ${ci[0] ?? '-'} … ${ci[1] ?? '-'}) | t=${m.tStat ?? '-'}`);
  console.log(`  Total: ${m.totalR ?? '-'}R | Profit factor: ${m.profitFactor ?? '-'} | Max drawdown: ${m.maxDrawdownR ?? '-'}R | Pierderi la rând: ${m.maxLosingStreak}`);
  if (m.outcomes && Object.keys(m.outcomes).length) console.log(`  Ieșiri: ${JSON.stringify(m.outcomes)}`);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => r[c]).join(','))).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days || '60', 10);
  const symbols = args.symbols ? String(args.symbols).split(',').map((s) => s.trim().toUpperCase()) : Object.keys(config.instruments);
  const dataBySymbol = {};

  if (args.synthetic) {
    const seeds = parseInt(args.seeds || '1', 10);
    console.log(`Random walk sintetic: 6 perechi FX, ${days} zile, ${seeds} seed-uri (fără edge real, prin construcție).`);
    const all = [];
    const vetoes = {};
    for (let s = 1; s <= seeds; s++) {
      const rep = await runBacktest({ dataBySymbol: generateSyntheticUniverse({ seed: s, days }), config, options: { spreadMultiplier: args.spread ? +args.spread : 1 } });
      all.push(...rep.trades.map((t) => ({ resultR: t.resultR, outcome: t.outcome })));
      for (const [k, v] of Object.entries(rep.evalStats.vetoCounts)) vetoes[k] = (vetoes[k] || 0) + v;
      console.log(`  seed ${s}: ${rep.overall.trades} tranzacții, expectancy ${rep.overall.expectancyR}R`);
    }
    console.log('  Blocări:', Object.entries(vetoes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}=${v}`).join(', '));
    printMetrics('=== TOTAL RANDOM WALK ===', require('./metrics').computeMetrics(all));
    return;
  }

  for (const s of symbols) {
    const inst = config.instruments[s];
    if (!inst) { console.log(`Simbol necunoscut: ${s}`); continue; }
    try {
      const { candles } = await loadSymbol(s, inst, { days, log: (m) => console.log('  ' + m) });
      if (candles.length > 300) dataBySymbol[s] = candles;
      else console.log(`  ${s}: prea puține date (${candles.length}), sărit`);
    } catch (err) {
      console.log(`  ${s}: nu am putut încărca datele (${err.message})`);
    }
  }
  if (!Object.keys(dataBySymbol).length) { console.log('Nu există date. Verifică internetul sau pune CSV-uri în data/csv/.'); process.exitCode = 1; return; }

  console.log('\nRulez backtest-ul...');
  const t0 = Date.now();
  const report = await runBacktest({
    dataBySymbol,
    config,
    options: { spreadMultiplier: args.spread ? +args.spread : 1, onProgress: (p) => process.stdout.write(`\r  ${(p * 100).toFixed(0)}%`) }
  });
  process.stdout.write('\r');

  console.log(`\nPerioadă: ${report.period.from} → ${report.period.to} (${report.period.bars} momente, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log('Ipoteze:', JSON.stringify(report.assumptions));
  printMetrics('=== REZULTAT GENERAL ===', report.overall);
  printMetrics('--- Prima jumătate a perioadei ---', report.stability.firstHalf);
  printMetrics('--- A doua jumătate a perioadei ---', report.stability.secondHalf);
  console.log('\nPe simbol:');
  for (const [s, m] of Object.entries(report.perSymbol)) console.log(`  ${s.padEnd(7)} ${String(m.trades).padStart(4)} tranz. | E=${m.expectancyR ?? '-'}R | total ${m.totalR ?? 0}R | WR ${m.winRatePct ?? '-'}%`);
  const topVetoes = Object.entries(report.evalStats.vetoCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\nCele mai frecvente motive de blocare:', topVetoes.map(([k, v]) => `${k}=${v}`).join(', '));
  console.log(`\nVERDICT: ${report.verdict}`);

  const outDir = path.join(DATA_DIR, 'backtest');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { closedTrades, shadowTrades, ...slim } = report;
  fs.writeFileSync(path.join(outDir, `report_${stamp}.json`), JSON.stringify(slim, null, 2));
  fs.writeFileSync(path.join(outDir, `trades_${stamp}.csv`), toCsv(report.trades));
  console.log(`\nRaport salvat în data/backtest/report_${stamp}.json (+ trades_${stamp}.csv)`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
