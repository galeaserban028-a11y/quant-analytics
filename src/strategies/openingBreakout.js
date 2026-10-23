'use strict';

/**
 * SPARGEREA DESCHIDERII BURSEI AMERICANE (S&P 500, Nasdaq), lumânări de 15 minute, ora New York.
 *
 *  - intervalul = maximul și minimul primelor 30 de minute (09:30–10:00 New York, 16:30–17:00 România);
 *  - îl folosim doar dacă e „normal”: între minR și maxR din amplitudinea zilnică medie a sesiunii (20 de zile);
 *  - ordine în așteptare: CUMPĂRĂ peste maxim, VINDE sub minim; prima atinsă până la 12:00 New York intră, cealaltă se anulează;
 *  - stop pe partea opusă a intervalului, fără țintă; ieșire la 14:00 New York (~21:00 România).
 * Prudent: dacă o lumânare sparge ambele părți, nu intrăm; dacă în aceeași lumânare s-ar atinge intrarea și stopul, presupunem stop.
 *
 * Cercetare (Dukascopy, bid/ask, 2019–2025): S&P 500 +0,14R, Nasdaq +0,14R pe ani nevăzuți, rezistă la costuri duble;
 * DAR pe Dow Jones (verificarea independentă) pierde (−0,13R), iar câștigul scade de la an la an. NEDOVEDIT: doar antrenament.
 * Ieșirea la 14:00 în loc de 16:00 păstrează ~88% din câștig (+0,113R vs +0,129R) și se poate executa seara.
 */
const DAY = 864e5;
const PARAMS = { tz: 'America/New_York', open: 9.5, rangeBars: 2, entryUntil: 12, exitAt: 14, close: 16, minR: 0.1, maxR: 0.6 };

const fmt = {};
function local(t, tz = PARAMS.tz) {
  const f = fmt[tz] || (fmt[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }));
  const p = f.formatToParts(new Date(t));
  const g = (k) => p.find((x) => x.type === k).value;
  return { hm: Number(g('hour')) + Number(g('minute')) / 60, d: `${g('year')}-${g('month')}-${g('day')}`, wd: g('weekday') };
}

/** Lumânările de 15 minute ale sesiunii (09:30–16:00 New York), grupate pe zile: Map(data → [{t,o,h,l,c,hm}]). */
function sessionDays(bars, q = PARAMS) {
  const m = new Map();
  for (const b of bars.slice().sort((a, b2) => a.t - b2.t)) {
    const L = local(b.t, q.tz);
    if (L.wd === 'Sat' || L.wd === 'Sun' || L.hm < q.open || L.hm >= q.close) continue;
    if (!m.has(L.d)) m.set(L.d, []);
    m.get(L.d).push(Object.assign({}, b, { hm: L.hm }));
  }
  return m;
}

/** Amplitudinea medie a sesiunii (20 de zile complete) dinaintea zilei `d`. */
function atrBefore(days, d, n = 20) {
  const r = Array.from(days.entries()).filter(([k, bs]) => k < d && bs.length >= 20).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-n).map(([, bs]) => Math.max(...bs.map((b) => b.h)) - Math.min(...bs.map((b) => b.l)));
  return r.length >= n ? r.reduce((a, b) => a + b, 0) / n : null;
}

/** Planul zilei după primele 30 de minute: intervalul sau motivul pentru care nu tranzacționăm. */
function planDay(dayBars, atr, q = PARAMS) {
  const first = dayBars.filter((b) => b.hm >= q.open && b.hm < q.open + q.rangeBars * 0.25);
  if (first.length < q.rangeBars || !atr) return { skip: 'DATE_INSUFICIENTE' };
  const hi = Math.max(...first.map((b) => b.h)), lo = Math.min(...first.map((b) => b.l)), range = hi - lo;
  if (range < q.minR * atr) return { skip: 'INTERVAL_PREA_ÎNGUST', hi, lo };
  if (range > q.maxR * atr) return { skip: 'INTERVAL_PREA_LARG', hi, lo };
  return { hi, lo, range };
}

/** Rezultatul zilei (după ora de ieșire), cu costuri în puncte (spread + comision/alunecare). */
function settleDay(dayBars, plan, { costPts = 1 } = {}, q = PARAMS) {
  if (!plan || plan.skip) return null;
  const start = q.open + q.rangeBars * 0.25;
  for (let i = 0; i < dayBars.length; i++) {
    const b = dayBars[i];
    if (b.hm < start) continue;
    if (b.hm >= q.entryUntil) return null;
    const up = b.h > plan.hi, dn = b.l < plan.lo;
    if (up && dn) return null;
    if (!up && !dn) continue;
    const dir = up ? 1 : -1;
    const entry = up ? Math.max(plan.hi, b.o) : Math.min(plan.lo, b.o);
    const stop = up ? plan.lo : plan.hi;
    const risk = Math.abs(entry - stop);
    let exit = null, outcome = 'TIME';
    for (let k = i; k < dayBars.length; k++) {
      const x = dayBars[k];
      if (x.hm >= q.exitAt) { exit = x.o; break; }
      if (dir > 0 ? x.l <= stop : x.h >= stop) { exit = stop; outcome = 'STOP'; break; }
      exit = x.c;
    }
    if (exit == null) return null;
    return { direction: dir > 0 ? 'LONG' : 'SHORT', entry, stop, exit, outcome, resultR: Number(((dir * (exit - entry) - costPts) / risk).toFixed(4)), enteredAt: b.t };
  }
  return null;
}

module.exports = { PARAMS, local, sessionDays, atrBefore, planDay, settleDay, DAY };
