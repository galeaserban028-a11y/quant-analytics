'use strict';

/**
 * AGENTUL „TONI” (Auction Market Theory / profil TPO), M15. Reguli fixate dinainte, aceleași în backtest și live.
 *
 * FAILED AUCTION la marginea zonei de valoare (Value Area 70%) a sesiunii precedente:
 *  - prețul iese peste VAH (sau sub VAL), apoi în cel mult 4 lumânări de 15 minute o lumânare ÎNCHIDE înapoi în zona de valoare
 *    (dar încă înainte de POC) ⇒ intrare contra ieșirii la deschiderea lumânării următoare;
 *  - SL dincolo de extrema ieșirii (+ jumătate de treaptă de preț), TP la POC (prețul cu cel mai mult timp petrecut);
 *  - cel mult un semnal pe fiecare parte pe zi; ieșire forțată la finalul sesiunii.
 * Fiecare piață are sesiunea ei (New York pentru indicii americani și aur, Frankfurt pentru DAX, Londra pentru forex).
 *
 * VARIANTA 2 (doar indici, `v2: true`), „regula 80%” din Market Profile, găsită pe 2019–2022 și verificată pe 2023–2025 neatins:
 *  - doar în zilele care se DESCHID în afara zonei de valoare de ieri (deschiderea înăuntru pierde: −0,12R pe test);
 *  - SL de cel puțin 25% din range-ul mediu al unei sesiuni (ultimele 20), ca să nu fie scos de zgomot;
 *  - TP la marginea OPUSĂ a zonei de valoare (traversarea), nu la POC.
 *  Rezultat (costuri incluse): antrenament +0,15R/tranz. (n=294), test 2023–2025 +0,13R (n=318, t=2,6); pe plus în fiecare an.
 */
const MARKETS = {
  NAS100: { name: 'NASDAQ (NAS100)', yahoo: 'NQ=F', hl: 'xyz:XYZ100', tz: 'America/New_York', s0: 570, s1: 960, cost: 2, unit: 'puncte', dp: 0 , v2: true, inside: true },
  SPX500: { name: 'S&P 500 (US500)', yahoo: 'ES=F', hl: 'xyz:SP500', tz: 'America/New_York', s0: 570, s1: 960, cost: 0.6, unit: 'puncte', dp: 1 , v2: true, inside: true },
  GER40: { name: 'DAX (GER40)', yahoo: '^GDAXI', tz: 'Europe/Berlin', s0: 540, s1: 1050, cost: 2, unit: 'puncte', dp: 0 , v2: true, inside: true },
  XAUUSD: { name: 'AUR (XAUUSD)', yahoo: 'GC=F', hl: 'xyz:GOLD', tz: 'America/New_York', s0: 480, s1: 1020, cost: 0.4, unit: '$', dp: 1 },
  EURUSD: { name: 'EUR/USD', yahoo: 'EURUSD=X', tz: 'Europe/London', s0: 420, s1: 1020, cost: 0.00012, unit: 'pips', dp: 5, pip: 0.0001 },
  GBPUSD: { name: 'GBP/USD', yahoo: 'GBPUSD=X', tz: 'Europe/London', s0: 420, s1: 1020, cost: 0.00016, unit: 'pips', dp: 5, pip: 0.0001 }
};
const M15 = 900e3;
/**
 * Zilele în care bursa americană e închisă sau închide devreme (NYSE, 2026–2027). Sursele 24/7 (Hyperliquid) au lumânări și
 * atunci, dar CFD-ul brokerului stă pe loc: nu le tratăm ca sesiuni (nici pentru zona de valoare, nici pentru semnale).
 */
