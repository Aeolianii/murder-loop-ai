import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { resolveMinimumPlayableTurn } from './minimumPlayableFallback';

const state = createInitialGameState();
const resolution = resolveMinimumPlayableTurn(
  state,
  '打开包裹，查看里面的东西，然后冲出门',
);

assert.equal(resolution.finalState.minute, state.minute);
assert.equal(resolution.finalState.threat, state.threat);
assert.equal(resolution.finalState.clues.length, state.clues.length);
assert.equal(resolution.finalState.room.package.state.opened, false);
assert.equal(resolution.finalState.room.front_door.state.opened, false);
assert.equal(resolution.plan.actions.length, 0);
assert.equal(resolution.killerStrategy.type, 'minimum_playable_hold');
assert.equal(resolution.npcReply, null);
assert.deepEqual(resolution.recommendedActions, []);
assert.deepEqual(resolution.worldTickTrace, []);
assert.notEqual(resolution.finalState, state);
assert.equal(
  resolution.finalState.log.at(-1)?.text,
  'AI services are unavailable. No requested action or world-state change was applied.',
);
