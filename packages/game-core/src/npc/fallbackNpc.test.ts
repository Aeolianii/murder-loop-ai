import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { ensureWorldState } from '../world/syncGameWorld';
import { fallbackNpcReply } from './fallbackNpc';

function testLinYuePhotoOnlyFallbackDoesNotUseDoorOrPoliceKnowledge() {
  const state = createInitialGameState();
  state.linYuePhase = 'received_photo';
  state.room.package.state.photographed = true;

  const reply = fallbackNpcReply('linyue', 'Do you recognize this package?', state);

  assert.equal(reply.speaker, 'linyue');
  assert.match(reply.text, /package|photo/i);
  assert.doesNotMatch(reply.text, /door|hallway|police|outside|unable to get in/i);
  assert.match(reply.riskWarning, /only knows about the package photo/i);
}

function testLinYueFallbackCanUseDoorKnowledgeAfterPlayerReportsIt() {
  const state = createInitialGameState();
  state.linYuePhase = 'received_photo';
  state.room.package.state.photographed = true;
  const world = ensureWorldState(state);
  world.knowledge.lin_yue.facts.player_reported_door_activity = {
    confidence: 1,
    source: 'message',
    minuteLearned: state.minute,
  };
  state.world = world;

  const reply = fallbackNpcReply('linyue', 'I heard someone outside the door say they cannot get in.', state);

  assert.equal(reply.speaker, 'linyue');
  assert.match(reply.text, /门|door|警|police|outside|进不去|unable to get in/i);
}

testLinYuePhotoOnlyFallbackDoesNotUseDoorOrPoliceKnowledge();
testLinYueFallbackCanUseDoorKnowledgeAfterPlayerReportsIt();

console.log('fallbackNpc.test.ts passed');
