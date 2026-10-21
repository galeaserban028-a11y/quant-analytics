'use strict';
/**
 * Trimite pe Telegram un SEMNAL DE TEST, construit exact ca unul real (același format, aceleași calcule de lot, stop,
 * take profit), pe ultimul preț de închidere US30. Marcat clar „TEST — NU EXECUTA”.
 */
const path = require('path');
const { loadCsv } = require('../src/backtest/dataLoader');
const { computeATR } = require('../src/core/candles');
const { flushSymbol, barCloseOf } = require('../src/propLive');
const { lotsFor } = require('../src/prop/lots');
const { PROP_RULES } = require('../src/prop/rules');
const { sendTelegram } = require('../src/notify/telegram');
const INST = require('../config/forex_instruments.json');

(async () => {
  const sym = 'US30', inst = INST[sym];
  const bars = loadCsv(path.join(__dirname, '..', 'data', 'fx', 'd1', `${sym}.csv`));
  const last = bars[bars.length - 1];
  const atr = computeATR(bars.slice(-16), 14);
  const entry = last.close, risk = 2 * atr, stop = entry - risk, tp = entry + 1.5 * risk;
  const acct = { initial: 10000, balance: 10000, dayStart: 10000, highestEod: 10000, phase: 0, tradingDays: [], positions: {} };
  const riskUsd = 10000 * 0.04;
  const lot = lotsFor(inst, riskUsd, risk, {});
  acct.positions[`${sym}|down`] = { lots: lot.lots, riskUsd: lot.actualRiskUsd, who: 'Bogdan (3 zile de scădere)' };
  const pointUsd = (lot.perLotRiskUsd / risk) * inst.pipSize;
  const msgs = [];
  await flushSymbol({ sym, inst, acct, rules: PROP_RULES.THE5ERS_HIGH_STAKES, label: 'APEX PROP', barClose: barCloseOf(last, inst), outExits: [],
    outEntries: [{ key: `${sym}|down`, who: 'Bogdan (3 zile de scădere)', position: { direction: 'LONG', entry, stop, tp }, lot, stopDist: risk, pointUsd, maxDays: 10 }],
    notify: async (t) => { msgs.push(t); } });
  const text = '🧪 <b>TEST — NU EXECUTA</b> (așa va arăta un semnal real)\n\n' + msgs.join('\n\n');
  if (process.env.PRINT) console.log(text.replace(/<[^>]+>/g, ''));
  const r = await sendTelegram(text, { enabled: true });
  console.log(r.sent ? 'Semnalul de test a fost trimis.' : `Netrimis: ${r.statusCode || r.mode} ${r.body || ''}`);
  if (!r.sent) process.exitCode = 1;
})();
