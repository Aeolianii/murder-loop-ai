import assert from 'node:assert/strict';
import { DEADLINE_MINUTE, type ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { createHarness, resolveTurnHarness } from './resolveTurn';

async function testResolveTurnHarnessReturnsTraceAndFinalState() {
  const state = createInitialGameState();
  const harness = createHarness();

  const resolution = await resolveTurnHarness(state, 'check the package', harness);

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.finalState.log.length > state.log.length);
  assert.ok(resolution.actionNarration?.text || resolution.narration.text);
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'PlayerActionSubmitted'));
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'NarrationRequested'));

  const agentTrace = harness.dispatcher.getAgentTrace();
  const parserTrace = agentTrace.find((entry) => entry.agent === 'parser');
  const killerTrace = agentTrace.find((entry) => entry.agent === 'killer');
  const narratorTrace = agentTrace.find((entry) => entry.agent === 'narrator');

  assert.ok(parserTrace?.worldInfo?.some((card) => card.id === 'object.package'));
  assert.ok(killerTrace?.worldInfo && killerTrace.worldInfo.length > 0);
  assert.ok(narratorTrace?.worldInfo?.some((card) => card.id === 'object.package'));
  assert.equal('content' in (parserTrace?.worldInfo?.[0] ?? {}), false);
}

async function testMalformedParserAiOutputFallsBackToValidPlan() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({ wrong: true }) as unknown as ActionPlan,
  });

  const resolution = await resolveTurnHarness(state, 'check the package', harness);
  const parserTrace = harness.dispatcher
    .getTrace()
    .find((entry) => entry.eventType === 'PlayerActionSubmitted');

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.plan.actions.length > 0);
  assert.equal(parserTrace?.source, 'fallback');
  assert.match(parserTrace?.warnings[0] ?? '', /parser.*output violation/i);
}

async function testSelfCareDoesNotTriggerHardcodedDeath() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-self-care',
      raw: 'check my head injury',
      summary: 'Check my head injury',
      actions: [{
        id: 'action-self-care',
        raw: 'check my head injury',
        intent: 'self_care',
        target: 'self',
        method: 'check the injury without taking extra action',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
  });

  const resolution = await resolveTurnHarness(state, 'check my head injury', harness);

  assert.notEqual(resolution.finalState.phase, 'death');
  assert.equal(resolution.finalState.ending, null);
  assert.equal(resolution.plan.actions[0].intent, 'self_care');
}

async function testReviveProtectionBlocksImmediateForcedEntryDeath() {
  const state = createInitialGameState();
  state.reviveProtectionTurns = 1;
  state.threat = 60;

  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-wait',
      raw: 'wait and listen',
      summary: 'Wait and listen',
      actions: [{
        id: 'action-wait',
        raw: 'wait and listen',
        intent: 'wait',
        target: 'self',
        method: 'stay still and listen at the door',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-entry',
      type: 'spare_key_entry',
      title: '钥匙入锁孔',
      rationale: 'Test forced entry after revive',
      visibleToPlayer: true,
      risk: 'high',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'wait and listen', harness);

  assert.notEqual(resolution.finalState.phase, 'death');
  assert.equal(resolution.finalState.ending, null);
  assert.equal(resolution.finalState.reviveProtectionTurns, 0);
  assert.equal(resolution.finalState.room.front_door.state.barricaded, true);
  assert.equal(resolution.finalState.room.window.state.locked, true);
}

async function testReviveProtectionBlocksDeadlineDeathOnFirstTurn() {
  const state = createInitialGameState();
  state.reviveProtectionTurns = 1;
  state.minute = DEADLINE_MINUTE - 1;

  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-hold',
      raw: 'hold still',
      summary: 'Hold still for one beat',
      actions: [{
        id: 'action-hold',
        raw: 'hold still',
        intent: 'wait',
        target: 'self',
        method: 'pause and listen',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-wait',
      type: 'wait_for_fatigue',
      title: '门外沉住气',
      rationale: 'Test deadline pressure after revive',
      visibleToPlayer: true,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'hold still', harness);

  assert.notEqual(resolution.finalState.phase, 'death');
  assert.equal(resolution.finalState.ending, null);
  assert.equal(resolution.finalState.reviveProtectionTurns, 0);
  assert.equal(resolution.finalState.minute, DEADLINE_MINUTE - 1);
  assert.equal(resolution.finalState.room.front_door.state.barricaded, true);
  assert.equal(resolution.finalState.room.window.state.locked, true);
}

async function testParserTimeCostAdvancesOneMinuteForSimpleAction() {
  const state = createInitialGameState();
  const startMinute = state.minute;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-simple',
      raw: '看一眼门锁',
      summary: '快速检查门锁',
      actions: [{
        id: 'action-simple',
        raw: '看一眼门锁',
        intent: 'inspect',
        target: 'front_door',
        method: '快速查看锁芯痕迹',
        confidence: 0.96,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.96,
      warnings: [],
    }),
  });

  const resolution = await resolveTurnHarness(state, '看一眼门锁', harness);

  assert.equal(resolution.playerResult.timePassed, 1);
  assert.equal(resolution.finalState.minute, startMinute + 1);
}

async function testParserTimeCostCanAdvanceUpToFiveMinutes() {
  const state = createInitialGameState();
  const startMinute = state.minute;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-complex',
      raw: '拍照备份再联系林越核实警方',
      summary: '执行一串复杂外联动作',
      actions: [{
        id: 'action-complex',
        raw: '拍照备份再联系林越核实警方',
        intent: 'preserve_evidence',
        target: 'social_media',
        method: '完成拍照、备份和外部留证链路',
        confidence: 0.94,
        timeCost: 5,
        noise: 0,
        risk: 'medium',
      }],
      confidence: 0.94,
      warnings: [],
    }),
  });

  const resolution = await resolveTurnHarness(state, '拍照备份再联系林越核实警方', harness);

  assert.equal(resolution.playerResult.timePassed, 5);
  assert.equal(resolution.finalState.minute, startMinute + 5);
}

await testResolveTurnHarnessReturnsTraceAndFinalState();
await testMalformedParserAiOutputFallsBackToValidPlan();
await testSelfCareDoesNotTriggerHardcodedDeath();
await testReviveProtectionBlocksImmediateForcedEntryDeath();
await testReviveProtectionBlocksDeadlineDeathOnFirstTurn();
await testParserTimeCostAdvancesOneMinuteForSimpleAction();
await testParserTimeCostCanAdvanceUpToFiveMinutes();
