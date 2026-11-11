'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const A = require('../src/strategies/amtAgent');
const { runToniCycle } = require('../src/academy/toniLive');
const { applyContractSizes } = require('../src/propLive');
const INSTR = applyContractSizes(require('../config/forex_instruments.json'), 'SPX500=50,NAS100=20,GER40=25');

const DIR = path.join(__dirname, '..', 'data', 'fx', 'dk', 'm15');
const load = (sym, months) => months.flatMap((m) => zlib.gunzipSync(fs.readFileSync(path.join(DIR, `${sym}_${m}.csv.gz`))).toString().split('\n').slice(1))
  .filter(Boolean).map((l) => { const [t, o, h, lo, c] = l.split(',').map(Number); return { t, o, h, l: lo, c }; }).filter((b) => !(b.h === b.l && b.o === b.c));
const NQ = load('USATECHIDXUSD', ['2025_01', '2025_02', '2025_03', '2025_04', '2025_05', '2025_06', '2025_07', '2025_08', '2025_09', '2025_10']);

test('Toni nu se uită în viitor: semnalele apar la fel când datele se opresc la lumânarea lor', () => {
  const all = A.findSignals(NQ, A.MARKETS.NAS100);
  assert.ok(all.length > 10, `semnale: ${all.length}`);
  // varianta 2: doar zile care s-au deschis în afara zonei de valoare de ieri
  const S = A.sessions(NQ, A.MARKETS.NAS100);
  for (const s of all) { const o = NQ[S.find((x) => x.day === s.day).idx[0]].o; assert.ok(o >= s.VAH || o <= s.VAL, 'deschidere în afara VA'); }
  for (const s of all.filter((_, k) => k % 5 === 0)) {
    const again = A.findSignals(NQ.slice(0, s.i + 1), A.MARKETS.NAS100).filter((x) => x.i === s.i && x.dir === s.dir);
    assert.equal(again.length, 1, `semnalul de la ${new Date(s.t).toISOString()} nu apare cu datele tăiate`);
    assert.ok(s.dir < 0 ? s.stop > NQ[s.i].c && s.tp < NQ[s.i].c : s.stop < NQ[s.i].c && s.tp > NQ[s.i].c, 'SL și TP de partea corectă');
    assert.ok(s.dir < 0 ? s.tp === s.VAL : s.tp === s.VAH, 'varianta 2: TP la marginea opusă a zonei de valoare');
  }
});

test('Toni live: trimite intrarea și ieșirea marcate TEST, cu lot pe contract size-ul brokerului; implicit doar ține scorul și trimite rezumatul zilei', async () => {
  const s = A.findSignals(NQ, A.MARKETS.NAS100)[3];
  const fetchAt = (now) => async (sym) => (sym === 'NAS100' ? NQ.filter((b) => b.t + 900e3 <= now) : []);
  const run = async (env) => {
    const bus = { state: {} }, msgs = [];
    const notify = async (x) => { msgs.push(x); };
    let now = s.t + 900e3 + 90e3;
    await runToniCycle({ bus, instruments: INSTR, fetchBars: fetchAt(now), notify, now, env });
    const opened = Boolean(bus.state.toni.open.NAS100);
    for (let k = 1; k <= 200 && bus.state.toni.open.NAS100; k++) { now += 900e3; await runToniCycle({ bus, instruments: INSTR, fetchBars: fetchAt(now), notify, now, env }); }
    return { bus, msgs, opened };
  };
  const live = await run({ TONI_SIGNALS: '1' });
  assert.ok(live.opened, 'poziție deschisă');
  assert.equal(live.bus.state.toni.trades.length, 1, 'tranzacția s-a închis și e în scor');
  assert.equal(live.msgs.filter((m) => !/rezumatul zilei/.test(m)).length, 2, live.msgs.join('\n---\n'));
  assert.match(live.msgs[0], /TEST TONI/);
  assert.match(live.msgs[0], /Lot: <b>0\.\d\d<\/b>/);
  assert.match(live.msgs[1], /Scorul pe NAS100: 1 tranzacții/);
  const quiet = await run({});
  assert.equal(quiet.bus.state.toni.trades.length, 1);
  assert.ok(quiet.msgs.every((m) => /rezumatul zilei/.test(m)), 'fără mesaje pe fiecare tranzacție');
  // rezumatul: după 23:15 ora României, în ziua închiderii
  const closed = quiet.bus.state.toni.trades[0].closedAt;
  const d = A.local(closed, 'Europe/Bucharest').day;
  const at = Date.parse(d + 'T21:20:00Z'); // 23:20 ora României (iarna) / 00:20 vara
  const bus = quiet.bus; bus.state.toni.summaryDay = null; const msgs = [];
  await runToniCycle({ bus, instruments: INSTR, fetchBars: async () => [], notify: async (x) => { msgs.push(x); }, now: at, env: {} });
  if (A.local(at, 'Europe/Bucharest').day === d) { assert.equal(msgs.length, 1); assert.match(msgs[0], /Media de la pornire/); assert.match(msgs[0], /NASDAQ/); }
});
