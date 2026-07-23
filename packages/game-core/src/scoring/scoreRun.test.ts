import assert from 'node:assert/strict';
import { createClueFromTemplate } from '@murder-loop-ai/content';
import type { GameState } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { activatePlayerKnowledge } from '../knowledge/playerKnowledge';
import { scoreRun } from './scoreRun';

function addClue(state: GameState, clueId: string) {
  const clue = createClueFromTemplate(clueId, state.run, state.minute);
  assert.ok(clue, `missing clue template: ${clueId}`);
  state.clues.push(clue);
}

function testLegacyRawCluesDoNotBypassConclusionInference() {
  const state = createInitialGameState();
  addClue(state, 'wrong_package');
  addClue(state, 'room_403_receipt');
  addClue(state, 'false_police_overknows');
  addClue(state, 'handoff_failed_2347');

  const score = scoreRun(state);

  assert.equal(score.truth, 0);
}

function addAtomicClue(state: GameState, clueId: string) {
  state.clues.push({
    id: clueId,
    title: clueId,
    detail: clueId,
    source: 'player_discovered',
    weight: 1,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });
}

function testTruthScoreComesFromConfirmedConclusionsOnly() {
  const state = createInitialGameState();
  addAtomicClue(state, 'package_label_fragment');
  addAtomicClue(state, 'no_matching_order');

  const activated = activatePlayerKnowledge(state).state;
  assert.equal(scoreRun(activated).truth, 1);

  const legacy = createInitialGameState();
  addClue(legacy, 'police_verified');
  assert.equal(scoreRun(legacy).truth, 0);
}

function testLinYuePoliceAssistScoresBetterThanDanger() {
  const assisted = createInitialGameState();
  assisted.linYuePhase = 'calling_police';

  const approaching = createInitialGameState();
  approaching.linYuePhase = 'coming_to_apartment';

  const endangered = createInitialGameState();
  endangered.linYuePhase = 'endangered';

  assert.ok(scoreRun(assisted).npc > scoreRun(approaching).npc);
  assert.ok(scoreRun(approaching).npc > scoreRun(endangered).npc);
}

function testHandoffAndExternalAssistImproveEvidenceScore() {
  const state = createInitialGameState();
  addClue(state, 'package_photo');
  addClue(state, 'linyue_has_photo');
  addClue(state, 'handoff_failed_2347');

  const score = scoreRun(state);

  assert.equal(score.evidence, 20);
}

testLegacyRawCluesDoNotBypassConclusionInference();
testTruthScoreComesFromConfirmedConclusionsOnly();
testLinYuePoliceAssistScoresBetterThanDanger();
testHandoffAndExternalAssistImproveEvidenceScore();
