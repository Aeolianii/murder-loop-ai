import assert from 'node:assert/strict';
import type { PlayerKnowledge } from '@murder-loop-ai/shared';
import {
  buildTruthSubmission,
  canStartTruthDerivation,
} from './deductionWorkspace';

function knowledge(
  id: string,
  label: string,
  category: PlayerKnowledge['category'] = 'conclusion',
): PlayerKnowledge {
  return {
    id,
    label,
    activatedAt: { run: 1, minute: 1 },
    sourceClueIds: [],
    truthLayerContribution: category === 'hypothesis' ? 0 : 3,
    excludes: [],
    category,
    stage: category === 'hypothesis' ? 0 : 1,
  };
}

const available = [
  knowledge('k1', '结论一'),
  knowledge('k2', '结论二'),
  knowledge('k3', '结论三'),
  knowledge('h1', '待验证假说', 'hypothesis'),
];

assert.equal(canStartTruthDerivation(available), true);
assert.deepEqual(
  buildTruthSubmission(available, ['k1', 'k2', 'k3']),
  {
    selectedKnowledgeIds: ['k1', 'k2', 'k3'],
    text: '推导真相：结论一。结论二。结论三。',
  },
);

assert.throws(
  () => buildTruthSubmission(available, ['k1', 'k2']),
  /exactly three confirmed conclusions/i,
);
assert.throws(
  () => buildTruthSubmission(available, ['k1', 'k2', 'h1']),
  /confirmed positive conclusion/i,
);
assert.throws(
  () => buildTruthSubmission(available, ['k1', 'k1', 'k2']),
  /exactly three confirmed conclusions/i,
);
