'use strict';

/**
 * AGENTUL „LICHIDITATE” — stilul prietenului (aur + Nasdaq, M15), scos din felul lui de a explica.
 *
 * Cum gândește (din cuvintele lui):
 *  1. „Ne uităm pe 4 ore să vedem cum e trendul” → direcția vine de pe H4 (media de 50 de lumânări). Nu intră împotriva ei.
 *  2. „O luat liquidity-ul” → piața trece scurt de un minim/maxim vechi (lichiditate) și revine.
 *  3. „Prinzi doi de-ăștia” → două minime (maxime) aproape egale pe H1 sunt lichiditatea preferată.
 *  4. „Tre să facă un change of character… aștepți entry” → intră doar după ce M15 închide înapoi peste nivel / peste structură.
 *  5. „Își face accumulation și continuă trendul” → pauză îngustă pe H1, apoi spargere în direcția trendului.
 *  6. „Stop loss-ul sub liquidity-ul ăla” → SL dincolo de vârful sweep-ului (sau de cutia acumulării).
 *  7. „Nu te duci prea tare” → țintă mică: 2R la sweep-uri, 1,5R la acumulare; ieșire forțată după 24 de ore.
 *  8. Doar la Londra și New York (06:00–20:00 UTC).
 *
 * Lumânările: [{t,o,h,l,c}] de 15 minute, UTC, sortate. Funcțiile nu se uită în viitor: un semnal pe bara i folosește doar barele ≤ i.
 */
const M15 = 900e3, H = 3600e3;

function aggregate(bars, ms) {
  const out = [];
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], k = Math.floor(b.t / ms);
    if (!cur || cur.k !== k) { if (cur) out.push(cur); cur = { k, t: k * ms, o: b.o, h: b.h, l: b.l, c: b.c, i0: i, i1: i }; } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.i1 = i; }
  }
  if (cur) out.push(cur);
  return out;
}
function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let v = null;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    v = v == null ? tr : v + (tr - v) / n;
    if (i >= n) out[i] = v;
  }
  return out;
}
function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function swings(bars, L = 2) {
  const lo = [], hi = [];
  for (let j = L; j < bars.length - L; j++) {
    let a = true, b = true;
    for (let k = 1; k <= L; k++) {
      if (bars[j - k].l <= bars[j].l || bars[j + k].l < bars[j].l) a = false;
      if (bars[j - k].h >= bars[j].h || bars[j + k].h > bars[j].h) b = false;
    }
    if (a) lo.push(j);
    if (b) hi.push(j);
  }
  return { lo, hi };
}
const hourUtc = (t) => new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;

/**
 * Toate semnalele din istoric. Fiecare: { i (bara M15 a semnalului, închisă), t, dir, stop (preț), tpR, setup }.
 * Intrarea e la deschiderea barei i+1.
 */
