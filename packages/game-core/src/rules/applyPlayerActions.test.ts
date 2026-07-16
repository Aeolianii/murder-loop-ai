import { strict as assert } from 'node:assert';
import { DEADLINE_MINUTE, type ActionPlan, type GameState } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyPlayerActions } from './applyPlayerActions';

function actionPlan(actions: ActionPlan['actions']): ActionPlan {
  return {
    id: `plan-${actions.map((action) => action.intent).join('-')}`,
    raw: actions.map((action) => action.raw).join('; '),
    summary: actions.map((action) => action.method ?? action.intent).join('; '),
    confidence: 1,
    warnings: [],
    actions,
  };
}

function waitAction(): ActionPlan['actions'][number] {
  return {
    id: 'act-wait',
    raw: 'wait',
    intent: 'wait',
    target: 'self',
    method: 'wait quietly',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  };
}

function addPackagePhoto(state: GameState) {
  state.room.package.state.photographed = true;
  state.clues.push({
    id: 'package_photo',
    title: 'Package photo',
    detail: 'The package label and contents were photographed.',
    source: 'player_discovered',
    weight: 8,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });
}

function testChargingPhoneFromParserShape() {
  const state = createInitialGameState();
  state.phoneBattery = 10;
  state.phoneFunctional = true;
  state.room.phone.state.battery = 10;

  const plan: ActionPlan = {
    id: 'plan-charge-phone',
    raw: '使用充电器给手机充电',
    summary: '给手机充电',
    confidence: 0.98,
    warnings: [],
    actions: [
      {
        id: 'act-charge-phone',
        raw: '使用充电器给手机充电',
        intent: 'use_item',
        target: 'phone',
        method: '使用充电器给手机充电',
        confidence: 0.98,
        timeCost: 2,
        noise: 0,
        risk: 'low',
      },
    ],
  };

  const result = applyPlayerActions(state, plan);

  assert.equal(result.title, '电量回升');
  assert.equal(result.state.phoneBattery, 40);
  assert.equal(result.state.room.phone.state.battery, 40);
  assert.ok(!result.text.includes('未知'), 'charging with a phone target should not become an unknown item');
}

testChargingPhoneFromParserShape();

function testDeadlineWithoutSurvivalConditionsUsesDeathEnding() {
  const state = createInitialGameState();
  state.minute = DEADLINE_MINUTE - 1;

  const result = applyPlayerActions(state, actionPlan([waitAction()]));

  assert.equal(result.state.ending, 'death');
  assert.equal(result.state.endingReason, 'deadline_murder');
  assert.equal(result.state.phase, 'death');
}

function testDeadlineWithEvidenceAndDefenseUsesConvictionEnding() {
  const state = createInitialGameState();
  state.minute = DEADLINE_MINUTE - 1;
  state.room.front_door.state.barricaded = true;
  state.room.window.state.locked = true;
  state.policePhase = 'real_police_en_route';
  addPackagePhoto(state);
  state.room.phone.state.recording = true;

  const result = applyPlayerActions(state, actionPlan([waitAction()]));

  assert.equal(result.state.ending, 'escaped_with_evidence');
  assert.equal(result.state.endingReason, 'deadline_survived_with_evidence');
  assert.equal(result.state.phase, 'survived');
}

testDeadlineWithoutSurvivalConditionsUsesDeathEnding();
testDeadlineWithEvidenceAndDefenseUsesConvictionEnding();
