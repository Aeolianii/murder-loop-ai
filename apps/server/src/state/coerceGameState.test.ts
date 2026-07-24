import assert from 'node:assert/strict';
import { activatePlayerKnowledge, deriveTruth } from '@murder-loop-ai/game-core';
import { coerceGameState } from './coerceGameState';

const state = coerceGameState({
  activatedKnowledge: undefined,
  currentRunKnowledge: undefined,
  discoveredClueIds: undefined,
});

assert.deepEqual(state.activatedKnowledge, []);
assert.deepEqual(state.currentRunKnowledge, []);
assert.deepEqual(state.discoveredClueIds, []);
assert.equal(state.assets['asset.physical.phone']?.ownerId, 'player');
assert.doesNotThrow(() => activatePlayerKnowledge(state));
assert.equal(deriveTruth(state.activatedKnowledge).stage, 'L0');
