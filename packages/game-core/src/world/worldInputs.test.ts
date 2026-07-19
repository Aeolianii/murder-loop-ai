import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import type { DomainEvent } from '../domain/domainEvents';
import {
  advanceWorldTick,
  advanceWorldTickSync,
  createInitialWorldState,
} from './worldSimulator';
import type { NpcAdapter } from './npcTypes';
import {
  applyWorldInputs,
  buildWorldInputsFromDomainEvents,
  buildWorldInputsFromPlayerPlan,
} from './worldInputs';
import { createInformantPoliceCallEvent } from './knowledgeEvents';
import { applyEventEffects } from './worldSimulator';

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

function domainEvent(
  eventType: string,
  subject: string,
  facts: string[] = [],
  payload: Record<string, unknown> = {},
): DomainEvent {
  return {
    id: `domain-${eventType}`,
    kind: 'domain_event',
    source: 'rule',
    createdAt: { run: 1, minute: 23 * 60 },
    eventType,
    authority: 'game',
    subject,
    summary: eventType,
    facts,
    visibility: 'player',
    payload,
  };
}

function testDomainEventsBuildWorldInputsForPhotoShareAndPolice() {
  const world = createInitialWorldState();
  const inputs = buildWorldInputsFromDomainEvents([
    domainEvent('package_photographed', 'package', ['package_photo_exists']),
    domainEvent('photo_sent_to_linyue', 'linyue', ['linyue_has_package_photo']),
    domainEvent('police_alert_raised', 'police', ['police_report_received']),
  ], world);

  assert.deepEqual(inputs.map((input) => input.type), [
    'player_photographed_package',
    'player_sent_photo_to_linyue',
    'player_called_police',
  ]);
}

function testDomainEventsBuildWorldInputsForDoorReportAndChenContact() {
  const world = createInitialWorldState();
  const inputs = buildWorldInputsFromDomainEvents([
    domainEvent('door_activity_reported_to_linyue', 'linyue', ['player_reported_door_activity']),
    domainEvent('player_lied_to_chen', 'chen_huaimin', ['player_lied_to_chen'], { factId: 'package_in_closet', confidence: 0.65 }),
    domainEvent('player_messaged_chen', 'chen_huaimin', ['player_messaged_chen']),
  ], world);

  assert.deepEqual(inputs.map((input) => input.type), [
    'player_reported_door_activity_to_linyue',
    'player_lied_to_chen',
    'player_messaged_chen',
  ]);
  assert.equal(inputs[1].type === 'player_lied_to_chen' ? inputs[1].factId : '', 'package_in_closet');
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
  assert.equal(result.knowledge.chen_huaimin.facts.player_called_police, undefined);
  assert.equal(result.pendingNarration.length, 1);
}

function testInformantEventCanGrantChenPoliceKnowledge() {
  const world = createInitialWorldState();
  const event = createInformantPoliceCallEvent(world);

  world.events.push(event);
  applyEventEffects(world, event);

  assert.equal(world.knowledge.chen_huaimin.facts.player_called_police.source, 'informant');
  assert.equal(world.knowledge.chen_huaimin.facts.player_called_police.confidence, 0.9);
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

function testChinesePackagePhotoTextReachesLinYueWhenSent() {
  const world = createInitialWorldState();
  const inputs = buildWorldInputsFromPlayerPlan(plan([
    action('preserve_evidence', 'package', '把包裹拍照'),
    action('communicate', 'linyue', '把包裹照片发给林越'),
  ]), world);

  const result = applyWorldInputs(world, inputs);

  assert.ok(inputs.some((input) => input.type === 'player_photographed_package'));
  assert.ok(inputs.some((input) => input.type === 'player_sent_photo_to_linyue'));
  assert.equal(result.knowledge.lin_yue.facts.package_photo.source, 'message');
  assert.equal(result.objects.package_photo.flags.sharedWithLinYue, true);
  assert.equal(result.knowledge.chen_huaimin.facts.package_photo, undefined);
}

function testInputBridgeCanDriveNextTickConflict() {
  let world = createInitialWorldState();
  world.characters.chen_huaimin.location = 'corridor_5f';
  world.characters.lin_yue.location = 'corridor_5f';

  world = applyWorldInputs(world, buildWorldInputsFromPlayerPlan(plan([
    action('preserve_evidence', 'package', 'photograph the package'),
    action('communicate', 'linyue', 'send the package photo to Lin Yue'),
  ]), world));

  const result = advanceWorldTickSync(world);

  assert.ok(result.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  assert.ok(result.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(result.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
}

async function testPlayerWorldInputTriggersAffectedNpcPlanningOnce() {
  const plannedNpcIds: string[] = [];
  const adapter: NpcAdapter = {
    processNpc: async ({ npcId }) => {
      plannedNpcIds.push(npcId);
      return { npcId, plan: null };
    },
  };
  let world = createInitialWorldState();
  for (const character of Object.values(world.characters)) {
    character.destination = undefined;
  }
  world.characters.real_police.location = 'lobby';
  world.characters.fake_police.location = 'parking_lot';
  world.characters.chen_huaimin.location = 'room_501';
  world.characters.lin_yue.location = 'lobby';
  world = applyWorldInputs(world, buildWorldInputsFromDomainEvents([
    domainEvent('package_photographed', 'package', ['package_photo_exists']),
    domainEvent('photo_sent_to_linyue', 'linyue', ['linyue_has_package_photo']),
  ], world));

  const first = await advanceWorldTick(world, adapter);
  const second = await advanceWorldTick(first, adapter);

  assert.deepEqual(plannedNpcIds, ['lin_yue']);
  assert.deepEqual(first.affectedCharacters, []);
  assert.deepEqual(second.affectedCharacters, []);
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

function testLegacyPlanBridgeUsesConfirmedDomainEvents() {
  const world = createInitialWorldState();
  const inputs = buildWorldInputsFromPlayerPlan(plan([
    action('preserve_evidence', 'package', '把包裹拍照'),
    action('communicate', 'linyue', '把包裹照片发给林越'),
    action('communicate', 'chen_huaimin', 'reply to Chen'),
  ]), world);

  assert.deepEqual(inputs.map((input) => input.type), [
    'player_photographed_package',
    'player_sent_photo_to_linyue',
    'player_messaged_chen',
  ]);
}

testDomainEventsBuildWorldInputsForPhotoShareAndPolice();
testDomainEventsBuildWorldInputsForDoorReportAndChenContact();
testLegacyPlanBridgeUsesConfirmedDomainEvents();
testPoliceCallWritesReportKnowledge();
testInformantEventCanGrantChenPoliceKnowledge();
testPhotoOnlyReachesLinYueWhenSent();
testChinesePackagePhotoTextReachesLinYueWhenSent();
testInputBridgeCanDriveNextTickConflict();
testLieToChenWritesLowConfidenceKnowledge();
await testPlayerWorldInputTriggersAffectedNpcPlanningOnce();
