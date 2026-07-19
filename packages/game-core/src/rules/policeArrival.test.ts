import assert from 'node:assert/strict';
import type { ActionPlan, GameState } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyPlayerActions } from './applyPlayerActions';
import { POLICE_ARRIVAL_DELAY_MINUTES } from './policeArrival';

function actionPlan(actions: ActionPlan['actions']): ActionPlan {
  return {
    id: `plan-${actions.map((action) => action.intent).join('-')}`,
    raw: actions.map((action) => action.raw).join('；'),
    summary: actions.map((action) => action.method ?? action.intent).join('；'),
    actions,
    confidence: 1,
    warnings: [],
  };
}

function policeAction(intent: 'call_police' | 'verify_identity', raw: string): ActionPlan['actions'][number] {
  return {
    id: `action-${intent}`,
    raw,
    intent,
    target: 'police',
    method: intent === 'call_police' ? 'call real police' : 'verify official callback',
    confidence: 1,
    timeCost: 2,
    noise: 1,
    risk: 'medium',
  };
}

function waitAction(): ActionPlan['actions'][number] {
  return {
    id: `action-wait-${Date.now()}-${Math.random()}`,
    raw: 'keep the door closed and wait',
    intent: 'wait',
    target: 'self',
    method: 'hold position',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  };
}

function waitTurn(state: GameState): GameState {
  return applyPlayerActions(state, actionPlan([waitAction()])).state;
}

function testVerifiedPoliceStartsHiddenArrivalCountdown() {
  const state = createInitialGameState();
  const result = applyPlayerActions(state, actionPlan([
    policeAction('call_police', 'call 110'),
    policeAction('verify_identity', 'verify the official callback and badge number'),
  ]));

  assert.equal(result.state.policePhase, 'real_police_en_route');
  assert.equal(result.state.phase, 'confrontation');
  assert.equal(result.state.ending, null);
  assert.equal(result.state.policeArrivalMinute, result.state.minute + POLICE_ARRIVAL_DELAY_MINUTES);
}

function testVerifiedPoliceResolvesToArrestEndingInBackground() {
  let state = applyPlayerActions(createInitialGameState(), actionPlan([
    policeAction('call_police', 'call 110'),
    policeAction('verify_identity', 'verify the official callback and badge number'),
  ])).state;

  while (!state.ending) {
    state = waitTurn(state);
  }

  assert.equal(state.ending, 'escaped_no_evidence');
  assert.equal(state.endingReason, 'police_arrived_without_evidence');
  assert.equal(state.phase, 'survived');
  assert.equal(state.policePhase, 'arrived');
  assert.equal(state.killerStatus, 'arrested');
}

function testVerifiedPoliceWithEvidenceResolvesToConvictionEnding() {
  let state = createInitialGameState();
  state.room.package.state.photographed = true;
  state.room.phone.state.recording = true;
  state.clues.push({
    id: 'package_photo',
    title: 'Package photo',
    detail: 'The package label and contents were photographed.',
    source: 'player_discovered',
    weight: 8,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });

  state = applyPlayerActions(state, actionPlan([
    policeAction('call_police', 'call 110'),
    policeAction('verify_identity', 'verify the official callback and badge number'),
  ])).state;

  while (!state.ending) {
    state = waitTurn(state);
  }

  assert.equal(state.ending, 'escaped_with_evidence');
  assert.equal(state.endingReason, 'police_arrived_with_evidence');
  assert.equal(state.phase, 'survived');
  assert.equal(state.policePhase, 'arrived');
  assert.equal(state.killerStatus, 'arrested');
}

function testUnverifiedPoliceDoesNotStartArrivalCountdown() {
  const state = createInitialGameState();
  const result = applyPlayerActions(state, actionPlan([
    policeAction('call_police', 'call 110 but do not verify identity'),
  ]));

  assert.equal(result.state.policePhase, 'dispatch_pending');
  assert.equal(result.state.policeArrivalMinute, undefined);
  assert.notEqual(result.state.phase, 'confrontation');
}

testVerifiedPoliceStartsHiddenArrivalCountdown();
testVerifiedPoliceResolvesToArrestEndingInBackground();
testVerifiedPoliceWithEvidenceResolvesToConvictionEnding();
testUnverifiedPoliceDoesNotStartArrivalCountdown();
