'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { runPropCycle, phaseTarget } = require('../src/propLive');
const { PROP_RULES } = require('../src/prop/rules');
const { loadConfig } = require('../src/config');

test('sincronizarea cu contul real: sold, cea mai bună zi și o singură aplicare pe id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const file = path.join(dir, 'prop_sync.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'a1', balance: 5210.95, highestEod: 5210.95, manualTrades: [{ sym: 'SPX500', closedAt: '2026-11-12T16:10:54Z', pnl: 214.75 }] }));
  const config = loadConfig(); config.propDesk = Object.assign({}, config.propDesk, { symbols: [] });
  const bus = { state: {}, logDiagnostic() {}, saveSnapshot() {} };
  const env = { PROP_SYNC_FILE: file };
  await runPropCycle({ config, instruments: require('../config/forex_instruments.json'), bus, notify: async () => {}, fetch: async () => ({ candles: [] }), now: Date.parse('2026-11-13T10:00:00Z'), env });
  const acct = bus.state.prop;
  assert.equal(acct.balance, 5210.95);
  assert.equal(acct.history.filter((h) => h.strategy === 'manual').length, 1);
  assert.equal(phaseTarget(acct, PROP_RULES.FTM_1STEP_NITRO), 0.10); // 214,75 $ < 250 $: ținta rămâne 500 $
  acct.balance = 5300; // a doua rulare cu același id nu mai suprascrie
  await runPropCycle({ config, instruments: require('../config/forex_instruments.json'), bus, notify: async () => {}, fetch: async () => ({ candles: [] }), now: Date.parse('2026-11-13T10:05:00Z'), env });
  assert.equal(bus.state.prop.balance, 5300);
});
