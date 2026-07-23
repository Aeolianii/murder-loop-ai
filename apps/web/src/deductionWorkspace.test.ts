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
  ...Array.from({ length: 10 }, (_, index) =>
    knowledge(`k${index + 1}`, `结论${index + 1}`),
  ),
  knowledge('h1', '待验证假说', 'hypothesis'),
];

assert.equal(canStartTruthDerivation(available), true);
assert.equal(canStartTruthDerivation([knowledge('only', '唯一结论')]), true);
assert.equal(
  canStartTruthDerivation([knowledge('h1', '待验证假说', 'hypothesis')]),
  false,
);
assert.deepEqual(
  buildTruthSubmission(available),
  {
    selectedKnowledgeIds: Array.from({ length: 10 }, (_, index) => `k${index + 1}`),
    text: `推导真相：${Array.from(
      { length: 10 },
      (_, index) => `结论${index + 1}`,
    ).join('。')}。`,
  },
);

assert.throws(
  () => buildTruthSubmission([knowledge('h1', '待验证假说', 'hypothesis')]),
  /at least one confirmed conclusion/i,
);
