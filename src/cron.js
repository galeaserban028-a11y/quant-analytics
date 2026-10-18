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
const { runPropCycle, propSummary } = require('./propLive');
const FX_INSTRUMENTS = require('../config/forex_instruments.json');
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

  // Dacă trebuie să trimită pe Telegram dar lipsesc datele, NU avansăm starea (altfel s-ar pierde mesaje)
  if (LIVE && (!process.env.TELEGRAM_TOKEN || !(process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID))) {
    console.log('Lipsesc TELEGRAM_TOKEN / TELEGRAM_CHAT_ID (secretele din GitHub). Aștept configurarea; starea rămâne neschimbată.');
    return;
  }

  const trendOn = Boolean((config.trendDesk || {}).enabled);
  const propOn = Boolean((config.propDesk || {}).enabled);
  if (!trendOn && !propOn) {
    console.log('Niciun departament activ (nu au trecut validarea sau au fost dezactivate). Nimic de făcut.');
    return;
  }

  // Departamentul PROP (Forex / aur / indici, zilnic)
  let nErr = 0, nSym = 0;
  const reports = {};
  if (propOn) {
    const pr = await runPropCycle({ config, instruments: FX_INSTRUMENTS, bus, notify, now });
    reports.prop = pr;
    nErr += Object.keys(pr.errors || {}).length;
    nSym += (config.propDesk.symbols || []).length;
    console.log(`${new Date(now).toISOString()} | PROP | ${JSON.stringify(pr.account)} | evenimente: ${JSON.stringify(pr.events)} | erori: ${Object.keys(pr.errors || {}).length}`);
    if (Object.keys(pr.errors || {}).length) console.log('erori prop:', JSON.stringify(pr.errors));
  }
  // Departamentul TREND crypto (doar dacă e activ)
  const report = trendOn ? await runTrendCycle({ config, bus, notify, now }) : { openPositions: [], updated: [], errors: {} };
  if (trendOn) {
    nErr += Object.keys(report.errors || {}).length;
    nSym += (config.trendDesk.symbols || []).length;
    console.log(`${new Date(now).toISOString()} | TREND | poziții: ${report.openPositions.join(', ') || 'niciuna'} | evenimente: ${JSON.stringify(report.updated)}`);
  }

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
  const anyInit = (trendOn && st.initialized) || (propOn && bus.state.prop && bus.state.prop.initialized);
  if (hour >= 9 && st.heartbeatDate !== date && anyInit) {
    st.heartbeatDate = date;
    const parts = [`☀️ <b>APEX QUANT: verificare zilnică</b>\nSistemul funcționează. Ultima verificare: ${roTime(now)}.`];
    if (propOn) parts.push(propSummary(bus.state.prop, config));
    if (trendOn) {
      const pos = Object.values(st.positions);
      parts.push(pos.length ? `Crypto trend: ${pos.map((p) => `${p.symbol} ${p.direction} (stop ${p.stop.toPrecision(6)})`).join(', ')}` : 'Crypto trend: nicio poziție.');
    }
    if (nErr) parts.push(`⚠️ ${nErr}/${nSym} instrumente fără date la această verificare.`);
    await notify(parts.join('\n\n'));
  }

  bus.saveSnapshot();
}

main().catch((err) => {
  console.error('EROARE NEAȘTEPTATĂ:', err);
  process.exitCode = 1; // planificatorul (GitHub) îți trimite email la rulările eșuate
});
