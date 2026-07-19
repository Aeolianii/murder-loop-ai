import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { buildPlayerCommandsFromActionPlan } from './playerCommands';
import { isAuthoritativeConcept, isPlayerCommand } from './domainEvents';

function action(
  id: string,
  intent: string,
  target: string,
  raw: string,
  extra: Record<string, unknown> = {},
): ActionPlan['actions'][number] {
  return {
    id,
    intent,
    target,
    raw,
    method: raw,
    confidence: 0.9,
    timeCost: 1,
    noise: 0,
    risk: 'low',
    ...extra,
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

function testBuildsOneCommandPerParsedActionInOrder() {
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-photo-package', 'preserve_evidence', 'package', '把包裹拍照'),
      action('action-send-linyue', 'communicate', 'linyue', '把包裹照片发给林越'),
      action('action-lock-door', 'secure_entry', 'front_door', '然后反锁门'),
    ]),
    { run: 1, minute: 23 * 60 },
  );

  assert.equal(commands.length, 3);
  assert.deepEqual(commands.map((command) => command.commandType), [
    'preserve_evidence',
    'communicate',
    'secure_entry',
  ]);
  assert.deepEqual(commands.map((command) => command.target), [
    'package',
    'linyue',
    'front_door',
  ]);
  assert.ok(commands.every(isPlayerCommand));
  assert.ok(commands.every((command) => !isAuthoritativeConcept(command)));
}

function testCommandCarriesPlanCausationAndActionMetadata() {
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-pick-knife', 'pick_up', 'kitchen_knife', '拿起厨刀', { itemId: 'kitchen_knife' }),
      action('action-attack', 'attack', 'chen_huaimin', '用厨刀攻击陈怀民', {
        weaponId: 'kitchen_knife',
        confidence: 0.7,
        timeCost: 2,
        noise: 5,
        risk: 'high',
      }),
    ]),
    { run: 1, minute: 23 * 60 + 5 },
  );

  assert.equal(commands[0].id, 'cmd-plan-photo-linyue-lock-door-action-pick-knife');
  assert.equal(commands[0].causationId, 'plan-photo-linyue-lock-door');
  assert.equal(commands[0].correlationId, 'plan-photo-linyue-lock-door');
  assert.equal(commands[0].actionId, 'action-pick-knife');
  assert.equal(commands[0].payload?.itemId, 'kitchen_knife');
  assert.equal(commands[1].payload?.weaponId, 'kitchen_knife');
  assert.equal(commands[1].risk, 'high');
  assert.equal(commands[1].timeCost, 2);
  assert.equal(commands[1].noise, 5);
}

function testOpenIntentNamesRemainValidCommands() {
  const commands = buildPlayerCommandsFromActionPlan(
    plan([
      action('action-custom', 'improvise_signal_trap', 'front_door', '用便签和胶带做一个信号陷阱'),
    ]),
    { run: 2, minute: 23 * 60 + 12 },
  );

  assert.equal(commands[0].commandType, 'improvise_signal_trap');
  assert.equal(commands[0].createdAt.run, 2);
  assert.equal(commands[0].createdAt.minute, 23 * 60 + 12);
}

function testEmptyPlanSafelyReturnsNoCommands() {
  const commands = buildPlayerCommandsFromActionPlan({
    ...plan([]),
    id: 'plan-empty',
    actions: [],
  }, { run: 1, minute: 23 * 60 });

  assert.deepEqual(commands, []);
}

testBuildsOneCommandPerParsedActionInOrder();
testCommandCarriesPlanCausationAndActionMetadata();
testOpenIntentNamesRemainValidCommands();
testEmptyPlanSafelyReturnsNoCommands();
