'use strict';

const fs = require('fs');
const path = require('path');
const sources = require('../data/sources');
const { normalizeCandles } = require('../core/candles');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * CSV cu antet: timestamp,open,high,low,close[,volume]
 * timestamp poate fi milisecunde, secunde sau dată ISO (ex: 2025-03-01T14:15:00Z).
 * Separatorul poate fi virgulă sau punct și virgulă.
 */
function loadCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const hasHeader = header.some((h) => /time|date|open/.test(h));
  const col = (name, fallback) => { const i = header.findIndex((h) => h.startsWith(name)); return i >= 0 ? i : fallback; };
  const idx = hasHeader
    ? { t: col('time', col('date', 0)), o: col('open', 1), h: col('high', 2), l: col('low', 3), c: col('close', 4), v: col('vol', 5) }
    : { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
  const rows = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const p = line.split(sep);
    const rawT = p[idx.t] && p[idx.t].trim();
    let ts = Number(rawT);
    if (!Number.isFinite(ts)) ts = Date.parse(rawT.includes('T') || rawT.endsWith('Z') ? rawT : rawT.replace(' ', 'T') + 'Z');
    else if (ts < 1e12) ts *= 1000;
    rows.push({ timestamp: ts, open: +p[idx.o], high: +p[idx.h], low: +p[idx.l], close: +p[idx.c], volume: p[idx.v] !== undefined ? +p[idx.v] || 0 : 0 });
  }
  return normalizeCandles(rows);
}

function cachePath(symbol, days) {
  return path.join(DATA_DIR, 'cache', `${symbol}_${days}d.json`);
}

/**
 * Încarcă lumânări M15 pentru backtest, în ordinea: CSV local → cache (<12h) → descărcare.
 * Crypto: Binance (până la ~1 an). FX/aur: Yahoo (maxim ~60 de zile la 15m — limita sursei gratuite).
 */
async function loadSymbol(symbol, inst, { days = 60, csvDir = path.join(DATA_DIR, 'csv'), log = () => {} } = {}) {
  const csv = path.join(csvDir, `${symbol}.csv`);
  if (fs.existsSync(csv)) {
    const c = loadCsv(csv);
    log(`${symbol}: ${c.length} lumânări din CSV (${csv})`);
    return { candles: c, source: 'csv' };
  }
  const cp = cachePath(symbol, days);
  if (fs.existsSync(cp) && Date.now() - fs.statSync(cp).mtimeMs < 12 * 3600e3) {
    const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
    log(`${symbol}: ${c.length} lumânări din cache`);
    return { candles: c, source: 'cache' };
  }
  let candles;
  if (inst.candles.source === 'binance') {
    candles = await sources.binanceHistory(inst.candles.id, days);
  } else if (inst.candles.source === 'yahoo') {
    if (days > 60) log(`${symbol}: Yahoo oferă maxim 60 de zile la 15m; pentru mai mult pune un CSV în data/csv/${symbol}.csv`);
    candles = await sources.yahooCandles(inst.candles.id, { range: `${Math.min(60, days)}d` });
  } else {
    throw new Error(`Sursă necunoscută pentru ${symbol}`);
  }
  fs.mkdirSync(path.dirname(cp), { recursive: true });
  fs.writeFileSync(cp, JSON.stringify(candles));
  log(`${symbol}: ${candles.length} lumânări descărcate (${inst.candles.source})`);
  return { candles, source: inst.candles.source };
}

module.exports = { loadCsv, loadSymbol, DATA_DIR };
