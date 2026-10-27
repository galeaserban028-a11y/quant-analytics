'use strict';

/**
 * RAPORTUL DE DUMINICĂ pe Telegram: ce au făcut semnalele în săptămâna care s-a încheiat, pe contul de test de 5K
 * (aceleași semnale pe care le primești), plus cum merg antrenamentele (scalping, Londra, aur).
 */
const WEEK = 7 * 864e5;

const money = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(0)} $`;

function trainStats(trades) {
  const r = (trades || []).map((t) => t.resultR).filter((x) => typeof x === 'number');
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
    const target = acct.initial * 0.08;
    lines.push(`Până la ținta examenului (+8%): ${totalPnl >= target ? 'ATINSĂ ✅' : `mai sunt ${(target - totalPnl).toFixed(0)} $`}`);
  }
  const train = [['Scalping S&P/Nasdaq (M15)', state.orb], ['Forex Londra', state.fxLondon], ['Aur H4', state.gold]];
  const tl = [];
  for (const [name, book] of train) {
    if (!book) continue;
    const s = trainStats(book.trades);
    tl.push(s ? `• ${name}: ${s.n} tranzacții, ${s.wins} pe profit, total ${s.totalR >= 0 ? '+' : '−'}${Math.abs(s.totalR).toFixed(1)}R${book.graduated ? ' 🎓' : ''}`
      : `• ${name}: încă nicio tranzacție`);
  }
  if (tl.length) lines.push('\n<b>Antrenamente pe bani fictivi</b> (fără semnale până absolvă)', ...tl);
  return lines.join('\n');
}

module.exports = { weeklyReport, trainStats };
