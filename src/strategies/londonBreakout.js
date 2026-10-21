'use strict';

/**
 * SPARGEREA INTERVALULUI ASIATIC LA DESCHIDEREA LONDREI (Forex, lumânări orare UTC).
 *
 * Regula (parametrii aleși walk-forward pe 2014–2025, foarte stabili de la an la an):
 *  - intervalul asiatic = maximul și minimul orelor [a0, open) UTC (implicit 00:00–07:00);
 *  - îl folosim doar dacă e „normal”: între minR și maxR din amplitudinea zilnică medie (ATR 20 zile);
 *  - ordine în așteptare: CUMPĂRĂ peste maxim, VINDE sub minim; prima atinsă în primele 4 ore intră, cealaltă se anulează;
 *  - stop pe partea opusă a intervalului; fără țintă; ieșire la ora exitH UTC (implicit 20:00).
 * Prudent: dacă în aceeași oră s-ar atinge și intrarea și stopul, presupunem stop; ore cu ambele spargeri → nicio intrare.
 *
 * Rezultat în cercetare (EURUSD, GBPUSD, USDJPY, 2017–2025, pe ani nevăzuți): +0,072R pe tranzacție, IC95% [0,028; 0,120],
 * dar SENSIBIL la costuri: la costuri ×1,5 → +0,037R (nedovedit), la ×2 → ~0. De aceea rulează întâi live pe hârtie.
 */
const H = 3600e3;
const DAY = 864e5;
const PARAMS = { a0: 0, open: 7, exitH: 20, minR: 0.15, maxR: 0.6, entryHours: 4 };

const hourOf = (t) => new Date(t).getUTCHours();

/** Amplitudinea zilnică medie (20 de zile) cunoscută la începutul zilei `day`, din orele zilelor anterioare. */
function atrBefore(hours, day, n = 20) {
  const byDay = new Map();
  for (const b of hours) {
    const d = b.t - (b.t % DAY);
    if (d >= day) continue;
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const x = byDay.get(d) || { h: -Infinity, l: Infinity, n: 0 };
    x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.n++;
    byDay.set(d, x);
  }
  const ranges = Array.from(byDay.entries()).filter(([, x]) => x.n >= 18).sort((a, b) => a[0] - b[0]).slice(-n).map(([, x]) => x.h - x.l);
  return ranges.length >= n ? ranges.reduce((a, b) => a + b, 0) / n : null;
}

/**
 * Planul zilei (după închiderea orei `open`): intervalul și ordinele, sau motivul pentru care nu tranzacționăm.
 * @param {Array<{t,o,h,l,c}>} dayBars orele zilei (UTC), sortate
 */
function planDay(dayBars, atr, q = PARAMS) {
  const asia = dayBars.filter((b) => hourOf(b.t) >= q.a0 && hourOf(b.t) < q.open);
  if (asia.length < 5 || !atr) return { skip: 'DATE_INSUFICIENTE' };
  const hi = Math.max(...asia.map((b) => b.h));
  const lo = Math.min(...asia.map((b) => b.l));
  const rg = hi - lo;
  if (rg < q.minR * atr) return { skip: 'INTERVAL_PREA_ÎNGUST', hi, lo };
  if (rg > q.maxR * atr) return { skip: 'INTERVAL_PREA_LARG', hi, lo };
  return { hi, lo, range: rg };
}

/**
 * Rezultatul zilei (când ora de ieșire a trecut), cu costuri: spread + comision/alunecare, în pips.
 * @returns {null | {direction, entry, stop, exit, outcome, resultR, enteredAt}}
 */
function settleDay(dayBars, plan, { pipSize, costPips = 1.2 }, q = PARAMS) {
  if (!plan || plan.skip) return null;
  const { hi, lo } = plan;
  for (let i = 0; i < dayBars.length; i++) {
    const b = dayBars[i], hr = hourOf(b.t);
    if (hr < q.open) continue;
    if (hr >= Math.min(q.exitH, q.open + q.entryHours)) return null;
    const up = b.h > hi, dn = b.l < lo;
    if (up && dn) return null;
    if (!up && !dn) continue;
    const dir = up ? 1 : -1;
    const entry = up ? Math.max(hi, b.o) : Math.min(lo, b.o);
    const stop = up ? lo : hi;
    const risk = Math.abs(entry - stop);
    let exit = null, outcome = 'TIME';
    for (let k = i; k < dayBars.length; k++) {
      const x = dayBars[k];
      if (hourOf(x.t) >= q.exitH) { exit = x.o; break; }
      if (dir > 0 ? x.l <= stop : x.h >= stop) { exit = stop; outcome = 'STOP'; break; }
    }
    if (exit == null) exit = dayBars[dayBars.length - 1].c;
    const r = (dir * (exit - entry) - costPips * pipSize) / risk;
    return { direction: dir > 0 ? 'LONG' : 'SHORT', entry, stop, exit, outcome, resultR: Number(r.toFixed(4)), enteredAt: b.t };
  }
  return null;
}

module.exports = { PARAMS, planDay, settleDay, atrBefore, hourOf };
