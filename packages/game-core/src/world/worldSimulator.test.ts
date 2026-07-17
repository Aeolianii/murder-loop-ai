import assert from 'node:assert/strict';
import {
  advanceWorldTick,
  createInitialWorldState,
} from './worldSimulator';

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
  assert.ok(result.events.some((event) => event.id === 'movement.chen_huaimin.to.corridor_5f'));
  assert.ok(result.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  assert.ok(result.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(result.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
  assert.equal(result.locations.corridor_5f.risk, 15);
}

testPoliceCallCanForceFakePoliceRetreat();
testTickMovesCharactersBeforeEncounterDetection();
