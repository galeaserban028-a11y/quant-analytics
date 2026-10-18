'use strict';

/**
 * Demo offline: rulează tot pipeline-ul pe setul sintetic XAUUSD și arată semnalul + managementul poziției.
 * Rulare: npm run demo
 */
const { ApexQuantOrchestrator } = require('../src/orchestrator');
const { buildInstitutionalGoldDataset, REFERENCE_TIME } = require('../src/demo/goldDataset');
const { formatSignal, formatEvent } = require('../src/notify/telegram');

async function main() {
  let now = REFERENCE_TIME;
  const orch = new ApexQuantOrchestrator(undefined, { clock: () => now, snapshotPath: null });
  const inst = orch.config.instruments.XAUUSD;
  orch.ingest('XAUUSD', buildInstitutionalGoldDataset());

  const { evaluated, signals } = await orch.runCycle(['XAUUSD']);
  const c = evaluated.XAUUSD;
  console.log('=== CONFLUENȚĂ XAUUSD ===');
  console.log(JSON.stringify({ direction: c.direction, finalScore: c.finalScore, approved: c.approved, vetoReasons: c.vetoReasons, breakdown: c.breakdown }, null, 2));

  if (!signals.length) {
    console.log('\nNiciun semnal.');
    return;
  }
  const trade = signals[0];
  console.log('\n=== MESAJ TELEGRAM (dry-run) ===\n' + formatSignal(trade, inst).replace(/<[^>]+>/g, ''));

  // Simulăm evoluția prețului: urcă la TP1, apoi la trailing, apoi revine pe TP1
  const spread = trade.meta.spreadPips * inst.pipSize;
  const path = [trade.tp1 + 0.05, trade.trailingLock + 0.05, trade.tp1 - 0.05];
  for (const p of path) {
    now += 15 * 60e3;
    const { events } = orch.manageTrade('XAUUSD', [{ timestamp: now, open: p, high: p, low: p, close: p }], spread);
    for (const ev of events) console.log(formatEvent(ev, inst).replace(/<[^>]+>/g, ''));
  }
  console.log('\nIstoric tranzacții închise:', JSON.stringify(orch.stateBus.state.closedTrades));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
