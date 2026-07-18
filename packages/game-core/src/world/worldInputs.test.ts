import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { advanceWorldTickSync as advanceWorldTick, createInitialWorldState } from './worldSimulator';
import {
  applyWorldInputs,
  buildWorldInputsFromPlayerPlan,
} from './worldInputs';

function plan(actions: ActionPlan['actions']): ActionPlan {
  return {
    id: `plan-${actions.map((action) => action.intent).join('-')}`,
    raw: actions.map((action) => action.raw).join('; '),
    summary: actions.map((action) => action.method ?? action.intent).join('; '),
    actions,
    confidence: 1,
    warnings: [],
  };
}

function action(
  intent: string,
  target: string,
  raw: string,
  method = raw,
): ActionPlan['actions'][number] {
  return {
    id: `action-${intent}-${target}`,
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

function testPoliceCallWritesReportKnowledge() {
  const world = createInitialWorldState();
  const inputs = buildWorldInputsFromPlayerPlan(plan([
    action('call_police', 'police', 'call 110 and report possible fake police'),
  ]), world);

  const result = applyWorldInputs(world, inputs);

  assert.ok(inputs.some((input) => input.type === 'player_called_police'));
  assert.equal(result.knowledge.real_police.facts.report_received.source, 'message');
  assert.equal(result.knowledge.real_police.facts.reported_fake_police.source, 'message');
  assert.equal(result.pendingNarration.length, 1);
}

function testPhotoOnlyReachesLinYueWhenSent() {
  const world = createInitialWorldState();
  const photoOnly = applyWorldInputs(world, buildWorldInputsFromPlayerPlan(plan([
    action('preserve_evidence', 'package', 'photograph the package'),
  ]), world));

  assert.equal(photoOnly.objects.package_photo.flags.exists, true);
  assert.equal(photoOnly.knowledge.lin_yue.facts.package_photo, undefined);

  const sent = applyWorldInputs(photoOnly, buildWorldInputsFromPlayerPlan(plan([
    action('communicate', 'linyue', 'send the package photo to Lin Yue'),
  ]), photoOnly));

  assert.equal(sent.knowledge.lin_yue.facts.package_photo.source, 'message');
  assert.equal(sent.objects.package_photo.flags.sharedWithLinYue, true);
}

function testInputBridgeCanDriveNextTickConflict() {
  let world = createInitialWorldState();
  world.characters.chen_huaimin.location = 'corridor_5f';
  world.characters.lin_yue.location = 'corridor_5f';

  world = applyWorldInputs(world, buildWorldInputsFromPlayerPlan(plan([
    action('preserve_evidence', 'package', 'photograph the package'),
    action('communicate', 'linyue', 'send the package photo to Lin Yue'),
  ]), world));

  const result = advanceWorldTick(world);

  assert.ok(result.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  assert.ok(result.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(result.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
}

function testLieToChenWritesLowConfidenceKnowledge() {
  const world = createInitialWorldState();
  const result = applyWorldInputs(world, buildWorldInputsFromPlayerPlan(plan([
    action('deceive', 'chen_huaimin', 'tell Chen the package is in the closet'),
  ]), world));

  const fact = result.knowledge.chen_huaimin.facts.package_in_closet;

  assert.equal(fact.source, 'lied_by_other');
  assert.equal(fact.confidence, 0.65);
  assert.ok(result.characters.chen_huaimin.goalStack.includes('investigate_closet'));
}

testPoliceCallWritesReportKnowledge();
testPhotoOnlyReachesLinYueWhenSent();
testInputBridgeCanDriveNextTickConflict();
testLieToChenWritesLowConfidenceKnowledge();
