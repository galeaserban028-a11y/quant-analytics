'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, formatSignal, formatEvent, sendTelegram } = require('../src/notify/telegram');
const { goldSetup } = require('./helpers');

test('escapare HTML', () => {
  assert.equal(escapeHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
});

test('mesajul de semnal conține nivelurile și disclaimer-ul, fără taguri HTML nevalide', async () => {
  const { orch } = goldSetup();
  const { signals } = await orch.runCycle(['XAUUSD']);
  const msg = formatSignal(signals[0], orch.config.instruments.XAUUSD);
  assert.match(msg, /BUY la piață/);
  assert.match(msg, /2650\.20/);
  assert.match(msg, /nu sfat financiar/);
  const tags = msg.match(/<\/?([a-z]+)[^>]*>/g) || [];
  for (const t of tags) assert.match(t, /^<\/?(b|i|code)>$/);
});

test('mesajele de eveniment', () => {
  const inst = { decimals: 2 };
  assert.match(formatEvent({ type: 'CLOSED', outcome: 'SL', symbol: 'XAUUSD', price: 1, resultR: -1.02 }, inst), /-1\.02R/);
  assert.match(formatEvent({ type: 'TP1', symbol: 'XAUUSD', price: 2, newStop: 1, partialPct: 0.5 }, inst), /50%/);
});

test('Telegram este DRY-RUN implicit (nu trimite nimic fără permisiune explicită)', async () => {
  const res = await sendTelegram('test', { token: 'x', chatId: 'y' });
  assert.equal(res.sent, false);
  assert.equal(res.mode, 'DRY_RUN');
});
