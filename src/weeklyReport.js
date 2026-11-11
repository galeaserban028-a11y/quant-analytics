'use strict';

const { PROP_RULES } = require('./prop/rules');

/**
 * RAPORTUL DE DUMINICĂ pe Telegram: ce au făcut semnalele în săptămâna care s-a încheiat, pe contul de test de 5K
 * (aceleași semnale pe care le primești), plus cum merg antrenamentele (scalping, Londra, aur).
 */
const WEEK = 7 * 864e5;

const money = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(0)} $`;

function trainStats(trades) {
  const r = (trades || []).map((t) => (t.resultR != null ? t.resultR : t.r)).filter((x) => typeof x === 'number');
  const n = r.length;
  if (!n) return null;
  return { n, wins: r.filter((x) => x > 0).length, totalR: r.reduce((a, b) => a + b, 0) };
}

function weeklyReport(state, now) {
  const lines = ['📊 <b>RAPORTUL SĂPTĂMÂNII</b>'];
  const acct = state.prop;
  if (acct && acct.initialized) {
    const hist = acct.history || [];
    const week = hist.filter((h) => h.closedAt >= now - WEEK);
    const weekPnl = week.reduce((s, h) => s + (h.pnl || 0), 0);
    const totalPnl = acct.balance - acct.initial;
    lines.push(`\n<b>Contul de test (${acct.initial} $, aceleași semnale ca ale tale)</b>`);
    lines.push(`Sold: <b>${acct.balance.toFixed(0)} $</b> (${money(totalPnl)} de la pornire, ${(totalPnl / acct.initial * 100).toFixed(1)}%)`);
    if (week.length) {
      lines.push(`Săptămâna asta: ${week.length} închise, ${week.filter((h) => h.pnl > 0).length} pe profit · ${money(weekPnl)}`);
      for (const h of week) lines.push(`• ${h.sym} ${h.direction === 'LONG' ? 'cumpărare' : 'vânzare'}: ${money(h.pnl || 0)}`);
    } else lines.push('Săptămâna asta: nicio tranzacție închisă.');
    const open = Object.values(acct.positions || {});
    lines.push(open.length ? `Deschise acum: ${open.map((p) => p.symbol).join(', ')}` : 'Deschise acum: niciuna.');
    const rules = PROP_RULES[acct.firm];
    const phaseT = rules && acct.phase < rules.phases.length ? rules.phases[acct.phase] : null;
    if (phaseT != null) {
      const target = acct.initial * phaseT;
      lines.push(`Până la ținta examenului (+${(phaseT * 100).toFixed(0)}%): ${totalPnl >= target ? 'ATINSĂ ✅' : `mai sunt ${(target - totalPnl).toFixed(0)} $`}`);
    } else if (rules) lines.push('Cont FINANȚAT: cere payout când ai profit de cel puțin ~150 $ și 5 zile de tranzacționare.');
  }
  const train = [['Scalping S&P/Nasdaq (M15)', state.orb], ['Forex Londra', state.fxLondon], ['Aur H4', state.gold], ['Lichiditate aur+Nasdaq (stilul prietenului)', state.liq], ['Toni (M15, varianta 2 pe indici)', state.toni]];
  const tl = [];
  for (const [name, book] of train) {
    if (!book) continue;
    const s = trainStats(book.trades);
    tl.push(s ? `• ${name}: ${s.n} tranzacții, ${s.wins} pe profit, total ${s.totalR >= 0 ? '+' : '−'}${Math.abs(s.totalR).toFixed(1)}R${book.graduated || (book.passed && Object.keys(book.passed).length) ? ' 🎓' : ''}`
      : `• ${name}: încă nicio tranzacție`);
  }
  if (tl.length) lines.push('\n<b>Antrenamente pe bani fictivi</b> (fără semnale până absolvă)', ...tl);
  return lines.join('\n');
}

module.exports = { weeklyReport, trainStats };
