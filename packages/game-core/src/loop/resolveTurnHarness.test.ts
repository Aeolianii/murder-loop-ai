import assert from 'node:assert/strict';
import { DEADLINE_MINUTE, type ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { createHarness, resolveTurnHarness } from './resolveTurn';
import { createInitialWorldState } from '../world/worldSimulator';

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

async function testStoryNodeShortCircuitsAfterParser() {
  const state = createInitialGameState();
  state.phoneBattery = 20;
  state.phoneFunctional = true;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-call',
      raw: '打电话给林越',
      summary: '用手机联系林越',
      actions: [{
        id: 'action-call',
        raw: '打电话给林越',
        intent: 'communicate',
        target: 'phone',
        method: '用手机联系林越',
        confidence: 0.96,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.96,
      warnings: [],
    }),
  });

  const resolution = await resolveTurnHarness(state, '打电话给林越', harness);
  const traceEvents = harness.dispatcher.getTrace().map((entry) => entry.eventType);

  assert.equal(resolution.playerResult.title, '手机快没电了');
  assert.equal(resolution.playerResult.timePassed, 0);
  assert.equal(resolution.finalState.minute, state.minute);
  assert.ok(resolution.finalState.clues.some((clue) => clue.id === 'battery_critical'));
  assert.ok(resolution.recommendedActions?.some((action) => action.label.includes('充电')));
  assert.equal(resolution.finalState.world?.minute, resolution.finalState.minute);
  assert.ok(!traceEvents.includes('ActionParsed'));
  assert.ok(!traceEvents.includes('RulesApplied'));
  assert.ok(!traceEvents.includes('NarrationRequested'));
}

async function testLinYueWarningAfterRetractionReachesPoliceAssistPhase() {
  const state = createInitialGameState();
  state.minute = 23 * 60 + 13;
  state.linYuePhase = 'worried';
  state.room.package.state.photographed = true;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-warn-linyue',
      raw: '追问林越为什么撤回，但让他别上楼，留在楼下报警并备份照片',
      summary: '劝阻林越并让他协助报警',
      actions: [{
        id: 'action-warn-linyue',
        raw: '追问林越为什么撤回，但让他别上楼，留在楼下报警并备份照片',
        intent: 'communicate',
        target: 'linyue',
        method: '追问撤回消息，阻止林越上楼，让他留在楼下报警和备份照片',
        confidence: 0.98,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.98,
      warnings: [],
    }),
  });

  const resolution = await resolveTurnHarness(state, '追问并劝住林越', harness);

  assert.equal(resolution.finalState.linYuePhase, 'calling_police');
  assert.ok(resolution.finalState.clues.some((clue) => clue.id === 'linyue_has_photo'));
  assert.ok(resolution.playerResult.text.includes('不上楼'));
}

