'use strict';

/**
 * Lumânări ZILNICE pentru Forex / aur / indici, din surse gratuite:
 *   1) Yahoo Finance (aceeași sursă ca în cercetare);
 *   2) Stooq (rezervă, CSV fără cheie).
 * Doar lumânările ÎNCHISE sunt păstrate (regula depinde de sesiunea instrumentului), iar vârfurile false sunt curățate.
 */
const https = require('https');
const { getJson } = require('./http');
const { normalizeCandles, cleanSpikes } = require('../core/candles');

const HOUR = 36e5;

/** Câte ore după timestamp-ul lumânării zilnice se consideră închisă (Yahoo pune timestamp-ul la deschiderea sesiunii). */
function sessionHours(inst) {
  if (inst.sessionHours) return inst.sessionHours;
  if (inst.category === 'INDEX') return inst.baseCurrency === 'GER40' ? 9 : 7;
  if (inst.category === 'METAL') return 23.5;
  return 24;
}

function parseYahooChart(d) {
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !Array.isArray(res.timestamp)) throw new Error('YAHOO_EMPTY');
  const q = res.indicators.quote[0];
  const out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every((v) => typeof v === 'number' && Number.isFinite(v))) out.push({ timestamp: res.timestamp[i] * 1000, open: o, high: h, low: l, close: c, volume: 0 });
  }
  return out;
}

function parseStooqCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (!lines.length || !/date/i.test(lines[0])) throw new Error('STOOQ_INVALID');
  const out = [];
  for (const line of lines.slice(1)) {
    const [date, o, h, l, c] = line.split(',');
    const ts = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(ts)) out.push({ timestamp: ts, open: +o, high: +h, low: +l, close: +c, volume: 0 });
  }
  return out;
}

function getText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (apex-quant)' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(body) : reject(new Error(`HTTP_${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
  });
}

/**
 * Păstrează doar lumânările închise la momentul `now`.
 * Stooq etichetează lumânarea cu data (miezul nopții UTC), deci acolo o considerăm închisă abia după 24h (prudent).
 */
function closedDaily(candles, inst, now, source = 'yahoo') {
  const h = source === 'stooq' ? 24 : sessionHours(inst);
  return candles.filter((c) => c.timestamp + h * HOUR <= now);
}

/** Elimină rândurile cu OHLC imposibil (Yahoo are câteva la Forex). Aceeași regulă ca în cercetare. */
function validOhlc(candles) {
  return candles.filter((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0);
}

async function fetchDaily(inst, { now = Date.now(), years = 3 } = {}) {
  let raw = null;
  let source = null;
  const errors = [];
  if (inst.yahoo) {
    try {
      raw = parseYahooChart(await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?interval=1d&range=${years}y`, { retries: 1 }));
      source = 'yahoo';
    } catch (err) { errors.push(`yahoo: ${err.message}`); }
  }
  if (!raw && inst.stooq) {
    try {
      raw = parseStooqCsv(await getText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(inst.stooq)}&i=d`));
      source = 'stooq';
    } catch (err) { errors.push(`stooq: ${err.message}`); }
  }
  if (!raw) throw new Error(`DATE_INDISPONIBILE (${errors.join('; ')})`);
  const candles = cleanSpikes(closedDaily(validOhlc(normalizeCandles(raw)), inst, now, source));
  return { candles, source };
}

module.exports = { fetchDaily, parseYahooChart, parseStooqCsv, closedDaily, sessionHours, validOhlc };