const NY_CLOSED = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-11-26', '2027-12-24']);
const isClosedDay = (day, tz) => tz === 'America/New_York' && NY_CLOSED.has(day);
const fmtCache = {};
function local(t, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, m: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Sesiunile (zile lucrătoare cu cel puțin 80% din lumânări), fiecare cu indicii lumânărilor din sesiune. */
function sessions(bars, mk) {
  const days = [];
  for (let i = 0; i < bars.length; i++) {
    const L = local(bars[i].t, mk.tz);
    if (L.m < mk.s0 || L.m >= mk.s1) continue;
    const wd = new Date(L.day + 'T12:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue; // sursele 24/7 (Hyperliquid) au lumânări și în weekend: nu sunt sesiuni
    if (isClosedDay(L.day, mk.tz)) continue; // sărbătoare / închidere devreme la bursa americană
    const c = days[days.length - 1];
    if (c && c.day === L.day) c.idx.push(i); else days.push({ day: L.day, idx: [i] });
  }
  const need = 0.8 * (mk.s1 - mk.s0) / 15;
  return days.map((d) => Object.assign(d, { full: d.idx.length >= need }));
}

/** Profil TPO pe paranteze de 30 de minute: VAH, VAL, POC. */
function valueArea(bars, idx, bin) {
  const m = new Map(), brk = {};
  for (const i of idx) { const k = Math.floor(bars[i].t / 1800e3); const r = brk[k] || (brk[k] = { h: -Infinity, l: Infinity }); r.h = Math.max(r.h, bars[i].h); r.l = Math.min(r.l, bars[i].l); }
  for (const r of Object.values(brk)) for (let k = Math.floor(r.l / bin); k <= Math.floor(r.h / bin); k++) m.set(k, (m.get(k) || 0) + 1);
  const ks = [...m.keys()].sort((a, b) => a - b), tot = [...m.values()].reduce((a, b) => a + b, 0);
  let poc = ks[0]; for (const k of ks) if (m.get(k) > m.get(poc)) poc = k;
  let lo = ks.indexOf(poc), hi = lo, acc = m.get(poc);
  while (acc < 0.7 * tot && (lo > 0 || hi < ks.length - 1)) {
    const up = hi < ks.length - 1 ? m.get(ks[hi + 1]) : -1, dn = lo > 0 ? m.get(ks[lo - 1]) : -1;
    if (up >= dn) { hi++; acc += up; } else { lo--; acc += dn; }
  }
  return { VAH: (ks[hi] + 1) * bin, VAL: ks[lo] * bin, POC: (poc + 0.5) * bin };
}

/**
 * Toate semnalele din lumânări. Semnalul e pe lumânarea care închide înapoi în zona de valoare (t = începutul ei);
 * intrarea e la deschiderea lumânării următoare.
 */
function findSignals(bars, mk) {
  const S = sessions(bars, mk), out = [];
  for (let d = 1; d < S.length; d++) {
    const prev = S[d - 1], cur = S[d];
    if (!prev.full) continue;
    const ref = bars[prev.idx[0]].c, bin = ref * 0.0005;
    const { VAH, VAL, POC } = valueArea(bars, prev.idx, bin);
    let avgRange = null;
    if (mk.v2) {
      const fullPrev = S.slice(0, d).filter((x) => x.full).slice(-20);
      if (fullPrev.length < 20) continue;
      avgRange = fullPrev.reduce((a, x) => { let h = -Infinity, l = Infinity; for (const i of x.idx) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); } return a + h - l; }, 0) / 20;
      const o = bars[cur.idx[0]].o;
      if (o < VAH && o > VAL) { // s-a deschis în zona de valoare
        if (mk.inside) insideDay(bars, S, d, { VAH, VAL, POC, o }, mk, out);
        continue;
      }
    }
    const okRisk = (stop, px) => !mk.v2 || Math.abs(px - stop) >= 0.25 * avgRange;
    let brkUp = -1, brkDn = -1, extUp = -Infinity, extDn = Infinity, doneUp = false, doneDn = false;
    for (let q = 0; q < cur.idx.length; q++) {
      const b = bars[cur.idx[q]];
      if (b.h > VAH && brkUp < 0) brkUp = q; if (brkUp >= 0) extUp = Math.max(extUp, b.h);
      if (b.l < VAL && brkDn < 0) brkDn = q; if (brkDn >= 0) extDn = Math.min(extDn, b.l);
      const base = { day: cur.day, VAH, VAL, POC, sessionEndLocal: mk.s1 };
      if (!doneUp && brkUp >= 0 && q > brkUp && q - brkUp <= 4 && b.c < VAH && b.c > POC) {
        doneUp = true;
        if (okRisk(extUp + bin / 2, b.c)) out.push(Object.assign({ t: b.t, i: cur.idx[q], dir: -1, stop: extUp + bin / 2, tp: mk.v2 ? VAL : POC, setup: mk.v2 ? 'deschidere peste valoare, revenire în VA ⇒ spre VAL' : 'failed auction la VAH' }, base));
      }
      if (!doneDn && brkDn >= 0 && q > brkDn && q - brkDn <= 4 && b.c > VAL && b.c < POC) {
        doneDn = true;
        if (okRisk(extDn - bin / 2, b.c)) out.push(Object.assign({ t: b.t, i: cur.idx[q], dir: 1, stop: extDn - bin / 2, tp: mk.v2 ? VAH : POC, setup: mk.v2 ? 'deschidere sub valoare, revenire în VA ⇒ spre VAH' : 'failed auction la VAL' }, base));
      }
    }
  }
  return out;
}

