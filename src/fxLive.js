'use strict';

/**
 * ACADEMIA FOREX — ciclul LIVE. Doar agenții cu grad ELITĂ (decis la școala lunară) trimit semnale reale,
 * fiecare pe perechea lui, prin același motor ca restul companiei (Gardian, loturi, faze, Telegram).
 *
 * Date live: lumânări orare Yahoo, grupate pe zile UTC (ca istoricul Dukascopy din cercetare). Am verificat că
 * lumânările Yahoo ORARE sunt aliniate corect; cele ZILNICE de la Yahoo pentru Forex nu sunt, de aceea nu le folosim.
 */
const { getJson } = require('./data/http');
const { parseYahooChart, validOhlc } = require('./data/dailySources');
const { runPropCycle } = require('./propLive');
const { loadRates } = require('./data/rates');

const DAY = 864e5;

/** Ore → zile UTC: sâmbăta dispare, fragmentul de duminică seara se lipește de luni; doar zilele deja închise. */
function hoursToUtcDays(hours, now) {
  const byDay = new Map();
  for (const h of hours) {
    const day = Math.floor(h.timestamp / DAY) * DAY;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(h);
  }
  const today = Math.floor(now / DAY) * DAY;
  const days = [];
  let sunday = null;
  for (const day of Array.from(byDay.keys()).sort((a, b) => a - b)) {
    if (day >= today) continue; // ziua de azi încă nu s-a închis
    const hs = byDay.get(day).sort((a, b) => a.timestamp - b.timestamp);
    const wd = new Date(day).getUTCDay();
    const bar = { timestamp: day, open: hs[0].open, high: Math.max(...hs.map((x) => x.high)), low: Math.min(...hs.map((x) => x.low)), close: hs[hs.length - 1].close, volume: 0, n: hs.length };
    if (wd === 6) continue;
    if (wd === 0) { sunday = bar; continue; }
    if (sunday && day - sunday.timestamp <= DAY) {
      bar.open = sunday.open; bar.high = Math.max(bar.high, sunday.high); bar.low = Math.min(bar.low, sunday.low); bar.n += sunday.n;
    }
    sunday = null;
    if (bar.n >= 12) days.push(bar);
  }
  return days;
}

async function fetchFxDaily(inst, { now = Date.now() } = {}) {
  const sym = inst.yahoo;
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1h&range=730d`, { retries: 1 });
  const hours = validOhlc(parseYahooChart(d));
  const candles = hoursToUtcDays(hours, now);
  return { candles, source: 'yahoo-1h' };
}

/** Transformă elita Academiei în „strategii” pentru motorul comun: câte una pe agent, doar pe perechea lui. */
function eliteToDesk(fxDesk) {
  const elite = fxDesk.elite || [];
  return Object.assign({}, fxDesk, {
    strategies: elite.map((a) => ({ id: a.id, kind: a.family, name: a.familyName, who: `${a.name} (${a.familyName})`, symbols: [a.pair], params: Object.assign({}, a.params, { kind: a.family }) })),
    symbols: Array.from(new Set(elite.map((a) => a.pair))),
    onePerSymbol: true
  });
}

async function runFxCycle({ config, instruments, bus, notify, fetch, now = Date.now(), env = process.env }) {
  const fx = config.fxDesk || {};
  if (!fx.enabled) return { skipped: 'ACADEMIA_OPRITĂ' };
  if (!(fx.elite || []).length) return { skipped: 'NICIUN_AGENT_ELITĂ' };
  const cfg = Object.assign({}, config, { fxLive: eliteToDesk(fx) });
  return runPropCycle({ config: cfg, instruments, bus, notify, fetch: fetch || ((sym, inst) => fetchFxDaily(inst, { now })), now, env, deskKey: 'fxLive', stateKey: 'fx', label: 'APEX FOREX', simOpts: { rates: loadRates() } });
}

module.exports = { runFxCycle, hoursToUtcDays, fetchFxDaily, eliteToDesk };
