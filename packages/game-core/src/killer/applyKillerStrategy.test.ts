import assert from 'node:assert/strict';
import type { KillerStrategy } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyKillerStrategy } from './applyKillerStrategy';

function spareKeyStrategy(): KillerStrategy {
  return {
    id: 'killer-spare-key-test',
    type: 'spare_key_entry',
    title: 'Spare key turns',
    rationale: 'Test spare key against door defenses.',
    visibleToPlayer: true,
    risk: 'high',
  };
}

function testSpareKeyAgainstChainLockDoesNotInventBarricade() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = false;

  const result = applyKillerStrategy(state, spareKeyStrategy());

  assert.equal(result.state.ending, null);
  assert.match(result.text, /反锁|门链|内侧/);
  assert.doesNotMatch(result.text, /椅子|行李箱|顶住|刮|门缝里漏进来/);
}

function testSpareKeyAgainstBarricadeMentionsPhysicalBlock() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = true;

  const result = applyKillerStrategy(state, spareKeyStrategy());

  assert.equal(result.state.ending, null);
  assert.match(result.text, /堵|顶|抵|椅子|行李箱|障碍/);
}

testSpareKeyAgainstChainLockDoesNotInventBarricade();
testSpareKeyAgainstBarricadeMentionsPhysicalBlock();
