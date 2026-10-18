'use strict';

const https = require('https');

/** Escapare pentru parse_mode=HTML (Telegram acceptă doar &lt; &gt; &amp; în text). */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(v, decimals) {
  return Number.isFinite(v) ? v.toFixed(decimals) : 'n/a';
}

function formatSignal(trade, inst) {
  const d = inst.decimals;
  const m = trade.meta || {};
  const long = trade.direction === 'LONG';
  const e = escapeHtml;
  return [
    `⚡ <b>APEX QUANT SMC DESK</b>`,
    `📌 <b>${e(trade.symbol)}</b> — ${long ? '🟢 BUY la piață' : '🔴 SELL la piață'}`,
    `━━━━━━━━━━━━━━━━━━`,
    `📍 Intrare (${long ? 'ask' : 'bid'}): <code>${fmt(trade.entry, d)}</code>`,
    `🛑 Stop Loss: <code>${fmt(trade.initialStopLoss, d)}</code> (${e(m.riskPips)} pips)`,
    `💰 TP1 (${e(m.rrTp1)}R, încasează ${Math.round(trade.partialPct * 100)}%): <code>${fmt(trade.tp1, d)}</code>`,
    `🛡️ După TP1, SL la break-even protejat: <code>${fmt(trade.protectedBreakEven, d)}</code>`,
    `🔒 La ${e(m.rrTrail)}R, SL pe TP1: <code>${fmt(trade.trailingLock, d)}</code>`,
    `🚀 TP2 (${e(m.rrTp2)}R): <code>${fmt(trade.tp2, d)}</code>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🏛️ Scor confluență: <b>${e(m.score)}/100</b>`,
    `📏 Anti-chase: ${e(m.chasePct)}% | Spread: ${e(m.spreadPips)} pips (${e(m.spreadToRiskPct)}% din SL)`,
    `⏱️ Valabil ${e(m.validitySec)} secunde. După aceea, nu mai intra.`,
    `<i>Semnal algoritmic, nu sfat financiar. Verifică întâi rezultatele din backtest.</i>`
  ].join('\n');
}

function formatEvent(ev, inst) {
  const d = inst.decimals;
  const e = escapeHtml;
  switch (ev.type) {
    case 'TP1': return `🛡️ <b>${e(ev.symbol)}</b> TP1 atins (<code>${fmt(ev.price, d)}</code>). Încasează ${Math.round(ev.partialPct * 100)}% și mută SL la <code>${fmt(ev.newStop, d)}</code>.`;
    case 'TRAIL': return `🔒 <b>${e(ev.symbol)}</b> a atins nivelul de trailing. Mută SL pe TP1: <code>${fmt(ev.newStop, d)}</code>.`;
    case 'CLOSED': {
      const labels = { SL: '🛑 Stop loss', BE: '🛡️ Închis la break-even', TRAIL: '🔒 Închis pe trailing (TP1)', TP2: '🚀 TP2 atins', TP1_FULL: '💰 Închis integral la TP1', MAX_AGE: '⏳ Închis: poziție prea veche' };
      const r = Number.isFinite(ev.resultR) ? `${ev.resultR >= 0 ? '+' : ''}${ev.resultR.toFixed(2)}R` : '';
      return `${labels[ev.outcome] || ev.outcome}: <b>${e(ev.symbol)}</b> @ <code>${fmt(ev.price, d)}</code> (${r})`;
    }
    default: return `${e(ev.symbol)}: ${e(ev.type)}`;
  }
}

// ------------------------------------------------------------------ Departamentul Trend (H4)
function sizeLine(entry, stop, riskPct) {
  const equity = parseFloat(process.env.ACCOUNT_EQUITY || '');
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(equity) || equity <= 0 || !(risk > 0)) return `Risc recomandat: ${riskPct}% din cont (setează ACCOUNT_EQUITY ca să primești și mărimea poziției).`;
  const amount = equity * riskPct / 100;
  return `Risc ${riskPct}% = ${amount.toFixed(2)} USD → mărime: <b>${(amount / risk).toPrecision(4)}</b> unități (≈ ${(amount / risk * entry).toFixed(0)} USD expunere).`;
}

function roTime(ms) {
  return new Date(ms).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatTrendEntry(pos, inst, riskPct, now = Date.now()) {
  const d = inst.decimals;
  const long = pos.direction === 'LONG';
  const ageH = (now - pos.openedAt) / 3600e3;
  const ageLine = `🕒 Semnal la închiderea lumânării de ${roTime(pos.openedAt)} (ora României)` + (ageH > 1.5 ? ` — acum ${ageH.toFixed(1)} ore.` : '.');
  return [
    `📈 <b>DEPARTAMENTUL TREND (H4)</b>`,
    `📌 <b>${escapeHtml(pos.symbol)}</b>: ${long ? '🟢 CUMPĂRĂ (trend ascendent)' : '🔴 VINDE (trend descendent)'}`,
    `📍 Intrare (la închiderea H4): <code>${fmt(pos.entry, d)}</code>`,
    ageLine,
    ...(ageH > 8 ? ['⚠️ Semnalul e vechi. Intră doar dacă prețul e încă aproape de nivelul de intrare. Nu alerga după preț.'] : []),
    `🛑 Stop inițial: <code>${fmt(pos.initialStop, d)}</code>`,
    `🔁 Fără țintă fixă: stopul urcă automat (trailing). Vei primi un mesaj la fiecare mutare și la ieșire.`,
    sizeLine(pos.entry, pos.initialStop, riskPct),
    `<i>Validat out-of-sample în walk-forward. Profilul e tipic pentru trend: multe pierderi mici, câteva câștiguri mari.</i>`
  ].join('\n');
}

function formatTrendTrail(pos, inst, oldStop) {
  const d = inst.decimals;
  return `🔁 <b>${escapeHtml(pos.symbol)}</b> trend: mută stopul de la <code>${fmt(oldStop, d)}</code> la <code>${fmt(pos.stop, d)}</code>.`;
}

function formatTrendExit(symbol, inst, closed) {
  const d = inst.decimals;
  if (!closed) return `⏹️ <b>${escapeHtml(symbol)}</b> trend: poziția s-a închis.`;
  const r = Number.isFinite(closed.resultR) ? `${closed.resultR >= 0 ? '+' : ''}${closed.resultR.toFixed(2)}R` : '';
  const why = closed.outcome === 'STOP' ? 'stop atins' : (closed.outcome === 'SIGNAL_FLIP' ? 'trendul s-a întors' : closed.outcome);
  return `⏹️ <b>${escapeHtml(symbol)}</b> trend: IEȘIRE (${why}) @ <code>${fmt(closed.exitPrice, d)}</code> — ${r}`;
}

/**
 * Trimite un mesaj. Implicit DRY-RUN: trimite cu adevărat doar dacă enabled=true ȘI există token + chat id.
 */
function sendTelegram(text, { enabled = false, token = process.env.TELEGRAM_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID } = {}) {
  return new Promise((resolve) => {
    if (!enabled || !token || !chatId) return resolve({ sent: false, mode: 'DRY_RUN' });
    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ sent: res.statusCode === 200, statusCode: res.statusCode, body: res.statusCode === 200 ? undefined : body.slice(0, 300) }));
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (err) => resolve({ sent: false, mode: 'NETWORK_ERROR', error: err.message }));
    req.write(payload);
    req.end();
  });
}

module.exports = { roTime, escapeHtml, formatSignal, formatEvent, sendTelegram, formatTrendEntry, formatTrendTrail, formatTrendExit };
