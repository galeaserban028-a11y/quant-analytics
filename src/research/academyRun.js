'use strict';

/**
 * ACADEMIA FOREX — cercetarea lunară pentru cei 300 de agenți.
 *
 *  1. încarcă istoricul zilnic Dukascopy (bid/ask reale) pentru perechile Forex;
 *  2. rulează viața agenților (src/academy/life.js) de 3 ori, cu seed-uri diferite: naștere, învățare, grade,
 *     pensionare, urmași — totul doar cu datele de până la fiecare moment;
 *  3. măsoară COMPANIA (doar semnalele agenților ELITĂ, după fiecare decizie) cu execuție prudentă (a doua zi);
 *  4. Academia trimite semnale reale DOAR dacă în toate cele 3 rulări compania are avantaj clar
 *     (intervalul de încredere 95% complet peste zero). Altfel: tăcere, nu pierzi bani.
 *
 *   node src/research/academyRun.js           → raport
 *   node src/research/academyRun.js --apply   → activează/dezactivează Academia în config/promotions.json
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DATA_DIR } = require('../backtest/dataLoader');
const { cleanSpikes } = require('../core/candles');
const lab = require('../strategies/dailyLab');
const { runAcademy } = require('../academy/life');
const { simulateCompany } = require('../academy/company');
const { FAMILIES, describe } = require('../academy/genome');
const { computeMetrics } = require('../backtest/metrics');
const { PROP_RULES } = require('../prop/rules');
const { chooseRisk, rankFirms } = require('./propRun');
const { monthDistribution, journey } = require('./scenario');
const { writePromotionSection } = require('../config');
const { sendTelegram } = require('../notify/telegram');

const DK_DIR = path.join(DATA_DIR, 'fx', 'dk', 'd1');
const INSTRUMENTS = require('../../config/forex_instruments.json');
const SEEDS = [1, 2, 3];

/** Citește un CSV Dukascopy (.csv.gz): timestamp,open,high,low,close,spread */
function loadDk(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line) continue;
    const [ts, o, h, l, c, sp] = line.split(',').map(Number);
    if ([ts, o, h, l, c].every(Number.isFinite) && h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0) out.push({ timestamp: ts, open: o, high: h, low: l, close: c, spread: sp || 0 });
  }
  return out;
}

function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }

/** Instrumentele cu spread prudent: cel mai mare dintre cel din config (spread + comision) și mediana reală Dukascopy. */
function prudentInstruments(data) {
  const inst = {};
  for (const [s, bars] of Object.entries(data)) {
    const base = INSTRUMENTS[s];
    const realPips = median(bars.slice(-750).map((b) => b.spread)) / base.pipSize;
    inst[s] = Object.assign({}, base, { typicalSpreadPips: Math.max(base.typicalSpreadPips, Number(realPips.toFixed(2))) });
  }
  return inst;
}

const prudentSim = (d, i, p, o) => lab.simulate(d, i, p, Object.assign({}, o, { execution: 'nextOpen' }));

function loadAll() {
  const data = {};
  if (!fs.existsSync(DK_DIR)) return data;
  for (const f of fs.readdirSync(DK_DIR)) {
    const s = f.replace('.csv.gz', '');
    if (!INSTRUMENTS[s] || INSTRUMENTS[s].category !== 'FX') continue;
    const bars = cleanSpikes(loadDk(path.join(DK_DIR, f)));
    if (bars.length > 1500) data[s] = bars;
  }
  return data;
}

const fmt = (v, d = 3) => (v == null || !Number.isFinite(v) ? '–' : Number(v).toFixed(d));

