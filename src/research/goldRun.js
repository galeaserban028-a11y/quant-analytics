'use strict';

/**
 * CERCETAREA LUNARĂ PE AUR: retestează walk-forward (antrenare 3 ani → test anul următor) toate familiile de strategii
 * pe aur (zilnic, Yahoo GC=F, din 2003), cu spread, comision și swap. Raportul: data/research/gold_report.json.
 * Dacă vreo strategie trece testul strict (IC95% al câștigului mediu > 0, cel puțin 60 de tranzacții), te anunță pe Telegram.
 *
 *   node src/research/goldRun.js [--refresh]
 */
const fs = require('fs');
const path = require('path');
const P = require('./propRun');
const lab = require('../strategies/dailyLab');
const { teamWalkForward } = require('./team');
const { computeMetrics } = require('../backtest/metrics');
const { DATA_DIR } = require('../backtest/dataLoader');
const { sendTelegram } = require('../notify/telegram');

const grid = (space) => { let g = [{}]; for (const [k, vs] of Object.entries(space)) g = g.flatMap((o) => vs.map((v) => Object.assign({}, o, { [k]: v }))); return g; };
const FAMILIES = {
  mom: { name: 'Momentum', grid: grid({ kind: ['mom'], lookback: [20, 60, 120, 250], stopAtr: [3, 5], maxDays: [250], allowShort: [false, true] }) },
  donch: { name: 'Breakout Donchian', grid: grid({ kind: ['donch'], entryLen: [20, 55, 100], exitLen: [10, 30], stopAtr: [3, 5], maxDays: [250], allowShort: [false, true] }) },
  rsi2: { name: 'Pullback RSI(2)', grid: grid({ kind: ['rsi2'], trendLen: [100, 200], entryRsi: [5, 10, 20], exitLen: [3, 5], stopAtr: [2, 3], maxDays: [10], allowShort: [false, true] }) },
  bb: { name: 'Bollinger', grid: grid({ kind: ['bb'], len: [10, 20], k: [2, 2.5], trendLen: [0, 200], stopAtr: [2, 3], maxDays: [10], allowShort: [false, true] }) },
  d7: { name: 'Minim de N zile', grid: grid({ kind: ['d7'], trendLen: [100, 200], lookback: [5, 10], stopAtr: [2, 3], maxDays: [10], allowShort: [false] }) },
  kc: { name: 'Keltner', grid: grid({ kind: ['kc'], trendLen: [0, 200], len: [10, 20], k: [1.5, 2], stopAtr: [2, 3], maxDays: [10], allowShort: [false, true] }) }
};

async function main() {
  const refresh = process.argv.includes('--refresh');
  const INST = JSON.parse(JSON.stringify(require('../../config/forex_instruments.json')));
  INST.XAUUSD.typicalSpreadPips = 35; INST.XAUUSD.commissionPips = 10; INST.XAUUSD.swapRatePct = 4;
  const raw = await P.loadDaily('XAUUSD', INST.XAUUSD, refresh);
  const data = { XAUUSD: raw.filter((b) => b.timestamp >= Date.UTC(2003, 0, 1) && b.high > b.low) };
  const sim = (d, i, p, o) => lab.simulate(d, i, p, Object.assign({}, o, { execution: 'nextOpen' }));
  const team = teamWalkForward(data, INST, FAMILIES, sim, { trainYears: 3, minTrades: 15, bench: { off: true } });
  const out = { generatedAt: new Date().toISOString(), bars: data.XAUUSD.length, families: {} };
  const passed = [];
  for (const [k, f] of Object.entries(FAMILIES)) {
    const m = computeMetrics(team.byStrategy[k].oos);
    const ok = m.trades >= 60 && m.expectancyCI95 && m.expectancyCI95[0] > 0;
    out.families[k] = { name: f.name, trades: m.trades, winRatePct: m.winRatePct, expectancyR: m.expectancyR, ci: m.expectancyCI95, passed: ok };
    if (ok) passed.push(`${f.name}: +${m.expectancyR.toFixed(3)}R (${m.trades} tranzacții)`);
    console.log(`${f.name.padEnd(18)} n=${m.trades} E=${m.expectancyR == null ? '–' : m.expectancyR.toFixed(3)} IC95% ${m.expectancyCI95 ? m.expectancyCI95.map((v) => v.toFixed(3)).join(' … ') : '–'} ${ok ? '✅ TRECE' : ''}`);
  }
  fs.mkdirSync(path.join(DATA_DIR, 'research'), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'research', 'gold_report.json'), JSON.stringify(out, null, 2));
  if (passed.length && process.env.LIVE_TELEGRAM === '1') {
    await sendTelegram(`🥇 <b>Cercetarea lunară pe aur: o strategie a trecut testul strict!</b>\n${passed.join('\n')}\nO pun la antrenament live înainte de semnale reale.`, { enabled: true });
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { FAMILIES };
