'use strict';

/**
 * Cercetare pentru Departamentul Trend (H4), cu walk-forward anual și simulare de portofoliu.
 *
 *   npm run research:trend                  → folosește data/csv_h4/*.csv (le descarcă de pe Binance dacă lipsesc)
 *   npm run research:trend -- --refresh     → re-descarcă istoricul complet (actualizează până azi)
 *   npm run research:trend -- --apply       → activează departamentul DOAR dacă a trecut validarea out-of-sample
 *
 * Rezultate: data/research/RAPORT_TREND.md + trend_report_<data>.json
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, writePromotionSection } = require('../config');
const { loadCsv, DATA_DIR } = require('../backtest/dataLoader');
const sources = require('../data/sources');
const { trendWalkForward } = require('./trendResearch');
const { portfolioSim, monteCarloMonths } = require('./portfolio');
const { validationLevel } = require('./walkforward');
const { sendTelegram } = require('../notify/telegram');

const H4_DIR = path.join(DATA_DIR, 'csv_h4');

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

async function loadH4(symbol, inst, refresh) {
  const file = path.join(H4_DIR, `${symbol}.csv`);
  if (!refresh && fs.existsSync(file)) return loadCsv(file);
  console.log(`  ${symbol}: descarc istoricul H4 de pe Binance (din 2018)...`);
  const candles = await sources.binanceKlines(inst.candles.id, '4h', { startTs: Date.UTC(2018, 0, 1) });
  fs.mkdirSync(H4_DIR, { recursive: true });
  fs.writeFileSync(file, 'timestamp,open,high,low,close,volume\n' + candles.map((c) => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n') + '\n');
  return candles;
}

const fmt = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v).toFixed(d));
const mline = (m) => `${m.trades} tranzacții | win rate ${m.winRatePct ?? '–'}% | expectancy ${fmt(m.expectancyR)}R (IC95% ${fmt(m.expectancyCI95[0])} … ${fmt(m.expectancyCI95[1])}) | profit factor ${m.profitFactor ?? '–'}`;

function markdown({ r, level, port, mc, symbols, desk }) {
  const L = [];
  L.push('# Raport — Departamentul Trend (H4)');
  L.push('');
  L.push(`Generat: ${new Date().toISOString()} · Simboluri: ${symbols.join(', ')}`);
  L.push('');
  L.push('## Out-of-sample (walk-forward anual: antrenare 2 ani → test anul următor)');
  L.push('');
  L.push(`- **Parametri aleși anual de laborator:** ${mline(r.oosSelected)}`);
  L.push(`- **Parametri fixi din literatură (fără optimizare):** ${mline(r.oosFixed)}`);
  L.push(`- **Nivel de validare:** **${level}**`);
  L.push('');
  L.push('| An de test | Decizie | Parametri aleși | OOS ales | OOS fix |');
  L.push('|---|---|---|---|---|');
  for (const f of r.folds) {
    const p = f.chosen ? `lookback ${f.chosen.lookbacks.join('/')}, stop ${f.chosen.atrMult}×ATR, ${f.chosen.allowShort ? 'long+short' : 'doar long'}` : '–';
    L.push(`| ${f.testFrom} → ${f.testTo} | ${f.decision} | ${p} | ${fmt(f.oosSelected.expectancyR)}R (${f.oosSelected.trades}) | ${fmt(f.oosFixed.expectancyR)}R (${f.oosFixed.trades}) |`);
  }
  L.push('');
  L.push(`## Simulare de portofoliu (risc ${port.riskPct}% / tranzacție, maxim ${port.maxOpenRiskPct}% risc deschis, maxim ${port.maxOpen} poziții)`);
  L.push('');
  L.push(`- Capital: 10.000 → **${port.endEquity.toFixed(0)}** (${port.totalReturnPct}% total, **${port.cagrPct}% pe an**)`);
  L.push(`- Scădere maximă (drawdown): **${port.maxDrawdownPct}%** · Sharpe (lunar, anualizat): ${port.sharpeMonthly}`);
  L.push(`- Luni pe plus: ${port.positiveMonthsPct}% · medie lunară ${port.avgMonthlyPct}% · mediană ${port.medianMonthlyPct}% · cea mai proastă lună ${port.worstMonthPct}% · cea mai bună ${port.bestMonthPct}%`);
  L.push(`- Pe ani: ${Object.entries(port.yearly).map(([y, v]) => `${y}: ${v}%`).join(' · ')}`);
  L.push('');
  if (mc) {
    L.push('### Monte Carlo — următoarele 12 luni (reeșantionare din lunile out-of-sample)');
    L.push('');
    L.push(`- Randament: pesimist (5%) **${mc.returnPct.p5}%** · median **${mc.returnPct.median}%** · optimist (95%) **${mc.returnPct.p95}%**`);
    L.push(`- Scădere maximă: mediană ${mc.maxDrawdownPct.median}% · rău (95%) **${mc.maxDrawdownPct.p95}%** · foarte rău (99%) ${mc.maxDrawdownPct.p99}%`);
    L.push(`- Probabilitatea unui an pe minus: **${mc.probLossPct}%**`);
    L.push('');
  }
  L.push('## Configurația propusă (antrenată pe cei mai recenți 2 ani)');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(desk, null, 2));
  L.push('```');
  L.push('');
  L.push('## Limitări (citește-le)');
  L.push('');
  L.push('- Universul de monede e ales azi (survivorship bias): monedele care au murit între timp nu sunt în test.');
  L.push('- Profit lunar NEUNIFORM: aproximativ jumătate din luni sunt pe minus; profitul vine din câteva luni de trend puternic.');
  L.push('- Fill-uri la închiderea H4 + spread/comision modelate; slippage-ul extrem (crash-uri) poate fi mai mare.');
  L.push('- Performanța trecută nu garantează rezultate viitoare. Începe pe cont demo sau cu risc foarte mic.');
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ ignorePromotions: true });
  const desk = config.trendDesk || {};
  const symbols = args.symbols ? String(args.symbols).split(',').map((s) => s.trim().toUpperCase()) : desk.symbols;
  const data = {};
  for (const s of symbols) {
    const inst = config.instruments[s];
    if (!inst) { console.log(`  ${s}: instrument necunoscut`); continue; }
    try {
      const c = await loadH4(s, inst, Boolean(args.refresh));
      if (c.length > 2000) data[s] = c; else console.log(`  ${s}: prea puține date (${c.length})`);
    } catch (err) { console.log(`  ${s}: ${err.message}`); }
  }
  if (Object.keys(data).length < 3) { console.log('Prea puține simboluri cu date.'); process.exitCode = 1; return; }

  const r = trendWalkForward(data, config.instruments, { log: console.log });
  const level = validationLevel(r.oosSelected, r.oosFixed.expectancyR !== null ? { expectancyR: Math.min(r.oosFixed.expectancyR, 0) } : { expectancyR: null });
  const portOpts = { riskPct: desk.riskPerTradePct || 0.5, maxOpen: desk.maxOpen || 10, maxOpenRiskPct: desk.maxOpenRiskPct || 5 };
  const port = portfolioSim(r.oosSelectedTrades, portOpts);
  const mc = monteCarloMonths(port.monthly.map((m) => m.returnPct), { horizonMonths: 12 });
  const proposedDesk = Object.assign({}, desk, { params: r.latest ? r.latest.params : desk.params, enabled: level !== 'NIMIC' });

  console.log(`\nOOS ales: ${mline(r.oosSelected)}`);
  console.log(`OOS fix:  ${mline(r.oosFixed)}`);
  console.log(`Portofoliu: ${port.cagrPct}%/an, drawdown max ${port.maxDrawdownPct}%, luni pe plus ${port.positiveMonthsPct}%`);
  console.log(`Nivel de validare: ${level}`);

  const outDir = path.join(DATA_DIR, 'research');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'RAPORT_TREND.md'), markdown({ r, level, port, mc, symbols: Object.keys(data), desk: proposedDesk }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { oosFixedTrades, oosSelectedTrades, ...slim } = r;
  fs.writeFileSync(path.join(outDir, `trend_report_${stamp}.json`), JSON.stringify({ level, portfolio: port, monteCarlo: mc, ...slim }, null, 2));
  console.log('Raport: data/research/RAPORT_TREND.md');

  if (process.env.LIVE_TELEGRAM === '1') {
    await sendTelegram(`🔬 <b>APEX: cercetarea lunară (Departamentul Trend)</b>\n` +
      `Out-of-sample: ${r.oosSelected.trades} tranzacții, ${fmt(r.oosSelected.expectancyR)}R/tranzacție (IC95% ${fmt(r.oosSelected.expectancyCI95[0])} … ${fmt(r.oosSelected.expectancyCI95[1])}).\n` +
      `Portofoliu simulat: ${port.cagrPct}%/an, drawdown maxim ${port.maxDrawdownPct}%.\n` +
      `Validare: <b>${level}</b> → departamentul ${level === 'NIMIC' ? 'se DEZACTIVEAZĂ' : 'rămâne ACTIV'}.\n` +
      `Parametri noi: lookback ${proposedDesk.params.lookbacks.join('/')}, stop ${proposedDesk.params.atrMult}×ATR, ${proposedDesk.params.allowShort ? 'long+short' : 'doar long'}.`,
    { enabled: true });
  }

  if (args.apply) {
    if (level === 'NIMIC') {
      writePromotionSection('trend', { generatedAt: new Date().toISOString(), level, validatedOOS: false, oos: r.oosSelected, overrides: { trendDesk: { enabled: false } } });
      console.log('Departamentul Trend DEZACTIVAT: nu mai trece validarea out-of-sample.');
    } else {
      writePromotionSection('trend', {
        generatedAt: new Date().toISOString(), level, validatedOOS: true,
        oos: r.oosSelected, portfolio: { cagrPct: port.cagrPct, maxDrawdownPct: port.maxDrawdownPct, positiveMonthsPct: port.positiveMonthsPct },
        overrides: { trendDesk: proposedDesk }
      });
      console.log(`Departamentul Trend ACTIVAT în config/promotions.json (nivel ${level}).`);
    }
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { markdown };