async function main() {
  const apply = process.argv.includes('--apply');
  const data = loadAll();
  const pairs = Object.keys(data);
  if (pairs.length < 4) { console.log(`Prea puține perechi cu date Dukascopy (${pairs.length}). Rulează workflow-ul „APEX date Forex”.`); process.exitCode = 1; return; }
  const inst = prudentInstruments(data);
  console.log(`Academia Forex: ${pairs.length} perechi (${pairs.join(', ')})`);

  const runs = SEEDS.map((seed) => {
    const t = Date.now();
    const res = runAcademy(data, inst, { sim: prudentSim, populationSize: 300, seed, log: (m) => console.log(`  [seed ${seed}] ${m}`) });
    const c = res.company;
    const ok = c.trades >= 100 && c.expectancyCI95[0] > 0;
    console.log(`Seed ${seed}: compania ${c.trades} tranzacții, E=${fmt(c.expectancyR)}R (IC95% ${fmt(c.expectancyCI95[0])} … ${fmt(c.expectancyCI95[1])}) → ${ok ? 'AVANTAJ CLAR' : 'fără avantaj dovedit'} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    return Object.assign(res, { seed, ok });
  });
  const enabled = runs.every((x) => x.ok);
  const main0 = runs[0];
  const trades = main0.companyTrades;

  let ranking = [], top = {}, scenario = null;
  if (trades.length >= 30) {
    const firms = {};
    for (const [key, rules] of Object.entries(PROP_RULES)) firms[key] = chooseRisk(trades, rules, { orderSeeds: 4 });
    ranking = Object.entries(firms).map(([k, v]) => ({ key: k, ...v.best })).sort(rankFirms);
    top = ranking[0];
    const rules = PROP_RULES[top.key];
    const cfg = { riskPct: top.riskPct, safety: top.safety, maxOpen: top.maxOpen };
    scenario = { firm: rules.name, config: cfg, fee: top.fee, challengeMonth: monthDistribution(trades, rules, cfg, { target: rules.phases[0] }), journey: journey(trades, rules, cfg, { months: 12, fee: top.fee }) };
  }

  // APEX Capital: compania cu bani fictivi în care lucrează toți agenții (rulările 1–3, pentru robustețe)
  const virtual = simulateCompany(main0);
  const virtualOthers = runs.slice(1).map((x) => { const v = simulateCompany(x); return { seed: x.seed, cagrPct: v.cagrPct, maxDrawdownPct: v.maxDrawdownPct, totalPnl: v.totalPnl, ranks: v.ranks }; });
  console.log(`APEX Capital (bani fictivi, seed 1): ${virtual.startCapital} $ → ${virtual.endCapital} $ (${virtual.cagrPct}%/an, scădere maximă ${virtual.maxDrawdownPct}%), ${virtual.trades} tranzacții`);
  for (const [rk, m] of Object.entries(virtual.ranks)) console.log(`  ${rk}: ${m.trades} tranzacții, ${m.expectancyR}R`);

  const alive = main0.agents.filter((a) => !a.retiredAt);
  const byFamily = {};
  for (const a of alive) byFamily[a.genome.family] = (byFamily[a.genome.family] || 0) + 1;
  const famCompany = {};
  for (const t of trades) { const a = main0.agents.find((x) => x.id === t.agentId); const f = a ? a.genome.family : '?'; (famCompany[f] = famCompany[f] || []).push(t); }
  const population = alive.map((a) => ({
    id: a.id, name: a.name, rank: a.rank, family: a.genome.family, familyName: FAMILIES[a.genome.family].name, pair: a.genome.pair,
    params: a.genome.params, describe: describe(a.genome), bornAt: new Date(a.bornAt).toISOString().slice(0, 10), generation: a.generation, parentId: a.parentId,
    stats: { trades: a.stats.n, expectancyR: Number(a.stats.E.toFixed(4)), t: Number(a.stats.t.toFixed(2)), winRatePct: Number(a.stats.winRatePct.toFixed(1)), totalR: Number(a.stats.totalR.toFixed(2)), last12: a.stats.n12 ? Number(a.stats.E12.toFixed(4)) : null },
    eliteQuarters: a.eliteQuarters
  })).sort((x, y) => ({ 'ELITĂ': 0, SENIOR: 1, JUNIOR: 2, STAGIAR: 3 }[x.rank] - { 'ELITĂ': 0, SENIOR: 1, JUNIOR: 2, STAGIAR: 3 }[y.rank]) || y.stats.t - x.stats.t);
  const hallOfFame = main0.agents.filter((a) => a.retiredAt && a.eliteQuarters >= 4).sort((x, y) => y.eliteQuarters - x.eliteQuarters).slice(0, 10)
    .map((a) => ({ id: a.id, name: a.name, family: a.genome.family, pair: a.genome.pair, eliteQuarters: a.eliteQuarters, retired: new Date(a.retiredAt).toISOString().slice(0, 10), why: a.retiredWhy }));

  const out = {
    generatedAt: new Date().toISOString(),
    data: { source: 'Dukascopy (bid/ask, zi UTC)', pairs, from: new Date(Math.min(...pairs.map((p) => data[p][0].timestamp))).toISOString().slice(0, 10), to: new Date(Math.max(...pairs.map((p) => data[p][data[p].length - 1].timestamp))).toISOString().slice(0, 10) },
    rules: main0.rules,
    enabled,
    seeds: runs.map((x) => ({ seed: x.seed, ok: x.ok, company: { trades: x.company.trades, winRatePct: x.company.winRatePct, expectancyR: x.company.expectancyR, ci: x.company.expectancyCI95 }, agentsEver: x.agents.length, everElite: x.agents.filter((a) => a.bestRank === 'ELITĂ').length })),
    families: Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, { name: FAMILIES[f].name, alive: byFamily[f] || 0, company: famCompany[f] ? (({ trades: n, expectancyR: e }) => ({ trades: n, expectancyR: e }))(computeMetrics(famCompany[f])) : null }])),
    quarters: main0.quarters.map(({ roster, T, ...q }) => q),
    virtual, virtualOthers,
    population, hallOfFame,
    exam: ranking.map((r) => ({ key: r.key, name: r.rules, riskPct: r.riskPct, safety: r.safety, maxOpen: r.maxOpen, passPct: r.passPct, failPct: r.failPct, medianDaysToPass: r.medianDaysToPass, passWithin180Pct: r.passWithin180Pct, fee: r.fee, ev: r.expectedValuePerAttempt })),
    scenario
  };
  const outDir = path.join(DATA_DIR, 'research');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'academy.json'), JSON.stringify(out, null, 1));

  const counts = population.reduce((m, a) => (m[a.rank] = (m[a.rank] || 0) + 1, m), {});
  const L = [];
  L.push('# Raport — Academia Forex (300 de agenți)');
  L.push('');
  L.push(`Generat: ${out.generatedAt} · date ${out.data.source}, ${pairs.length} perechi, ${out.data.from} → ${out.data.to} · execuție prudentă (a doua zi la deschidere)`);
  L.push('');
  L.push(`## Verdict: ${enabled ? '✅ Academia trimite semnale (compania are avantaj clar în toate cele 3 rulări)' : '⏸️ Academia NU trimite semnale (compania nu are avantaj dovedit în toate cele 3 rulări)'}`);
  L.push('');
  L.push('| Rulare | Tranzacții companie | Câștigătoare | R / tranzacție (IC95%) | Agenți născuți | Au ajuns ELITĂ | Verdict |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of out.seeds) L.push(`| seed ${s.seed} | ${s.company.trades} | ${s.company.winRatePct}% | ${fmt(s.company.expectancyR)} (${fmt(s.company.ci[0])} … ${fmt(s.company.ci[1])}) | ${s.agentsEver} | ${s.everElite} | ${s.ok ? 'avantaj clar' : 'nedovedit'} |`);
  L.push('');
  L.push(`Populația acum: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  L.push('');
  L.push('## Familiile de strategii (agenți vii · rezultatul lor în companie)');
  L.push('');
  L.push('| Familie | Agenți vii | Tranzacții în companie | R / tranzacție |');
  L.push('|---|---|---|---|');
  for (const f of Object.values(out.families)) L.push(`| ${f.name} | ${f.alive} | ${f.company ? f.company.trades : 0} | ${f.company ? fmt(f.company.expectancyR) : '–'} |`);
  L.push('');
  if (ranking.length) {
    L.push('## Examenul (pe tranzacțiile companiei, seed 1)');
    L.push('');
    L.push('| Firmă | Risc | Trece | Pică | Zile mediane | ≤6 luni | Valoare așteptată |');
    L.push('|---|---|---|---|---|---|---|');
    for (const r of ranking) L.push(`| ${r.rules} | ${r.riskPct}% | ${r.passPct}% | ${r.failPct}% | ${r.medianDaysToPass ?? '–'} | ${r.passWithin180Pct}% | ${r.expectedValuePerAttempt}$ |`);
    L.push('');
  }
  L.push('## APEX Capital — compania cu bani fictivi (1.000.000 $)');
  L.push('');
  L.push(`Toți agenții lucrează cu bani fictivi, cu risc după grad (stagiar 0,05%, junior 0,10%, senior 0,20%, elită 0,30% pe tranzacție) și limită de 8R pierdere în 90 de zile pe trader. Din ${virtual.from}: **${virtual.startCapital.toLocaleString('ro-RO')} $ → ${virtual.endCapital.toLocaleString('ro-RO')} $** (${virtual.cagrPct}% pe an), scădere maximă ${virtual.maxDrawdownPct}%, ${virtual.positiveMonthsPct}% din luni pe plus. Celelalte rulări: ${virtualOthers.map((v) => `${v.cagrPct}%/an`).join(', ')}.`);
  L.push('');
  L.push('| Grad | Tranzacții | R / tranzacție (IC95%) |');
  L.push('|---|---|---|');
  for (const [rk, m] of Object.entries(virtual.ranks)) L.push(`| ${rk} | ${m.trades} | ${fmt(m.expectancyR)} (${fmt(m.ci[0])} … ${fmt(m.ci[1])}) |`);
  L.push('');
  L.push('Dacă gradele au valoare, R pe tranzacție ar trebui să crească de la stagiar la elită.');
  L.push('');
  L.push('## Elita de acum');
  L.push('');
  for (const a of population.filter((x) => x.rank === 'ELITĂ').slice(0, 30)) L.push(`- **${a.name}** (${a.pair}, ${a.familyName}): ${a.describe}. Pe hârtie: ${a.stats.trades} tranzacții, ${fmt(a.stats.expectancyR)}R, t=${a.stats.t}.`);
  fs.writeFileSync(path.join(outDir, 'RAPORT_ACADEMIE.md'), L.join('\n'));
  console.log(`\nVerdict: ${enabled ? 'ACTIVĂ' : 'OPRITĂ'} · populație ${JSON.stringify(counts)} · raport data/research/RAPORT_ACADEMIE.md`);

  if (process.env.LIVE_TELEGRAM === '1') {
    await sendTelegram(`🎓 <b>Academia Forex: școala lunară</b>\nPopulație: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.\nCompania (doar ELITĂ): ${out.seeds.map((s) => `${fmt(s.company.expectancyR)}R`).join(' / ')} în cele 3 rulări → ${enabled ? '<b>ACTIVĂ</b>' : '<b>oprită</b> (avantaj nedovedit; nu primești semnale)'}.`, { enabled: true });
  }
  if (apply) {
    const elite = population.filter((a) => a.rank === 'ELITĂ').map((a) => ({ id: a.id, name: a.name, pair: a.pair, family: a.family, familyName: a.familyName, params: a.params }));
    writePromotionSection('fx', {
      generatedAt: out.generatedAt, validatedOOS: enabled, level: enabled ? 'LIVE' : 'NIMIC',
      oos: out.seeds.map((s) => s.company),
      overrides: { fxDesk: { enabled, firm: top.key || 'THE5ERS_HIGH_STAKES', riskPct: top.riskPct || 1, safety: top.safety || 0.7, maxOpen: top.maxOpen || 3, elite, symbols: pairs } }
    });
    console.log(enabled ? 'Academia ACTIVATĂ.' : 'Academia rămâne OPRITĂ.');
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { loadDk, prudentInstruments, loadAll, SEEDS };