/**
 * VARIANTA „ÎNĂUNTRU” (indici, `inside: true`): zilele care se DESCHID în zona de valoare de ieri, pe la mijlocul ei (25–75%).
 *  - trendul = închiderea sesiunii de ieri față de media închiderilor din ultimele 20 de sesiuni;
 *  - semnal: prima dată când 2 lumânări M15 la rând se închid în afara benzii; doar dacă ieșirea e în direcția trendului;
 *  - intrare la lumânarea următoare; SL la mijlocul benzii; TP 1,5R; ieșire forțată la finalul sesiunii.
 * Găsită pe 2019–2022, verificată pe 2023–2025 (+0,22R / +0,18R pe tranzacție, costuri incluse), pe plus în fiecare an
 * și pe fiecare indice; contra trendului dă zero. Setările vecine (1 sau 3 lumânări, TP 2R/3R) sunt toate pe plus.
 */
function insideDay(bars, S, d, lv, mk, out) {
  const { VAH, VAL, POC, o } = lv, cur = S[d];
  const pos = (o - VAL) / (VAH - VAL);
  if (pos < 0.25 || pos > 0.75) return;
  const last20 = S.slice(Math.max(0, d - 20), d);
  if (last20.length < 20) return;
  const closeOf = (x) => bars[x.idx[x.idx.length - 1]].c;
  const ma = last20.reduce((a, x) => a + closeOf(x), 0) / 20, trend = Math.sign(closeOf(S[d - 1]) - ma);
  let up = 0, dn = 0;
  for (let q = 0; q < cur.idx.length; q++) {
    const b = bars[cur.idx[q]];
    up = b.c > VAH ? up + 1 : 0; dn = b.c < VAL ? dn + 1 : 0;
    if (up >= 2 || dn >= 2) {
      const dir = up >= 2 ? 1 : -1;
      if (dir !== trend) return; // prima ieșire acceptată e contra trendului ⇒ azi nimic
      const stop = (VAH + VAL) / 2, tp = b.c + dir * 1.5 * Math.abs(b.c - stop);
      out.push({ t: b.t, i: cur.idx[q], dir, stop, tp, setup: dir > 0 ? 'ieșire acceptată peste VAH, în direcția trendului' : 'ieșire acceptată sub VAL, în direcția trendului', day: cur.day, VAH, VAL, POC, sessionEndLocal: mk.s1, inside: true });
      return;
    }
  }
}

/**
 * Rezultatul unei tranzacții intrate la deschiderea lumânării `ei`: SL, TP sau închidere la finalul sesiunii.
 * Costul (spread + alunecare, în unități de preț) se scade o dată. Dacă sesiunea nu s-a terminat încă și nici SL/TP nu s-au atins ⇒ null.
 * nowT (live): ora curentă, ca să închidem la finalul sesiunii și când nu mai vin lumânări.
 */
function settle(bars, ei, sig, mk, nowT = null) {
  const e = bars[ei].o, risk = Math.abs(e - sig.stop);
  if (!(risk > 0) || sig.dir * (sig.tp - e) <= 0 || sig.dir * (e - sig.stop) <= 0) return { invalid: true };
  const day = local(bars[ei].t, mk.tz).day;
  let last = ei;
  for (let j = ei; j < bars.length; j++) {
    const b = bars[j], L = local(b.t, mk.tz);
    if (L.day !== day || L.m >= mk.s1) return fin(bars[last].c, 'SESIUNE', bars[last].t + M15);
    last = j;
    if (sig.dir > 0 ? b.l <= sig.stop : b.h >= sig.stop) return fin(sig.stop, 'SL', b.t + M15);
    if (sig.dir > 0 ? b.h >= sig.tp : b.l <= sig.tp) return fin(sig.tp, 'TP', b.t + M15);
  }
  // live: sesiunea s-a terminat după ceas, chiar dacă piața nu mai trimite lumânări (ex. DAX după 17:30)
  if (nowT != null) { const N = local(nowT, mk.tz); if (N.day !== day || N.m >= mk.s1) return fin(bars[last].c, 'SESIUNE', nowT); }
  return null;
  function fin(px, outcome, closedAt) { return { outcome, closedAt, entry: e, exit: px, risk, r: (sig.dir * (px - e) - mk.cost) / risk }; }
}

module.exports = { isClosedDay, MARKETS, findSignals, settle, valueArea, sessions, local, M15 };
