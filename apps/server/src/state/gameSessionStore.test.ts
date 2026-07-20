import assert from 'node:assert/strict';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import { createInMemoryGameSessionStore } from './gameSessionStore';

const sessions = createInMemoryGameSessionStore();
const initial = createInitialGameState();

const first = sessions.open({
  gameSessionId: 'session-a',
  inputStateVersion: 0,
  bootstrapState: initial,
});
assert.equal(first.status, 'ready');
if (first.status !== 'ready') throw new Error('Expected the first session open to succeed.');

const concurrent = sessions.open({
  gameSessionId: 'session-a',
  inputStateVersion: 0,
  bootstrapState: { ...initial, minute: initial.minute + 20 },
});
assert.equal(concurrent.status, 'ready');
if (concurrent.status !== 'ready') throw new Error('Expected a concurrent reader at version zero.');
assert.equal(
  concurrent.state.minute,
  initial.minute,
  'an existing session must ignore a client-supplied replacement state',
);

const firstCommit = await first.store.commitTurn({
  expectedLoopId: first.loopId,
  turnId: 'turn-a',
  expectedInputStateVersion: first.stateVersion,
  outputStateVersion: first.stateVersion + 1,
  candidateState: { ...first.state, minute: first.state.minute + 1 },
  confirmedEvents: [],
});
assert.deepEqual(firstCommit, { status: 'committed' });

const concurrentCommit = await concurrent.store.commitTurn({
  expectedLoopId: concurrent.loopId,
  turnId: 'turn-b',
  expectedInputStateVersion: concurrent.stateVersion,
  outputStateVersion: concurrent.stateVersion + 1,
  candidateState: { ...concurrent.state, minute: concurrent.state.minute + 2 },
  confirmedEvents: [],
});
assert.deepEqual(concurrentCommit, { status: 'conflict', reason: 'state_version_conflict' });

const stale = sessions.open({
  gameSessionId: 'session-a',
  inputStateVersion: 0,
  bootstrapState: initial,
});
assert.equal(stale.status, 'conflict');
if (stale.status !== 'conflict') throw new Error('Expected stale version zero to be rejected.');
assert.equal(stale.authoritativeStateVersion, 1);

const current = sessions.open({
  gameSessionId: 'session-a',
  inputStateVersion: 1,
  bootstrapState: initial,
});
assert.equal(current.status, 'ready');
if (current.status !== 'ready') throw new Error('Expected the current session version to open.');
assert.equal(current.state.minute, initial.minute + 1);

console.log('gameSessionStore.test.ts passed');
