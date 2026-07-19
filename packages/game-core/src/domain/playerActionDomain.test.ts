import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { buildPlayerCommandsFromActionPlan } from './playerCommands';
import {
  applyPlayerDomainEventsToState,
  evaluatePlayerCommandDomainEvents,
} from './playerActionDomain';
import type { ActionPlan } from '@murder-loop-ai/shared';

function action(
  id: string,
  intent: string,
  target: string,
  raw: string,
): ActionPlan['actions'][number] {
  return {
    id,
    intent,
    target,
    raw,
    method: raw,
    confidence: 0.95,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  };
}

function plan(actions: ActionPlan['actions']): ActionPlan {
  return {
    id: 'plan-photo-linyue-lock-door',
    raw: '我把包裹拍照发给林越，然后反锁门。',
    summary: '拍照留证，发给林越，然后反锁门',
    actions,
    confidence: 0.95,
    warnings: [],
  };
}

function testEvaluatesCommandsIntoAuthoritativeDomainEvents() {
  const state = createInitialGameState();
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-photo-package', 'preserve_evidence', 'package', '把包裹拍照'),
      action('action-send-linyue', 'communicate', 'linyue', '把包裹照片发给林越'),
      action('action-lock-door', 'secure_entry', 'front_door', '然后反锁门'),
    ]),
    { run: state.run, minute: state.minute },
  );

  const events = evaluatePlayerCommandDomainEvents(state, commands);

  assert.deepEqual(events.map((event) => event.eventType), [
    'package_photographed',
    'photo_sent_to_linyue',
    'front_door_secured',
  ]);
  assert.ok(events.every((event) => event.kind === 'domain_event'));
  assert.ok(events.every((event) => event.authority === 'game'));
  assert.ok(events.every((event) => event.correlationId === 'plan-photo-linyue-lock-door'));
}

function testAppliesCoreDomainEventsToGameState() {
  const state = createInitialGameState();
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-photo-package', 'preserve_evidence', 'package', '把包裹拍照'),
      action('action-send-linyue', 'communicate', 'linyue', '把包裹照片发给林越'),
      action('action-lock-door', 'secure_entry', 'front_door', '然后反锁门'),
    ]),
    { run: state.run, minute: state.minute },
  );
  const events = evaluatePlayerCommandDomainEvents(state, commands);
  const addedClues: NonNullable<Parameters<typeof applyPlayerDomainEventsToState>[2]>['addedClues'] = [];

  applyPlayerDomainEventsToState(state, events, { addedClues });

  assert.equal(state.room.package.state.photographed, true);
  assert.equal(state.evidencePhase, 'evidence_shared');
  assert.equal(state.linYuePhase, 'received_photo');
  assert.equal(state.room.front_door.state.locked, true);
  assert.equal(state.room.front_door.state.chainLocked, true);
  assert.equal(state.room.front_door.state.barricaded, false);
  assert.ok(state.clues.some((clue) => clue.id === 'package_photo'));
  assert.ok(state.clues.some((clue) => clue.id === 'linyue_has_photo'));
  assert.deepEqual(addedClues.map((clue) => clue.id), ['package_photo', 'linyue_has_photo']);
}

function testDomainReducerDoesNotLeakPhotoShareToKillerKnowledge() {
  const state = createInitialGameState();
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-photo-package', 'preserve_evidence', 'package', '把包裹拍照'),
      action('action-send-linyue', 'communicate', 'linyue', '把包裹照片发给林越'),
    ]),
    { run: state.run, minute: state.minute },
  );

  applyPlayerDomainEventsToState(state, evaluatePlayerCommandDomainEvents(state, commands));

  assert.equal(state.killerKnowledge.knowsPlayerPhotographedPackage, false);
  assert.equal(state.killerKnowledge.knowsPlayerContactedLinYue, false);
}

