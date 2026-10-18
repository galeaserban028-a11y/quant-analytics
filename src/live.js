'use strict';

/**
 * Runner LIVE: la fiecare ciclu preia date reale, gestionează pozițiile deschise, caută setup-uri noi
 * și trimite mesaje pe Telegram (doar dacă LIVE_TELEGRAM=1; altfel DRY-RUN în consolă).
 *
 * Rulare: npm run live
 */
const http = require('http');
const path = require('path');
const { loadEnv } = require('./util/env');
const { ApexQuantOrchestrator } = require('./orchestrator');
const { fetchAll } = require('./data/marketFeed');
const { formatSignal, formatEvent, sendTelegram } = require('./notify/telegram');
const { runTrendCycle } = require('./trendLive');

loadEnv(path.join(__dirname, '..', '.env'));

const LIVE = process.env.LIVE_TELEGRAM === '1';
const CYCLE_SECONDS = Math.max(30, parseInt(process.env.CYCLE_SECONDS || '60', 10));

const { loadConfig } = require('./config');
const orch = new ApexQuantOrchestrator(loadConfig());
const bus = orch.stateBus;
const newsCache = {};
const status = { startedAt: new Date().toISOString(), lastCycle: null, lastErrors: {}, openTrades: 0, liveTelegram: LIVE };

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function notify(text) {
  const res = await sendTelegram(text, { enabled: LIVE });
  if (!res.sent) log(`[telegram ${res.mode || res.statusCode}]\n${text.replace(/<[^>]+>/g, '')}`);
  return res;
}

let lastTrendCheck = 0;
let trendFailStreak = 0;
let outageNotified = false;

async function cycle() {
  const now = Date.now();

  // A. Departamentul Trend (H4) — verificat la fiecare 5 minute; acționează doar la lumânări H4 noi
  if ((orch.config.trendDesk || {}).enabled && now - lastTrendCheck >= 5 * 60e3) {
    lastTrendCheck = now;
    const tr = await runTrendCycle({ config: orch.config, bus, notify, now });
    status.trend = { openPositions: tr.openPositions, errors: tr.errors, lastCheck: new Date(now).toISOString() };
    if (tr.updated && tr.updated.length) log('trend:', JSON.stringify(tr.updated));
    const nErr = tr.errors ? Object.keys(tr.errors).length : 0;
    if (nErr) log('trend erori:', JSON.stringify(tr.errors));
    // Alertă o singură dată dacă TOATE simbolurile eșuează 3 verificări la rând (internet/Binance căzut)
    const allFailed = nErr > 0 && nErr >= ((orch.config.trendDesk.symbols || []).length);
    trendFailStreak = allFailed ? trendFailStreak + 1 : 0;
    if (trendFailStreak >= 3 && !outageNotified) {
      outageNotified = true;
      await notify('⚠️ <b>APEX QUANT</b>: datele de piață sunt indisponibile de ~15 minute. Pozițiile deschise NU sunt urmărite până revin datele — verifică manual stopurile.');
    }
    if (!allFailed && outageNotified) { outageNotified = false; await notify('✅ <b>APEX QUANT</b>: datele de piață au revenit, monitorizarea continuă.'); }
  }

  // B. Departamentul SMC (M15) — semnale doar dacă a trecut validarea; altfel doar observație opțională
  const smcEnabled = Boolean((orch.config.smcDesk || {}).enabled);
  const observe = process.env.OBSERVE_SMC === '1';
  if (!smcEnabled && !observe && !Object.keys(bus.state.activeTrades).length) {
    status.lastCycle = new Date(now).toISOString();
    return;
  }
  const { payloads, errors, macro, news } = await fetchAll(orch.config, { now, newsCache });
  for (const [s, p] of Object.entries(payloads)) orch.ingest(s, p);

  // 1. Pozițiile deschise: lumânările închise noi (de după intrare) + tick-ul curent
  for (const symbol of Object.keys(bus.state.activeTrades)) {
    const p = payloads[symbol];
    if (!p) continue;
    const trade = bus.getActiveTrade(symbol);
    const inst = orch.config.instruments[symbol];
    const lastTs = trade.meta && trade.meta.lastEvaluatedTs ? trade.meta.lastEvaluatedTs : 0;
    const bars = p.m15Candles.filter((c) => c.timestamp >= trade.openedAt && c.timestamp > lastTs);
    const spread = p.spotAsk - p.spotBid;
    const tick = { timestamp: now, open: p.spotBid, high: p.spotBid, low: p.spotBid, close: p.spotBid };
    const { events, closed } = orch.manageTrade(symbol, bars.concat([tick]), spread);
    if (!closed && bars.length) {
      const t = bus.getActiveTrade(symbol);
      t.meta = Object.assign({}, t.meta, { lastEvaluatedTs: bars[bars.length - 1].timestamp });
    }
    for (const ev of events) await notify(formatEvent(ev, inst));
  }

  // 2. Setup-uri noi (dacă departamentul nu e validat: evaluare fără semnale)
  const { evaluated, signals } = await orch.runCycle(undefined, {}, { dryRun: !smcEnabled });
  for (const trade of signals) await notify(formatSignal(trade, orch.config.instruments[trade.symbol]));

  status.lastCycle = new Date(now).toISOString();
  status.lastErrors = errors;
  status.openTrades = Object.keys(bus.state.activeTrades).length;
  status.macro = macro;

  const scores = Object.entries(evaluated)
    .map(([s, c]) => `${s}:${c.activeTrade ? 'ACTIV' : (c.finalScore !== undefined ? c.finalScore : '-')}${c.vetoed ? '(veto)' : ''}`)
    .join(' ');
  log(`ciclu #${bus.state.meta.totalCycles} | USD=${macro.usdBias || 'n/a'} | știri=${news.available ? 'ok' : 'INDISPONIBIL'} | erori=${Object.keys(errors).length} | ${scores}`);
  if (Object.keys(errors).length) log('erori date:', JSON.stringify(errors));
}

function startHealthServer() {
  const port = process.env.PORT;
  if (!port) return;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }).listen(port, () => log(`health endpoint pe portul ${port}`));
}

async function main() {
  log(`APEX QUANT live — Telegram: ${LIVE ? 'ACTIV' : 'DRY-RUN (setează LIVE_TELEGRAM=1 ca să trimită)'} — ciclu: ${CYCLE_SECONDS}s`);
  log(`Departamente: Trend H4 = ${(orch.config.trendDesk || {}).enabled ? 'ACTIV (validat)' : 'inactiv'} | SMC M15 = ${(orch.config.smcDesk || {}).enabled ? 'ACTIV (validat)' : 'inactiv (nevalidat; OBSERVE_SMC=1 pentru observație)'}`);
  startHealthServer();
  let running = false;
  const tick = async () => {
    if (running) return; // nu suprapunem cicluri lente
    running = true;
    try { await cycle(); } catch (err) { log('eroare ciclu:', err.message); bus.logDiagnostic('live.cycle', err); }
    running = false;
  };
  await tick();
  const timer = setInterval(tick, CYCLE_SECONDS * 1000);
  const stop = () => { clearInterval(timer); bus.saveSnapshot(); log('oprit, stare salvată.'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();

module.exports = { cycle };
