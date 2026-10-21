'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tg = require('../src/notify/telegram');

test('telegram: ID-ul de chat valid din secret se folosește direct; ID-ul botului sau un nume nu', async () => {
  const token = '123456789:AAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(await tg.resolveChatId(token, ' 987654321 '), '987654321', 'spațiile se ignoră');
  assert.equal(await tg.resolveChatId(token, '-1001234'), '-1001234', 'grupurile au ID negativ');
});

test('telegram: ID-ul găsit automat se păstrează criptat și se citește doar cu același token', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')), 'chat.enc');
  tg.saveChat('111:tokenA', '555666777', f);
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes('555666777'), 'ID-ul nu apare în clar');
  assert.equal(tg.loadChat('111:tokenA', f), '555666777');
  assert.equal(tg.loadChat('111:tokenB', f), null, 'alt token nu-l poate citi');
});
