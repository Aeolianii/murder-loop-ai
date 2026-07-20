import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import {
  ensureWorldState,
  syncGameStateToWorld,
} from './syncGameWorld';

function testEnsureWorldStateCreatesSyncedWorld() {
  const state = createInitialGameState();
  state.run = 3;
  state.minute = 23 * 60 + 18;
  state.threat = 51;

  const world = ensureWorldState(state);

  assert.equal(world.run, state.run);
  assert.equal(world.minute, state.minute);
  assert.equal(world.threat, state.threat);
  assert.notEqual(world, state.world);
  assert.equal(state.world, undefined);
}

function testSyncEvidenceAndLinYueKnowledge() {
  const state = createInitialGameState();
  state.evidencePhase = 'evidence_shared';
  state.room.package.state.photographed = true;
  state.linYuePhase = 'received_photo';

  const world = syncGameStateToWorld(state, ensureWorldState(state));

  assert.equal(world.objects.package.flags.photographed, true);
  assert.equal(world.objects.package_photo.flags.exists, true);
  assert.equal(world.objects.package_photo.flags.sharedWithLinYue, true);
  assert.equal(world.knowledge.player.facts.package_photo.source, 'seen');
  assert.equal(world.knowledge.lin_yue.facts.package_photo.source, 'message');
  assert.equal(world.knowledge.lin_yue.facts.player_reported_door_activity, undefined);
  assert.equal(world.knowledge.lin_yue.facts.report_received, undefined);
}

function testSyncPoliceKnowledge() {
  const state = createInitialGameState();
  state.policePhase = 'real_police_en_route';

  const world = syncGameStateToWorld(state, ensureWorldState(state));

  assert.equal(world.knowledge.real_police.facts.report_received.source, 'message');
  assert.equal(world.knowledge.real_police.facts.reported_fake_police.source, 'message');
  assert.ok(world.characters.real_police.goalStack.includes('respond_to_report'));
}

function testSyncDoorAndWindowState() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.barricaded = true;
  state.room.window.state.locked = true;
  state.room.window.state.curtainClosed = true;

  const world = syncGameStateToWorld(state, ensureWorldState(state));

  assert.equal(world.objects.door_lock.flags.locked, true);
  assert.equal(world.objects.door_lock.flags.barricaded, true);
  assert.equal(world.objects.window_lock.flags.locked, true);
  assert.equal(world.objects.window_lock.flags.curtainClosed, true);
}

function testEnsureWorldStatePreservesExistingWorldEvents() {
  const state = createInitialGameState();
  const world = ensureWorldState(state);
  world.events.push({
    id: 'test.event',
    minute: world.minute,
    type: 'knowledge',
    actors: ['player'],
    facts: ['test_fact'],
    visibility: 'player',
    effects: [],
  });
  state.world = world;
  state.minute += 2;

  const synced = ensureWorldState(state);

  assert.ok(synced.events.some((event) => event.id === 'test.event'));
  assert.equal(synced.minute, state.minute);
}

function testEnsureWorldStateBackfillsCapabilitiesForLegacySnapshots() {
  const state = createInitialGameState();
  state.world = ensureWorldState(state);
  delete (state.world.characters.real_police as Partial<
    typeof state.world.characters.real_police
  >).capabilities;

  const synced = ensureWorldState(state);

  assert(synced.characters.real_police.capabilities.includes('intervene'));
}

testEnsureWorldStateCreatesSyncedWorld();
testSyncEvidenceAndLinYueKnowledge();
testSyncPoliceKnowledge();
testSyncDoorAndWindowState();
testEnsureWorldStatePreservesExistingWorldEvents();
testEnsureWorldStateBackfillsCapabilitiesForLegacySnapshots();
