'use strict';
/**
 * Diagnostic Telegram: verifică cheia (getMe) și trimite un mesaj de test. Scrie rezultatul în state/telegram_check.json
 * FĂRĂ cheie și FĂRĂ ID de chat (doar dacă sunt valide și ce răspunde Telegram), ca să poată fi citit în repo.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

function call(method, token, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(`https://api.telegram.org/bot${token}/${method}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}, timeout: 15000 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* nimic */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (body) req.write(payload);
    req.end();
  });
}

(async () => {
  const rawToken = process.env.TELEGRAM_TOKEN || '';
  const rawChat = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '';
  const token = rawToken.trim(), chat = rawChat.trim();
  const out = {
    at: new Date().toISOString(),
    tokenPresent: Boolean(token), tokenHadSpaces: rawToken !== token, tokenFormatOk: /^\d+:[A-Za-z0-9_-]{30,}$/.test(token),
    chatPresent: Boolean(chat), chatHadSpaces: rawChat !== chat, chatLooksNumeric: /^-?\d+$/.test(chat)
  };
  if (token) {
    const me = await call('getMe', token);
    out.tokenValid = Boolean(me.json && me.json.ok);
    out.botUsername = me.json && me.json.ok ? '@' + me.json.result.username : null;
    out.getMeError = me.json && !me.json.ok ? me.json.description : (me.error || null);
  }
  if (token && chat && out.tokenValid) {
    const r = await call('sendMessage', token, { chat_id: chat, text: '✅ Test APEX: legătura cu Telegram funcționează. De acum primești aici semnalele.' });
    out.sendOk = Boolean(r.json && r.json.ok);
    out.sendError = r.json && !r.json.ok ? r.json.description : (r.error || null);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'state', 'telegram_check.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out));
})();
