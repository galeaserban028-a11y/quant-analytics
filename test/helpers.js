'use strict';

const { ApexQuantOrchestrator } = require('../src/orchestrator');
const { buildInstitutionalGoldDataset, REFERENCE_TIME } = require('../src/demo/goldDataset');

/** Orchestrator izolat (fără fișier de stare), cu ceas controlabil. */
function makeOrch(startTime = REFERENCE_TIME, config) {
  const clock = { now: startTime };
  const orch = new ApexQuantOrchestrator(config, { clock: () => clock.now, snapshotPath: null });
  return { orch, clock };
}

function goldSetup(overrides = {}) {
  const { orch, clock } = makeOrch();
  orch.ingest('XAUUSD', Object.assign(buildInstitutionalGoldDataset(), overrides));
  return { orch, clock };
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

module.exports = { makeOrch, goldSetup, deepClone, REFERENCE_TIME, buildInstitutionalGoldDataset };