function testDoorReportToLinYueUsesTheMessageReducer() {
  const state = createInitialGameState();
  const commands = buildPlayerCommandsFromActionPlan(
    plan([action('report-door', 'communicate', 'linyue', '门外有人敲门，我把原话发给林越')]),
    { run: state.run, minute: state.minute },
  );
  const events = evaluatePlayerCommandDomainEvents(state, commands);

  assert.equal(events[0]?.eventType, 'door_activity_reported_to_linyue');

  applyPlayerDomainEventsToState(state, events);

  assert.equal(state.linYuePhase, 'worried');
  assert.equal(state.clues.some((clue) => clue.id === 'linyue_has_photo'), false);
}

function testAllStatefulPlayerCommandsReduceThroughDomainEvents() {
  const state = createInitialGameState();
  state.player.stress = 30;
  state.player.injury = 'bleeding';
  const actions = [
    action('inspect-package', 'inspect', 'package', '检查包裹'),
    action('record-phone', 'record', 'phone', '打开录音'),
    action('mute-phone', 'secure_entry', 'phone', '手机静音并调暗亮度'),
    action('hide-package', 'hide_evidence', 'bathroom', '把包裹藏进卫生间'),
    action('open-door', 'open_door', 'front_door', '打开门'),
    action('self-care', 'self_care', 'self', '处理伤口'),
    { ...action('pick-aid', 'pick_up', 'first_aid_kit', '拿起急救包'), itemId: 'first_aid_kit' },
    { ...action('use-aid', 'use_item', 'first_aid_kit', '使用急救包'), itemId: 'first_aid_kit' },
  ];
  const commands = buildPlayerCommandsFromActionPlan(plan(actions), {
    run: state.run,
    minute: state.minute,
  });
  const events = evaluatePlayerCommandDomainEvents(state, commands);

  assert.deepEqual(events.map((event) => event.eventType), [
    'inspection_completed',
    'recording_started',
    'phone_secured',
    'evidence_hidden',
    'front_door_opened',
    'self_care_completed',
    'item_picked_up',
    'item_used',
  ]);

  applyPlayerDomainEventsToState(state, events);

  assert.equal(state.room.package.inspected, true);
  assert.equal(state.room.package.state.opened, true);
  assert.equal(state.room.phone.state.recording, true);
  assert.equal(state.room.phone.state.muted, true);
  assert.equal(state.room.phone.state.dimmed, true);
  assert.equal(state.room.package.state.hiddenAt, 'bathroom');
  assert.equal(state.room.front_door.state.opened, true);
  assert.equal(state.room.front_door.state.chainLocked, false);
  assert.equal(state.playerHolding, 'first_aid_kit');
  assert.equal(state.player.injury, 'minor');
  assert.ok(state.clues.some((clue) => clue.id === 'wrong_package'));
  assert.ok(state.clues.some((clue) => clue.id === 'recording_pressure'));
  assert.ok(state.clues.some((clue) => clue.id === 'weapon_found'));
}

function testCombatReducerRejectsUnavailableWeaponWithoutMutatingPlan() {
  const state = createInitialGameState();
  const attack = {
    ...action('attack-knife', 'attack', 'chen_huaimin', '用刀攻击陈怀民'),
    weaponId: 'knife',
  };
  const commands = buildPlayerCommandsFromActionPlan(plan([attack]), {
    run: state.run,
    minute: state.minute,
  });

  applyPlayerDomainEventsToState(state, evaluatePlayerCommandDomainEvents(state, commands));

  assert.equal(state.combatTriggered, false);
  assert.equal(state.playerHolding, null);
  assert.equal('weaponNotFound' in attack, false);
}

testEvaluatesCommandsIntoAuthoritativeDomainEvents();
testAppliesCoreDomainEventsToGameState();
testDomainReducerDoesNotLeakPhotoShareToKillerKnowledge();
testDoorReportToLinYueUsesTheMessageReducer();
testAllStatefulPlayerCommandsReduceThroughDomainEvents();
testCombatReducerRejectsUnavailableWeaponWithoutMutatingPlan();
