import assert from 'node:assert/strict';
import { applyPlayerActions, buildKillerContext, createInitialGameState } from '@murder-loop-ai/game-core';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { buildKillerPromptPayload } from './killerPrompt';

const inspectPackagePlan: ActionPlan = {
  id: 'inspect-package',
  raw: '检查纸板箱',
  summary: '检查纸板箱',
  actions: [{
    id: 'inspect-package-action',
    raw: '检查纸板箱',
    intent: 'inspect',
    target: 'package',
    method: '检查纸板箱',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }],
  confidence: 1,
  warnings: [],
};

const state = createInitialGameState();
const playerResult = applyPlayerActions(state, inspectPackagePlan);
const killerContext = buildKillerContext(playerResult.state, {
  plan: inspectPackagePlan,
  playerResult,
});
const payload = buildKillerPromptPayload(killerContext);
const serialized = JSON.stringify(payload);

assert.deepEqual(Object.keys(payload), ['killerContext']);
assert.equal('plan' in payload, false);
assert.equal('playerResult' in payload, false);
assert.equal(serialized.includes('药片'), false);
assert.equal(serialized.includes('药板'), false);
assert.equal(serialized.includes('package contents'), false);
assert.equal(serialized.includes('检查纸板箱'), false);
assert.equal(serialized.includes(playerResult.text), false);
