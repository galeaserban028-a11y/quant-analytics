'use strict';

/**
 * Dobânzile lunare pe termen scurt (data/fx/rates.csv, din FRED). Fără look-ahead: la momentul t folosim
 * valoarea lunii ANTERIOARE (datele unei luni se publică după ce luna se încheie).
 */
const fs = require('fs');
const path = require('path');

const RATES_FILE = path.join(__dirname, '..', '..', 'data', 'fx', 'rates.csv');

function parseRates(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const months = {};
  for (const line of lines.slice(1)) {
    const p = line.split(',');
    const row = {};
    head.slice(1).forEach((c, k) => { const v = parseFloat(p[k + 1]); if (Number.isFinite(v)) row[c] = v; });
    months[p[0]] = row;
  }
  return { months, keys: Object.keys(months).sort() };
}

function loadRates(file = RATES_FILE) {
  if (!fs.existsSync(file)) return null;
  return parseRates(fs.readFileSync(file, 'utf8'));
}

/** Dobânda unei monede la momentul ts, din luna anterioară (sau cea mai recentă cunoscută înainte). */
function rateAt(table, cur, ts) {
  if (!table) return null;
  const d = new Date(ts);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  let lo = 0, hi = table.keys.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (table.keys[mid] <= prev) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  for (let k = idx; k >= 0 && k > idx - 6; k--) { const v = table.months[table.keys[k]][cur]; if (Number.isFinite(v)) return v; }
  return null;
}

/** Diferența de dobândă bază − cotată (în %), sau null dacă lipsește. */
function diffAt(table, base, quote, ts) {
  const a = rateAt(table, base, ts), b = rateAt(table, quote, ts);
  return a == null || b == null ? null : a - b;
}

module.exports = { loadRates, parseRates, rateAt, diffAt, RATES_FILE };
