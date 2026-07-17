import assert from 'node:assert/strict';
import { DEADLINE_MINUTE, type ActionPlan, type GameState } from '@murder-loop-ai/shared';
import { createClueFromTemplate } from '@murder-loop-ai/content';
import { createInitialGameState } from '../state/createInitialState';
import { resolveStoryNode } from './resolveStoryNode';

function planForPhoneUse(): ActionPlan {
  return {
    id: 'plan-phone-use',
    raw: '赶紧给林越打电话确认情况',
    summary: '使用手机联系林越',
    confidence: 1,
    warnings: [],
    actions: [
      {
        id: 'act-call-linyue',
        raw: '赶紧给林越打电话确认情况',
        intent: 'communicate',
        target: 'phone',
        method: '用手机联系林越',
        confidence: 1,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
  };
}

function singleActionPlan(action: ActionPlan['actions'][number]): ActionPlan {
  return {
    id: `plan-${action.id}`,
    raw: action.raw,
    summary: action.method ?? action.raw,
    confidence: 1,
    warnings: [],
    actions: [action],
  };
}

function action(
  intent: string,
  target: string,
  raw: string,
  method = raw,
): ActionPlan['actions'][number] {
  return {
    id: `act-${intent}-${target}`,
    raw,
    intent,
    target,
    method,
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  };
}

function addClue(state: GameState, clueId: string) {
  const clue = createClueFromTemplate(clueId, state.run, state.minute);
  assert.ok(clue, `missing clue template: ${clueId}`);
  state.clues.push(clue);
}

function testBatteryCriticalReturnsChargingRecommendation() {
  const state = createInitialGameState();
  state.phoneBattery = 20;
  state.phoneFunctional = true;

  const resolution = resolveStoryNode(state, planForPhoneUse());

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'battery_critical');
  assert.equal(resolution.timePassed, 0);
  assert.equal(resolution.threatDelta, 0);
  assert.deepEqual(resolution.addedClueIds, ['battery_critical']);
  assert.ok(
    resolution.recommendedActions.some((action) => action.label.includes('充电器') || action.label.includes('充电')),
    'battery_critical should recommend charging before further phone use',
  );
}

testBatteryCriticalReturnsChargingRecommendation();

function testRoom403ReceiptRequiresWrongPackageAndDeepInspection() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 12;
  addClue(state, 'wrong_package');

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('inspect', 'package', '仔细翻旧书夹层找收据', '仔细检查包裹里的旧书夹层')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'room_403_receipt');
  assert.deepEqual(resolution.addedClueIds, ['room_403_receipt']);
  assert.equal(resolution.timePassed, 2);
  assert.ok(resolution.recommendedActions.some((item) => item.label.includes('403')));
}

function testLinYueRetractedMessageSetsWorriedPhase() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 5;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('inspect', 'phone', '看一眼手机')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'linyue_retracted_message');
  const patchedState = structuredClone(state) as GameState;
  resolution.statePatch?.(patchedState);
  assert.equal(patchedState.linYuePhase, 'worried');
  assert.ok(resolution.recommendedActions.some((item) => item.label.includes('追问林越')));
}

function testPeepholeBlindSpotRequiresDoorInspectionAndPressure() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 20;
  state.threat = 35;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('inspect', 'peephole', '从猫眼看走廊')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'peephole_blind_spot');
  assert.equal(resolution.threatDelta, 5);
  assert.ok(resolution.recommendedActions.some((item) => item.label.includes('不要开门')));
}

function testFakeStoreCallRespondsToBarricadeOrHighThreat() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 20;
  state.room.front_door.state.barricaded = true;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('wait', 'phone', '等一下看看电话')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'fake_store_call');
  assert.equal(resolution.threatDelta, 6);
  assert.ok(resolution.recommendedActions.some((item) => item.label.includes('不要按对方要求下楼')));
}

function testFalsePoliceOverknowsTakesPriorityOverBattery() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 32;
  state.policePhase = 'dispatch_pending';
  state.killerKnowledge.knowsPoliceCalled = true;
  state.phoneBattery = 20;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('verify_identity', 'police', '用手机核验门外警察身份')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'false_police_overknows');
  assert.equal(resolution.threatDelta, 8);
  assert.ok(resolution.recommendedActions.some((item) => item.label.includes('不要开门')));
}

function testHandoffFailedRequiresDefenseOrEvidenceAndHasTopPriority() {
  const state = createInitialGameState();
  state.minute = DEADLINE_MINUTE;
  state.policePhase = 'dispatch_pending';
  state.threat = 80;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('wait', 'front_door', '守住门口继续等')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'handoff_failed_2347');
  assert.equal(resolution.phase, 'post_2347_escalation');
  assert.equal(resolution.threatDelta, 12);
}

function testHandoffFailedAcceptsLinYuePoliceAssistAsShortTermCondition() {
  const state = createInitialGameState();
  state.minute = DEADLINE_MINUTE;
  state.linYuePhase = 'calling_police';

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('wait', 'front_door', '守住门口继续等')),
  );

  assert.ok(resolution);
  assert.equal(resolution.nodeId, 'handoff_failed_2347');
}

function testHandoffFailedDoesNotTriggerWithoutDefenseOrEvidence() {
  const state = createInitialGameState();
  state.minute = DEADLINE_MINUTE;

  const resolution = resolveStoryNode(
    state,
    singleActionPlan(action('wait', 'front_door', '守住门口继续等')),
  );

  assert.equal(resolution?.nodeId ?? null, null);
}

testRoom403ReceiptRequiresWrongPackageAndDeepInspection();
testLinYueRetractedMessageSetsWorriedPhase();
testPeepholeBlindSpotRequiresDoorInspectionAndPressure();
testFakeStoreCallRespondsToBarricadeOrHighThreat();
testFalsePoliceOverknowsTakesPriorityOverBattery();
testHandoffFailedRequiresDefenseOrEvidenceAndHasTopPriority();
testHandoffFailedAcceptsLinYuePoliceAssistAsShortTermCondition();
testHandoffFailedDoesNotTriggerWithoutDefenseOrEvidence();
