import assert from 'node:assert/strict';
import {
  advanceWorldTickSync as advanceWorldTick,
  createInitialWorldState,
} from './worldSimulator';
import { buildObjectiveState } from './npcCoordinator';

function testPoliceCallCanForceFakePoliceRetreat() {
  const world = createInitialWorldState();

  world.characters.real_police.location = 'lobby';
  world.characters.fake_police.location = 'lobby';
  world.characters.fake_police.goalStack = ['enter_503'];
  world.characters.fake_police.currentAction = 'impersonate_police';
  world.knowledge.real_police.facts.reported_fake_police = {
    confidence: 0.9,
    source: 'message',
    minuteLearned: world.minute,
  };

  const result = advanceWorldTick(world);
  const fakePolice = result.characters.fake_police;
  const encounter = result.events.find((event) => event.id === 'encounter.real_police_meets_fake_police');

  assert.ok(encounter);
  assert.equal(encounter.type, 'encounter');
  assert.deepEqual(encounter.actors, ['real_police', 'fake_police']);
  assert.equal(fakePolice.risk, 60);
  assert.equal(fakePolice.status, 'moving');
  assert.equal(fakePolice.destination, 'parking_lot');
  assert.equal(fakePolice.currentAction, 'retreat_or_switch_route');
  assert.ok(fakePolice.goalStack.includes('retreat_or_switch_route'));
  assert.equal(result.knowledge.real_police.facts.fake_police_present.source, 'seen');
  assert.equal(result.pendingNarration.length, 1);
}

function testTickMovesCharactersBeforeEncounterDetection() {
  const world = createInitialWorldState();

  world.characters.chen_huaimin.location = 'room_501';
  world.characters.chen_huaimin.destination = 'corridor_5f';
  world.characters.lin_yue.location = 'corridor_5f';
  world.knowledge.lin_yue.facts.package_photo = {
    confidence: 1,
    source: 'message',
    minuteLearned: world.minute,
  };

  const result = advanceWorldTick(world);

  assert.equal(result.characters.chen_huaimin.location, 'corridor_5f');
  assert.ok(result.events.some((event) => event.id.startsWith('movement.chen_huaimin.from.room_501.to.corridor_5f.at.')));
  assert.ok(result.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  assert.ok(result.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(result.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
  assert.equal(result.locations.corridor_5f.risk, 15);
}

function testObjectiveStateRedactsPrivateRoomFactsPerNpc() {
  const world = createInitialWorldState();
  world.objects.package.flags.opened = true;
  world.objects.package.flags.photographed = true;
  world.events.push({
    id: 'player.private.opened_package',
    minute: world.minute,
    type: 'object',
    actors: ['player'],
    location: 'room_503',
    facts: ['package_opened_by_player'],
    visibility: 'player',
    effects: [],
  });

  const linYuePublicView = buildObjectiveState(world, 'lin_yue');

  assert.equal(linYuePublicView.objects.package.location, 'unknown');
  assert.deepEqual(linYuePublicView.objects.package.flags, {});
  assert.equal(linYuePublicView.recentPublicEvents.length, 0);

  world.knowledge.lin_yue.facts.package_photo = {
    confidence: 1,
    source: 'message',
    minuteLearned: world.minute,
  };

  const linYuePhotoView = buildObjectiveState(world, 'lin_yue');

  assert.equal(linYuePhotoView.objects.package_photo.location, 'message');
  assert.deepEqual(linYuePhotoView.objects.package_photo.flags, { exists: true });
  assert.equal(linYuePhotoView.objects.package.flags.opened, undefined);
  assert.equal(linYuePhotoView.objects.package.flags.photographed, undefined);
}

function testOneShotConflictDoesNotRepeatAcrossTicks() {
  const world = createInitialWorldState();
  world.characters.chen_huaimin.location = 'corridor_5f';
  world.characters.lin_yue.location = 'corridor_5f';
  world.knowledge.lin_yue.facts.package_photo = {
    confidence: 1,
    source: 'message',
    minuteLearned: world.minute,
  };

  const first = advanceWorldTick(world);
  const stressAfterFirstTick = first.characters.lin_yue.stress;
  const second = advanceWorldTick(first);
  const conflicts = second.events.filter((event) => event.id === 'conflict.chen_intercepts_linyue');

  assert.equal(conflicts.length, 1);
  assert.equal(second.characters.lin_yue.stress, stressAfterFirstTick);
  assert.equal(second.pendingNarration.filter((event) => event.id === 'conflict.chen_intercepts_linyue').length, 1);
}

function testMovementEventsRemainUniqueWhenNpcReusesARoute() {
  const world = createInitialWorldState();
  world.characters.chen_huaimin.destination = 'corridor_5f';

  const first = advanceWorldTick(world);
  first.characters.chen_huaimin.destination = 'room_501';
  const second = advanceWorldTick(first);
  second.characters.chen_huaimin.destination = 'corridor_5f';
  const third = advanceWorldTick(second);
  const corridorMoves = third.events.filter((event) =>
    event.id.startsWith('movement.chen_huaimin.from.room_501.to.corridor_5f.at.')
  );

  assert.equal(corridorMoves.length, 2);
  assert.notEqual(corridorMoves[0].id, corridorMoves[1].id);
}

testPoliceCallCanForceFakePoliceRetreat();
testTickMovesCharactersBeforeEncounterDetection();
testObjectiveStateRedactsPrivateRoomFactsPerNpc();
testOneShotConflictDoesNotRepeatAcrossTicks();
testMovementEventsRemainUniqueWhenNpcReusesARoute();
