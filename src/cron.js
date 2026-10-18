'use strict';

/**
 * Rulare UNICĂ (pentru planificatoare: GitHub Actions, Task Scheduler, cron):
 * face un ciclu al Departamentului Trend, salvează starea și se oprește.
 * Rulat la fiecare oră, acoperă fiecare lumânare H4 nou închisă.
 *
 * În plus:
 *  - mesaj zilnic de verificare („sunt viu”) la ora 9 (ora României);
 *  - alertă dacă datele lipsesc 3 rulări la rând, și mesaj la revenire.
 *
 * Variabile: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, LIVE_TELEGRAM=1, ACCOUNT_EQUITY (opțional), STATE_PATH (opțional)
 */
const path = require('path');
const { loadEnv } = require('./util/env');
loadEnv(path.join(__dirname, '..', '.env'));

const { loadConfig } = require('./config');
const MarketStateBus = require('./core/MarketStateBus');
const { runTrendCycle } = require('./trendLive');
const { sendTelegram, roTime } = require('./notify/telegram');

const LIVE = process.env.LIVE_TELEGRAM === '1';
const STATE_PATH = process.env.STATE_PATH
  ? path.resolve(process.env.STATE_PATH)
  : path.join(__dirname, '..', 'data', 'state_snapshot.json');

function roHourAndDate(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { hour: parseInt(get('hour'), 10), date: `${get('year')}-${get('month')}-${get('day')}` };
}

async function main() {
  const now = Date.now();
  const config = loadConfig();
  const bus = new MarketStateBus(config, { snapshotPath: STATE_PATH });
  const st = bus.state.trend;
  const sent = [];
  const notify = async (text) => {
    const res = await sendTelegram(text, { enabled: LIVE });
    sent.push(res.sent ? 'trimis' : (res.mode || res.statusCode));
    console.log(`[telegram ${res.sent ? 'OK' : (res.mode || res.statusCode)}] ${text.replace(/<[^>]+>/g, '').split('\n')[0]}`);
    if (LIVE && !res.sent) console.log('  eroare Telegram:', res.body || res.error || '');
    return res;
  };

  if (!(config.trendDesk || {}).enabled) {
    console.log('Departamentul Trend nu este activ (nu a trecut validarea). Nimic de făcut.');
    return;
  }

  const report = await runTrendCycle({ config, bus, notify, now });
  const nSym = (config.trendDesk.symbols || []).length;
  const nErr = Object.keys(report.errors || {}).length;
  console.log(`${new Date(now).toISOString()} | poziții deschise: ${report.openPositions.join(', ') || 'niciuna'} | evenimente: ${JSON.stringify(report.updated)} | erori: ${nErr}`);
  if (nErr) console.log('erori:', JSON.stringify(report.errors));

  // Alertă de date (persistată între rulări)
  const allFailed = nErr > 0 && nErr >= nSym;
  st.failStreak = allFailed ? (st.failStreak || 0) + 1 : 0;
  if (st.failStreak >= 3 && !st.outageNotified) {
    st.outageNotified = true;
    await notify('⚠️ <b>APEX QUANT</b>: datele de piață sunt indisponibile de 3 rulări la rând (~3 ore). Pozițiile NU sunt urmărite până revin datele. Verifică manual stopurile.');
  }
  if (!allFailed && st.outageNotified) {
    st.outageNotified = false;
    await notify('✅ <b>APEX QUANT</b>: datele de piață au revenit, monitorizarea continuă.');
  }

  // Mesaj zilnic de verificare
  const { hour, date } = roHourAndDate(now);
  if (hour >= 9 && st.heartbeatDate !== date && st.initialized) {
    st.heartbeatDate = date;
    const pos = Object.values(st.positions);
    const lines = pos.map((p) => `• ${p.symbol} ${p.direction}: intrare ${p.entry.toPrecision(6)}, stop actual ${p.stop.toPrecision(6)} (din ${roTime(p.openedAt)})`);
    await notify(`☀️ <b>APEX QUANT: verificare zilnică</b>\nSistemul funcționează. Ultima verificare: ${roTime(now)}.\n` +
      (pos.length ? `Poziții deschise (${pos.length}):\n${lines.join('\n')}` : 'Nicio poziție deschisă. Așteptăm un trend ascendent.') +
      (nErr ? `\n⚠️ ${nErr}/${nSym} monede fără date la această verificare.` : ''));
  }

  bus.saveSnapshot();
}

main().catch((err) => {
  console.error('EROARE NEAȘTEPTATĂ:', err);
  process.exitCode = 1; // planificatorul (GitHub) îți trimite email la rulările eșuate
});