async function testResolveTurnHarnessPersistsSyncedWorldState() {
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.events.push({
    id: 'world-history-marker',
    minute: state.world.minute,
    type: 'knowledge',
    actors: ['player'],
    facts: ['history_marker'],
    visibility: 'player',
    effects: [],
  });

  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-secure-door',
      raw: 'secure the front door',
      summary: 'Secure the front door',
      actions: [{
        id: 'action-secure-door',
        raw: 'secure the front door',
        intent: 'secure_entry',
        target: 'front_door',
        method: 'lock and barricade the front door',
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
      title: 'Wait outside',
      rationale: 'Keep the test focused on final world sync',
      visibleToPlayer: false,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'secure the front door', harness);

  assert.ok(resolution.finalState.world);
  assert.equal(resolution.finalState.world.run, resolution.finalState.run);
  assert.equal(resolution.finalState.world.minute, resolution.finalState.minute);
  assert.equal(resolution.finalState.world.threat, resolution.finalState.threat);
  assert.equal(resolution.finalState.world.objects.door_lock.flags.barricaded, true);
  assert.ok(resolution.finalState.world.events.some((event) => event.id === 'world-history-marker'));
  assert.equal(state.world.events.length, 1);
}

async function testResolveTurnHarnessAppliesPlayerWorldInputs() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-share-photo',
      raw: 'photograph the package and send the package photo to Lin Yue',
      summary: 'Photograph the package and send the photo to Lin Yue',
      actions: [
        {
          id: 'action-photo-package',
          raw: 'photograph the package',
          intent: 'preserve_evidence',
          target: 'package',
          method: 'take a clear photo of the package',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
        {
          id: 'action-send-linyue',
          raw: 'send the package photo to Lin Yue',
          intent: 'communicate',
          target: 'linyue',
          method: 'send the package photo to Lin Yue',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
      ],
      confidence: 0.98,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-wait',
      type: 'wait_for_fatigue',
      title: 'Wait outside',
      rationale: 'Keep the test focused on player world inputs',
      visibleToPlayer: false,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'share the package photo with Lin Yue', harness);
  const world = resolution.finalState.world;

  assert.ok(world);
  assert.ok(world.events.some((event) => event.id.startsWith('input.player_photographed_package')));
  assert.ok(world.events.some((event) => event.id.startsWith('input.player_sent_photo_to_linyue')));
  assert.equal(world.objects.package_photo.flags.exists, true);
  assert.equal(world.objects.package_photo.flags.sharedWithLinYue, true);
  assert.equal(world.knowledge.lin_yue.facts.package_photo.source, 'message');
  assert.equal(world.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'), false);
  assert.equal(state.world, undefined);
}

async function testResolveTurnHarnessOptionallyAdvancesWorldTick() {
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  state.world.characters.lin_yue.location = 'corridor_5f';
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-share-photo',
      raw: 'photograph the package and send the package photo to Lin Yue',
      summary: 'Photograph the package and send the photo to Lin Yue',
      actions: [
        {
          id: 'action-photo-package',
          raw: 'photograph the package',
          intent: 'preserve_evidence',
          target: 'package',
          method: 'take a clear photo of the package',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
        {
          id: 'action-send-linyue',
          raw: 'send the package photo to Lin Yue',
          intent: 'communicate',
          target: 'linyue',
          method: 'send the package photo to Lin Yue',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
      ],
      confidence: 0.98,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-wait',
      type: 'wait_for_fatigue',
      title: 'Wait outside',
      rationale: 'Keep the test focused on optional world tick',
      visibleToPlayer: false,
      risk: 'low',
    }),
  }, { advanceWorldTick: true });

  const resolution = await resolveTurnHarness(state, 'share the package photo with Lin Yue', harness);
  const world = resolution.finalState.world;

  assert.ok(world);
  assert.ok(world.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  const tickEventIds = resolution.worldTickTrace?.map((event) => event.id) ?? [];
  assert.ok(tickEventIds.includes('conflict.chen_intercepts_linyue'));
  assert.equal(tickEventIds.some((id) => id.startsWith('input.')), false);
  assert.equal(world.pendingNarration.length, 0);
  assert.ok(world.consumedNarrationEventIds.includes('conflict.chen_intercepts_linyue'));
  assert.ok(world.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(world.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
  assert.notEqual(resolution.finalState.linYuePhase, 'endangered');
  assert.equal(state.world.events.length, 0);
}

await testResolveTurnHarnessReturnsTraceAndFinalState();
await testMalformedParserAiOutputFallsBackToValidPlan();
await testSelfCareDoesNotTriggerHardcodedDeath();
await testReviveProtectionBlocksImmediateForcedEntryDeath();
await testReviveProtectionBlocksDeadlineDeathOnFirstTurn();
await testParserTimeCostAdvancesOneMinuteForSimpleAction();
await testParserTimeCostCanAdvanceUpToFiveMinutes();
await testStoryNodeShortCircuitsAfterParser();
await testLinYueWarningAfterRetractionReachesPoliceAssistPhase();
await testResolveTurnHarnessPersistsSyncedWorldState();
await testResolveTurnHarnessAppliesPlayerWorldInputs();
await testResolveTurnHarnessOptionallyAdvancesWorldTick();