function findSignals(bars, opts = {}) {
  const o = Object.assign({ sessionFrom: 6, sessionTo: 20, eqTol: 0.25, accN: 6, accW: 0.75 }, opts);
  const N = bars.length;
  if (N < 400) return [];
  const H1 = aggregate(bars, H), H4 = aggregate(bars, 4 * H);
  const a1 = atr(H1), a4 = atr(H4), s4 = sma(H4.map((x) => x.c), 50);
  const h1Of = new Int32Array(N), h4Of = new Int32Array(N);
  H1.forEach((x, j) => { for (let i = x.i0; i <= x.i1; i++) h1Of[i] = j; });
  H4.forEach((x, j) => { for (let i = x.i0; i <= x.i1; i++) h4Of[i] = j; });
  // trendul H4 știut la bara i: ultima lumânare H4 ÎNCHEIATĂ
  const trend = (i) => { const j = h4Of[i] - 1; return j >= 50 && s4[j] != null ? (H4[j].c > s4[j] ? 1 : -1) : 0; };
  const inSession = (i) => { const h = hourUtc(bars[i].t); return h >= o.sessionFrom && h < o.sessionTo; };
  const out = [];
  const add = (i, dir, stop, tpR, setup) => {
    if (i >= N - 0 || !inSession(i)) return;
    const tr = trend(i);
    if (tr !== dir) return; // nu intră împotriva trendului de pe H4
    const a = a1[h1Of[i] - 1];
    const risk = Math.abs(bars[i].c - stop);
    if (!a || !(risk > 0.1 * a) || risk > 3 * a || (dir > 0 ? stop >= bars[i].c : stop <= bars[i].c)) return;
    out.push({ i, t: bars[i].t, dir, stop, tpR, setup, ref: bars[i].c });
  };

  // A. Lichiditate egală pe H1 (două minime/maxime aproape egale), luată pe M15, apoi revenire peste nivel
  const S1 = swings(H1, 2);
  const conf1 = (j) => (H1[j + 2] ? H1[j + 2].i1 : Infinity);
  for (const dir of [1, -1]) {
    const piv = dir > 0 ? S1.lo : S1.hi;
    for (let q = 1; q < piv.length; q++) {
      const j2 = piv[q];
      for (let r = q - 1; r >= 0 && j2 - piv[r] <= 48; r--) {
        const j1 = piv[r];
        if (j2 - j1 < 5) continue;
        const a = a1[j2];
        if (!a) continue;
        const v1 = dir > 0 ? H1[j1].l : H1[j1].h, v2 = dir > 0 ? H1[j2].l : H1[j2].h;
        if (Math.abs(v1 - v2) > o.eqTol * a) continue;
        const lvl = dir > 0 ? Math.min(v1, v2) : Math.max(v1, v2), c = conf1(j2);
        let sw = -1;
        for (let i = c + 1; i < Math.min(N, c + 192); i++) if (dir > 0 ? bars[i].l < lvl : bars[i].h > lvl) { sw = i; break; }
        if (sw < 0) break;
        let ext = dir > 0 ? bars[sw].l : bars[sw].h;
        for (let i = sw; i < sw + 4 && i < N; i++) {
          ext = dir > 0 ? Math.min(ext, bars[i].l) : Math.max(ext, bars[i].h);
          if (dir > 0 ? bars[i].c > lvl : bars[i].c < lvl) { add(i, dir, ext - dir * 0.02 * a, 2, 'lichiditate egală luată'); break; }
        }
        break;
      }
    }
  }

  // B. Lichiditate de pe H4 (minim/maxim vechi), luată pe M15, apoi change of character pe M15
  const S4 = swings(H4, 2);
  const conf4 = (j) => (H4[j + 2] ? H4[j + 2].i1 : Infinity);
  for (const dir of [1, -1]) {
    for (const j of dir > 0 ? S4.lo : S4.hi) {
      const lvl = dir > 0 ? H4[j].l : H4[j].h, c = conf4(j);
      let sw = -1;
      for (let i = c + 1; i < Math.min(N, c + 480); i++) if (dir > 0 ? bars[i].l < lvl : bars[i].h > lvl) { sw = i; break; }
      if (sw < 8) continue;
      let st = dir > 0 ? -Infinity : Infinity;
      for (let k = sw - 8; k < sw; k++) st = dir > 0 ? Math.max(st, bars[k].h) : Math.min(st, bars[k].l);
      let ext = dir > 0 ? bars[sw].l : bars[sw].h;
      for (let i = sw; i < sw + 16 && i < N; i++) {
        ext = dir > 0 ? Math.min(ext, bars[i].l) : Math.max(ext, bars[i].h);
        if (dir > 0 ? bars[i].c > st : bars[i].c < st) { const a = a1[h1Of[i] - 1]; add(i, dir, ext - dir * 0.02 * (a || 0), 2, 'lichiditate H4 luată + change of character'); break; }
      }
    }
  }

  // C. Acumulare pe H1, apoi continuarea trendului (semnalul la închiderea orei care sparge cutia)
  for (let j = o.accN + 1; j < H1.length; j++) {
    const i = H1[j].i1;
    if ((bars[i].t + M15) % H !== 0) continue; // ora nu s-a încheiat încă (sau lipsesc date)
    const j4 = h4Of[H1[j].i0] - 1, A4 = a4[j4];
    if (!A4) continue;
    let hi = -Infinity, lo = Infinity;
    for (let k = j - o.accN; k < j; k++) { hi = Math.max(hi, H1[k].h); lo = Math.min(lo, H1[k].l); }
    if (hi - lo > o.accW * A4) continue;
    const dir = H1[j].c > hi ? 1 : (H1[j].c < lo ? -1 : 0);
    if (!dir) continue;
    add(i, dir, dir > 0 ? lo - 0.02 * a1[j] : hi + 0.02 * a1[j], 1.5, 'acumulare, apoi continuarea trendului');
  }
  return out.sort((a, b) => a.i - b.i);
}

/**
 * Rezultatul unei poziții deschise la deschiderea barei `ei`. cost = spread + comision + alunecare, în preț.
 * Prudent: dacă într-o bară s-ar atinge și stopul și ținta, presupunem stopul.
 */
function settle(bars, ei, dir, stopPx, tpR, cost, maxBars = 96) {
  if (ei >= bars.length) return null;
  const entry = bars[ei].o;
  const sd = dir * (entry - stopPx);
  if (!(sd > 0)) return { invalid: true };
  const tp = entry + dir * tpR * sd;
  for (let k = ei; k < bars.length; k++) {
    const b = bars[k];
    if (k - ei >= maxBars) return done(b.o, 'TIMP', k);
    if (dir > 0 ? b.l <= stopPx : b.h >= stopPx) return done(k === ei ? stopPx : (dir > 0 ? Math.min(b.o, stopPx) : Math.max(b.o, stopPx)), 'SL', k);
    if (dir > 0 ? b.h >= tp : b.l <= tp) return done(k === ei ? tp : (dir > 0 ? Math.max(b.o, tp) : Math.min(b.o, tp)), 'TP', k);
  }
  return null; // încă deschisă
  function done(px, outcome, k) { return { entry, exit: px, outcome, k, closedAt: bars[k].t, sd, r: (dir * (px - entry) - cost) / sd }; }
}

/** Backtest cu aceleași reguli de risc ca live: o poziție odată, cel mult 2 pierderi pe zi. */
function backtest(bars, { cost, maxLossesPerDay = 2 } = {}) {
  const sig = findSignals(bars);
  const trades = [];
  let busy = -1;
  const lossesBy = {};
  for (const s of sig) {
    if (s.i + 1 <= busy) continue;
    const day = new Date(s.t).toISOString().slice(0, 10);
    if ((lossesBy[day] || 0) >= maxLossesPerDay) continue;
    const r = settle(bars, s.i + 1, s.dir, s.stop, s.tpR, cost);
    if (!r || r.invalid) continue;
    trades.push(Object.assign({ t: s.t, dir: s.dir, setup: s.setup }, r));
    busy = r.k;
    if (r.r < 0) lossesBy[day] = (lossesBy[day] || 0) + 1;
  }
  return trades;
}

module.exports = { findSignals, settle, backtest, aggregate, M15 };
