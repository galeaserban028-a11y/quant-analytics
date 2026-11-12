'use strict';
// Nivelurile zilei (VAH, POC, VAL din ultima sesiune completă) pentru strategia M15 pe indici.
// Cu --send le trimite și pe Telegram, în același format ca mesajul zilnic de la 16:00.
const A = require('../src/strategies/amtAgent');
const { fetchM15Toni } = require('../src/data/toniFeed');
const { sendTelegram } = require('../src/notify/telegram');
const SHOWN = { SPX500: 'US500', NAS100: 'US100', GER40: 'GER40' };
(async () => {
  const lines = [];
  for (const sym of ['SPX500', 'NAS100', 'GER40']) {
    const mk = A.MARKETS[sym];
    try {
      const bars = (await fetchM15Toni(sym, mk)).filter((b) => b.t + 900e3 <= Date.now());
      const today = A.local(Date.now(), mk.tz).day;
      const prev = A.sessions(bars, mk).filter((s) => s.full && s.day < today).pop();
      const { VAH, VAL, POC } = A.valueArea(bars, prev.idx, bars[prev.idx[0]].c * 0.0005);
      const last = bars[bars.length - 1].c, f = (v) => v.toFixed(mk.dp === 0 ? 0 : 1);
      console.log(`::notice::${sym} ${prev.day}: VAH ${f(VAH)} POC ${f(POC)} VAL ${f(VAL)} | ultimul preț ${f(last)} | ${mk.hl || mk.yahoo}`);
      lines.push(`<b>${SHOWN[sym]}</b>: VAH <b>${f(VAH)}</b> · POC <b>${f(POC)}</b> · VAL <b>${f(VAL)}</b>  (preț de referință acum: ${f(last)})`);
    } catch (e) { console.log(`::error::${sym}: ${e.message}`); }
  }
  if (process.argv.includes('--send') && lines.length) {
    const text = [`🧪 <b>TEST · Nivelurile de azi</b> (strategia M15, din sesiunea de ieri)`, ...lines, '',
      `Dacă în platforma ta prețul diferă de referință, adaugă aceeași diferență la toate nivelurile.`,
      `US500/US100: la 16:30 te uiți unde se deschide. <b>În bandă</b> ⇒ azi nimic. <b>Sub VAL</b> ⇒ aștepți o lumânare M15 închisă peste VAL (până pe la 17:45) ⇒ BUY, stop loss ~2 puncte sub minimul de azi, take profit la VAH. <b>Peste VAH</b> ⇒ invers: SELL, take profit la VAL. Închizi la 23:00.`,
      `GER40 a deschis deja azi la 10:00 (regula e aceeași, cu închidere la 18:30).`, `Doar pe DEMO.`].join('\n');
    const r = await sendTelegram(text, { enabled: true });
    console.log(`::notice::Telegram: ${JSON.stringify(r && (r.ok !== undefined ? { ok: r.ok } : r)).slice(0, 200)}`);
  }
})();
