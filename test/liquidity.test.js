'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const A = require('../src/strategies/liquidityAgent');
const { runLiquidityCycle } = require('../src/academy/liquidityLive');
const INSTR = require('../config/forex_instruments.json');

const DIR = path.join(__dirname, '..', 'data', 'fx', 'dk', 'm15');
const load = (months) => months.flatMap((m) => zlib.gunzipSync(fs.readFileSync(path.join(DIR, `XAUUSD_${m}.csv.gz`))).toString().split('\n').slice(1))
  .filter(Boolean).map((l) => { const [t, o, h, lo, c] = l.split(',').map(Number); return { t, o, h, l: lo, c }; }).filter((b) => !(b.h === b.l && b.o === b.c));
const BARS = load(['2025_08', '2025_09', '2025_10']);

test('agentul Lichiditate nu se uită în viitor: semnalele de pe istoric apar la fel când datele se opresc la bara lor', () => {
  const all = A.findSignals(BARS);
  assert.ok(all.length > 10, `semnale: ${all.length}`);
  for (const s of all.filter((_, k) => k % 7 === 0)) {
    const cut = BARS.slice(0, s.i + 1);
    const again = A.findSignals(cut).filter((x) => x.i === s.i && x.dir === s.dir && x.setup === s.setup);
    assert.ok(again.length >= 1, `semnalul de la ${new Date(s.t).toISOString()} (${s.setup}) nu apare cu datele tăiate`);
  }
});

test('agentul Lichiditate live: antrenament fără mesaje; cu LIQ_DEMO_SIGNALS=1 trimite intrarea și ieșirea marcate DEMO', async () => {
  const sigs = A.findSignals(BARS).filter((s) => new Date(s.t).getUTCHours() >= 8 && new Date(s.t).getUTCHours() < 17);
  const s = sigs[Math.floor(sigs.length / 2)];
  const fetchAt = (now) => async (sym) => (sym === 'XAUUSD' ? BARS.filter((b) => b.t + 900e3 <= now) : []);
  const run = async (env) => {
    const bus = { state: {} }, msgs = [];
    const notify = async (x) => { msgs.push(x); };
    let now = s.t + 900e3 + 90e3;
    await runLiquidityCycle({ bus, instruments: INSTR, fetchBars: fetchAt(now), notify, now, env });
    const opened = Boolean(bus.state.liq.open.XAUUSD);
    for (let k = 1; k <= 600 && bus.state.liq.open.XAUUSD; k++) { now += 900e3; await runLiquidityCycle({ bus, instruments: INSTR, fetchBars: fetchAt(now), notify, now, env }); }
    return { bus, msgs, opened };
  };
  const paper = await run({});
  assert.ok(paper.opened, 'poziție pe hârtie');
  assert.equal(paper.msgs.length, 0, 'fără mesaje la antrenament');
  assert.equal(paper.bus.state.liq.trades.length, 1);
  const t = paper.bus.state.liq.trades[0];
  assert.ok(['TP', 'SL', 'TIMP'].includes(t.outcome));
  const demo = await run({ LIQ_DEMO_SIGNALS: '1' });
  assert.match(demo.msgs[0], /DEMO · AUR \(XAUUSD\)/);
  assert.match(demo.msgs[0], /SL: <b>[\d.]+ \$<\/b>/);
  assert.match(demo.msgs[0], /Lot: <b>\d+\.\d\d<\/b>/);
  assert.equal(demo.msgs.length, 2, demo.msgs.join('\n---\n'));
  assert.match(demo.msgs[1], /DEMO · AUR/);
});
