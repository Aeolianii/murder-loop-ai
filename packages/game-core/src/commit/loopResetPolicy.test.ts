import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { InMemoryAtomicTurnStore, evaluateTurnWorkFreshness } from './atomicTurnCommit';
import { atomicLoopReset, prepareGameLoopReset } from './loopResetPolicy';

const checkpoint = createInitialGameState();
const current = structuredClone(checkpoint);
current.run = 1;
current.phoneBattery = 3;
current.killerKnowledge.knowsPlayerOpenedPackage = true;
current.room.front_door.state.locked = true;
current.memory.crossRun.push({
  id: 'memory-loop-1',
  run: 1,
  title: 'Remembered death',
  text: 'The chain stopped the spare key.',
  scope: 'cross_run',
  kind: 'death',
  owner: 'player',
});
current.memory.characters.player.push({
  id: 'memory-player-loop-1',
  run: 1,
  title: 'Player memory',
  text: 'The label had a familiar name.',
  scope: 'character',
  kind: 'clue',
  owner: 'player',
});
current.memory.characters.killer.push({
  id: 'memory-killer-loop-1',
  run: 1,
  title: 'Killer memory',
  text: 'The player blocked the door.',
  scope: 'character',
  kind: 'observation',
  owner: 'killer',
});
current.clues.push(
  {
    id: 'persistent-clue',
    title: 'Remembered label',
    detail: 'A name from the exterior label.',
    source: 'player_discovered',
    weight: 5,
    discoveredAt: { run: 1, minute: current.minute },
    isPersistent: true,
    claims: ['fact.package.exterior.label_ambiguous'],
    basedOnObservationIds: ['observation.persistent-label'],
    sourceEventIds: ['event.inspect.package'],
  },
  {
    id: 'temporary-clue',
    title: 'Temporary trace',
    detail: 'This should not survive the loop.',
    source: 'player_discovered',
    weight: 2,
    discoveredAt: { run: 1, minute: current.minute },
    isPersistent: false,
  },
);
current.observations.push(
  {
    id: 'observation.persistent-label',
    subject: 'package',
    predicate: 'exterior_label',
    value: 'ambiguous',
    scope: 'exterior.label',
    visibleFactIds: ['fact.package.exterior.label_ambiguous'],
    sourceEventIds: ['event.inspect.package'],
    observedAt: { run: 1, minute: current.minute },
  },
  {
    id: 'observation.temporary-trace',
    subject: 'front_door',
    predicate: 'sound',
    value: 'footsteps',
    scope: 'auditory',
    visibleFactIds: ['fact.front_door.footsteps'],
    sourceEventIds: ['event.listen.front-door'],
    observedAt: { run: 1, minute: current.minute },
  },
);

const reset = prepareGameLoopReset(current, checkpoint, {
  previousLoopId: 'loop-1',
  nextLoopId: 'loop-2',
  startingStateVersion: 0,
  nextRun: 2,
});

assert.equal(reset.state.run, 2);
assert.equal(reset.state.phoneBattery, checkpoint.phoneBattery);
assert.equal(reset.state.killerKnowledge.knowsPlayerOpenedPackage, checkpoint.killerKnowledge.knowsPlayerOpenedPackage);
assert.equal(reset.state.room.front_door.state.locked, checkpoint.room.front_door.state.locked);
assert.deepEqual(reset.state.memory.crossRun, current.memory.crossRun);
assert.deepEqual(reset.state.memory.characters.player, current.memory.characters.player);
assert.deepEqual(reset.state.memory.characters.killer, checkpoint.memory.characters.killer);
assert.deepEqual(reset.state.clues.map((clue) => clue.id), ['persistent-clue']);
assert.deepEqual(reset.state.observations.map((observation) => observation.id), ['observation.persistent-label']);
assert.deepEqual(reset.rebuildProjections, ['facts', 'player', 'killer', 'npc', 'clue', 'recommendation']);

const store = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: current });
const outcome = await atomicLoopReset({
  expectedLoopId: 'loop-1',
  expectedStateVersion: 6,
  reset,
}, store);
assert.equal(outcome.status, 'reset');
assert.equal(store.snapshot().loopId, 'loop-2');
assert.equal(store.snapshot().stateVersion, 0);

const duplicateReset = await atomicLoopReset({
  expectedLoopId: 'loop-1',
  expectedStateVersion: 6,
  reset,
}, store);
assert.equal(duplicateReset.status, 'conflict');
assert.equal(store.snapshot().loopId, 'loop-2');

const failingStore = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: current });
failingStore.failNextCommit();
const failedReset = await atomicLoopReset({
  expectedLoopId: 'loop-1',
  expectedStateVersion: 6,
  reset,
}, failingStore);
assert.equal(failedReset.status, 'failed');
assert.equal(failingStore.snapshot().loopId, 'loop-1');

const oldTurn = {
  loopId: 'loop-1',
  turnId: 'turn-7',
  inputStateVersion: 6,
  deadlineAt: '2026-07-20T12:00:10.000Z',
};
assert.deepEqual(
  evaluateTurnWorkFreshness(oldTurn, store.snapshot(), new Date('2026-07-20T12:00:00.000Z')),
  { accept: false, reason: 'loop_invalidated' },
);
