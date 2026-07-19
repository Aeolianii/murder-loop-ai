import assert from 'node:assert/strict';
import type { WorldEvent, WorldState } from '@murder-loop-ai/shared';
import { createInitialWorldState } from './worldSimulator';
import {
  commitWorldNarrationBatch,
  readWorldNarrationBatch,
} from './narrationCursor';

function worldEvent(id: string, visibility: WorldEvent['visibility']): WorldEvent {
  return {
    id,
    minute: 23 * 60 + 1,
    type: 'message',
    actors: ['player'],
    facts: [id],
    visibility,
    effects: [],
    narrationHint: `Narrate ${id}`,
  };
}

function testCursorReadsNewVisibleEventsAndCommitsAllScannedEvents() {
  const world = createInitialWorldState();
  const firstVisible = worldEvent('world.visible.first', 'player');
  const hidden = worldEvent('world.hidden', 'hidden');
  const secondVisible = worldEvent('world.visible.second', 'public');
  world.events.push(firstVisible, hidden, secondVisible);
  world.pendingNarration.push(firstVisible, hidden, secondVisible);

  const batch = readWorldNarrationBatch(world);

  assert.equal(batch.fromCursor, 0);
  assert.equal(batch.toCursor, 3);
  assert.deepEqual(batch.events.map((event) => event.id), [
    'world.visible.first',
    'world.visible.second',
  ]);
  assert.equal(world.narrationCursor, 0);

  const committed = commitWorldNarrationBatch(world, batch);

  assert.equal(committed.narrationCursor, 3);
  assert.deepEqual(committed.pendingNarration, []);
  assert.deepEqual(committed.consumedNarrationEventIds, [
    'world.visible.first',
    'world.visible.second',
  ]);
  assert.deepEqual(readWorldNarrationBatch(committed).events, []);
}

function testCursorReadsOnlyEventsAppendedAfterCommit() {
  const world = createInitialWorldState();
  world.events.push(worldEvent('world.old', 'player'));
  const first = commitWorldNarrationBatch(world, readWorldNarrationBatch(world));
  const nextEvent = worldEvent('world.next', 'player');
  first.events.push(nextEvent);
  first.pendingNarration.push(nextEvent);

  const next = readWorldNarrationBatch(first);

  assert.equal(next.fromCursor, 1);
  assert.equal(next.toCursor, 2);
  assert.deepEqual(next.events.map((event) => event.id), ['world.next']);
}

function testLegacySaveResumesAtFirstPendingEvent() {
  const world = createInitialWorldState();
  const historical = worldEvent('world.historical', 'player');
  const pending = worldEvent('world.pending', 'player');
  world.events.push(historical, pending);
  world.pendingNarration = [pending];
  delete (world as Partial<WorldState>).narrationCursor;

  const batch = readWorldNarrationBatch(world);

  assert.equal(batch.fromCursor, 1);
  assert.equal(batch.toCursor, 2);
  assert.deepEqual(batch.events.map((event) => event.id), ['world.pending']);
}

function testLegacySaveWithoutNarrationMetadataDoesNotReplayHistory() {
  const world = createInitialWorldState();
  world.events.push(worldEvent('world.historical', 'player'));
  delete (world as Partial<WorldState>).narrationCursor;

  const batch = readWorldNarrationBatch(world);

  assert.equal(batch.fromCursor, 1);
  assert.equal(batch.toCursor, 1);
  assert.deepEqual(batch.events, []);
}

testCursorReadsNewVisibleEventsAndCommitsAllScannedEvents();
testCursorReadsOnlyEventsAppendedAfterCommit();
testLegacySaveResumesAtFirstPendingEvent();
testLegacySaveWithoutNarrationMetadataDoesNotReplayHistory();
