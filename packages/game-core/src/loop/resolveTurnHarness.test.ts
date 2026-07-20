import assert from 'node:assert/strict';
import type { TurnBrief } from '@murder-loop-ai/ai-contracts';
import { DEADLINE_MINUTE, type ActionPlan, type RecommendedAction } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  createHarness,
  resolveLegacyTurnHarness,
  resolveTurnHarness,
  resolveTurnHarnessFromPreparedPlayerTurn,
} from './resolveTurn';
import { createInitialWorldState } from '../world/worldSimulator';
import { buildKillerContext, buildNpcVisibleContext } from '../context/ContextBuilder';
import type { NpcAdapter } from '../world/npcTypes';
import { prepareLowRiskTurn } from '../takeover/lowRiskTakeover';

function lowRiskBrief(
  operation: string,
  targetIds: string[],
  options: { scope?: string } = {},
): TurnBrief {
  return {
    loopId: 'legacy-run-1',
    turnId: `prepared-${operation}`,
    inputStateVersion: 1,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [{
      actionId: `action-${operation}`,
      actorId: 'player',
      operation,
      targetIds,
      scope: options.scope,
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: operation.length, text: `${operation} ${targetIds.join(' ')}` },
    }],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

async function testPreparedLowRiskPlayerStateContinuesIntoKillerStages() {
  const state = createInitialGameState();
  const prepared = prepareLowRiskTurn({
    state,
    brief: lowRiskBrief('secure_entry', ['front_door', 'chair']),
    sourceProposalId: 'proposal.player.secure-door',
  });
  assert.equal(prepared.status, 'prepared');
  if (prepared.status !== 'prepared') throw new Error('expected prepared turn');
  const harness = createHarness({
    chooseKillerStrategy: async () => ({
      id: 'killer-spare-key-after-takeover',
      type: 'spare_key_entry',
      title: 'Spare key attempt',
      rationale: 'Exercise the physical door state produced by phase 3.',
      visibleToPlayer: true,
      risk: 'high',
    }),
  }, { worldTick: 'disabled' });

  const resolution = await resolveTurnHarnessFromPreparedPlayerTurn({
    state,
    input: 'lock, chain, and barricade the front door',
    plan: prepared.plan,
    playerResult: prepared.playerResult,
  }, harness);

  assert.equal(resolution.finalState.room.front_door.state.locked, true);
  assert.equal(resolution.finalState.room.front_door.state.chainLocked, true);
  assert.equal(resolution.finalState.room.front_door.state.barricaded, true);
  assert.equal(resolution.finalState.ending, null, 'Killer must act against the prepared physical state');
  assert.equal(harness.dispatcher.getTrace().some(
    (entry) => entry.agentId === 'rule' && entry.eventType === 'ActionParsed',
  ), false);
  assert.equal(harness.dispatcher.getTrace().some((entry) => entry.agentId === 'killer'), true);
}

async function testFailedPreparedCommunicationDoesNotTriggerNpcObserver() {
  const state = createInitialGameState();
  state.phoneBattery = 0;
  state.phoneFunctional = false;
  state.room.phone.state.battery = 0;
  const prepared = prepareLowRiskTurn({
    state,
    brief: lowRiskBrief('communicate', ['lin_yue']),
    sourceProposalId: 'proposal.player.failed-message',
  });
  assert.equal(prepared.status, 'prepared');
  if (prepared.status !== 'prepared') throw new Error('expected prepared turn');
  let npcCalls = 0;
  const harness = createHarness({
    npcReply: async () => {
      npcCalls += 1;
      return {
        speaker: 'linyue',
        text: 'This must not be returned for an undelivered message.',
        intent: 'invalid_reply',
        riskWarning: '',
        suggestedExternalAction: '',
      };
    },
  }, { worldTick: 'disabled' });

  const resolution = await resolveTurnHarnessFromPreparedPlayerTurn({
    state,
    input: 'message Lin Yue',
    plan: prepared.plan,
    playerResult: prepared.playerResult,
  }, harness);

  assert.equal(npcCalls, 0);
  assert.equal(resolution.npcReply, null);
  assert.equal(harness.dispatcher.getTrace().some((entry) => entry.agentId === 'npc'), false);
}

async function testResolveTurnHarnessReturnsTraceAndFinalState() {
  const state = createInitialGameState();
  const harness = createHarness();

  const resolution = await resolveTurnHarness(state, 'check the package', harness);

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.finalState.log.length > state.log.length);
  const killerDomainEvents = (resolution.killerResult as typeof resolution.killerResult & {
    domainEvents?: Array<{ eventType: string }>;
  }).domainEvents ?? [];
  assert.ok(killerDomainEvents.some((event) => event.eventType === 'killer_strategy_applied'));
  assert.ok(resolution.actionNarration?.text || resolution.narration.text);
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'PlayerActionSubmitted'));
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'NarrationRequested'));
  assert.deepEqual(
    harness.dispatcher.getTrace()
      .filter((entry) => ['parser', 'rule', 'killer', 'narrator', 'ui-adapter'].includes(entry.agentId))
      .map((entry) => entry.eventType),
    ['PlayerActionSubmitted', 'ActionParsed', 'RulesApplied', 'KillerActed', 'NarrationRequested', 'TurnCompleted'],
  );

  const agentTrace = harness.dispatcher.getAgentTrace();
  const parserTrace = agentTrace.find((entry) => entry.agent === 'parser');
  const killerTrace = agentTrace.find((entry) => entry.agent === 'killer');
  const narratorTrace = agentTrace.find((entry) => entry.agent === 'narrator');

  assert.ok(parserTrace?.worldInfo?.some((card) => card.id === 'object.package'));
  assert.ok(killerTrace?.worldInfo && killerTrace.worldInfo.length > 0);
  assert.ok(narratorTrace);
  assert.equal(narratorTrace.worldInfo, undefined);
  assert.deepEqual(Object.keys(narratorTrace.input as Record<string, unknown>), ['narrationContext']);
  assert.equal('state' in (narratorTrace.input as Record<string, unknown>), false);
  assert.equal('plan' in (narratorTrace.input as Record<string, unknown>), false);
  assert.equal('playerResult' in (narratorTrace.input as Record<string, unknown>), false);
  assert.equal('killerResult' in (narratorTrace.input as Record<string, unknown>), false);
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

async function testStoryNodeShortCircuitIsLegacyOnly() {
  const state = createInitialGameState();
  state.phoneBattery = 20;
  state.phoneFunctional = true;
  const parseAction = async () => ({
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
    });
  const harness = createHarness({ parseAction });

  const resolution = await resolveLegacyTurnHarness(state, '打电话给林越', harness);
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

  const formalHarness = createHarness({ parseAction });
  const formalResolution = await resolveTurnHarness(state, '打电话给林越', formalHarness);
  const formalTraceEvents = formalHarness.dispatcher.getTrace().map((entry) => entry.eventType);
  assert.equal(formalResolution.finalState.minute > state.minute, true);
  assert.equal(
    formalResolution.finalState.clues.some((clue) => clue.id === 'battery_critical'),
    false,
  );
  assert.ok(formalTraceEvents.includes('ActionParsed'));
  assert.ok(formalTraceEvents.includes('RulesApplied'));
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

async function testChinesePhotoShareAndDoorLockFlowKeepsFactsSeparated() {
  const state = createInitialGameState();
  let receivedKillerInput: unknown;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-photo-linyue-lock-door',
      raw: '我把包裹拍照发给林越，然后反锁门。',
      summary: '拍照留证，发给林越，然后反锁门',
      actions: [
        {
          id: 'action-photo-package',
          raw: '把包裹拍照',
          intent: 'preserve_evidence',
          target: 'package',
          method: '拍下包裹和面单',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
        {
          id: 'action-send-linyue',
          raw: '把包裹照片发给林越',
          intent: 'communicate',
          target: 'linyue',
          method: '把刚拍的包裹照片发给林越',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
        {
          id: 'action-lock-door',
          raw: '然后反锁门',
          intent: 'secure_entry',
          target: 'front_door',
          method: '反锁门并扣上门链，不搬家具',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'low',
        },
      ],
      confidence: 0.98,
      warnings: [],
    }),
    chooseKillerStrategy: async (killerContext) => {
      receivedKillerInput = killerContext;
      return ({
      id: 'killer-phone-probe',
      type: 'phone_probe',
      title: '短信试探',
      rationale: '陈怀民只能确认屋内有人警觉，不能直接知道照片发给了林越。',
      responseHint: '陌生号码：“门口那个包裹你拿进去了吗？”',
      visibleToPlayer: true,
      risk: 'medium',
      });
    },
    narrateAction: async () => ({
      title: '证据留在外面',
      text: '你拍下包裹，把照片发给林越，又把门从里面反锁，门链扣回金属槽里。',
    }),
    narrateAmbient: async () => ({
      title: '屏幕亮起',
      text: '陌生号码：“门口那个包裹你拿进去了吗？”',
    }),
  });

  const resolution = await resolveTurnHarness(state, '我把包裹拍照发给林越，然后反锁门。', harness);
  const world = resolution.finalState.world;

  assert.equal(resolution.plan.actions.length, 3);
  assert.deepEqual(resolution.plan.actions.map((action) => action.intent), [
    'preserve_evidence',
    'communicate',
    'secure_entry',
  ]);
  assert.equal(resolution.playerResult.timePassed, 3);
  assert.equal(resolution.finalState.minute, state.minute + 3);
  assert.ok(resolution.finalState.clues.some((clue) => clue.id === 'package_photo'));
  assert.ok(resolution.finalState.clues.some((clue) => clue.id === 'linyue_has_photo'));
  assert.equal(resolution.finalState.room.front_door.state.locked, true);
  assert.equal(resolution.finalState.room.front_door.state.chainLocked, true);
  assert.equal(resolution.finalState.room.front_door.state.barricaded, false);
  assert.ok(world);
  assert.ok(world.events.some((event) => event.id.startsWith('input.player_photographed_package')));
  assert.ok(world.events.some((event) => event.id.startsWith('input.player_sent_photo_to_linyue')));
  assert.equal(world.objects.package_photo.flags.exists, true);
  assert.equal(world.objects.package_photo.flags.sharedWithLinYue, true);
  assert.equal(world.knowledge.lin_yue.facts.package_photo.source, 'message');
  assert.equal(world.knowledge.chen_huaimin.facts.package_photo, undefined);
  assert.equal(world.knowledge.chen_huaimin.facts.linyue_has_package_photo, undefined);

  const killerContext = buildKillerContext(resolution.finalState, {
    plan: resolution.plan,
    playerResult: resolution.playerResult,
  });
  const killerVisibleText = JSON.stringify({
    visibleState: killerContext.visibleState,
    planSummary: killerContext.planSummary,
    observableEvents: killerContext.observableEvents,
  });
  assert.equal(killerContext.visibleState.linYuePhase, 'unknown');
  assert.equal(killerContext.observableEvents.length, 0);
  assert.equal((receivedKillerInput as typeof killerContext).visibleState.linYuePhase, 'unknown');
  assert.equal('state' in (receivedKillerInput as Record<string, unknown>), false);
  assert.equal('plan' in (receivedKillerInput as Record<string, unknown>), false);
  assert.equal('playerResult' in (receivedKillerInput as Record<string, unknown>), false);
  assert.doesNotMatch(killerVisibleText, /linyue_has_package_photo|lin_yue.*package_photo|照片发给林越/);
  assert.doesNotMatch(resolution.actionNarration?.text ?? resolution.narration.text, /死亡|逃脱|警察到了/);
  assert.doesNotMatch(resolution.ambientNarration?.text ?? '', /死亡|逃脱|警察到了/);
}

async function testLinYueMessageReplyStaysInActionNarration() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-ask-linyue-package',
      raw: 'send a package photo to Lin Yue and ask if it is his package',
      summary: 'Send the package photo to Lin Yue and ask whether the package is his',
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
          id: 'action-ask-linyue',
          raw: 'ask Lin Yue if the package is his',
          intent: 'communicate',
          target: 'linyue',
          method: 'send Lin Yue the package photo and ask if it belongs to him',
          confidence: 0.98,
          timeCost: 1,
          noise: 0,
          risk: 'medium',
        },
      ],
      confidence: 0.98,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-wait',
      type: 'wait_for_fatigue',
      title: 'Wait outside',
      rationale: 'Keep the focus on Lin Yue communication.',
      visibleToPlayer: false,
      risk: 'low',
    }),
    narrateAction: async () => ({
      title: 'Chen pressure',
      text: 'Chen Huaimin sends another probing message about the package.',
    }),
    narrateAmbient: async () => ({
      title: 'Hallway',
      text: 'The hallway stays quiet.',
    }),
    npcReply: async () => ({
      speaker: 'linyue',
      text: '这不是我的包裹。你别开门，把照片留好，我在楼下报警。',
      intent: 'deny_package_and_assist',
      riskWarning: '林越已卷入证据链，但不要让他上楼。',
      suggestedExternalAction: '让林越在楼下报警并备份照片。',
    }),
  });

  const resolution = await resolveTurnHarness(state, '拍个照片发给林越，问问包裹是不是他的', harness);

  assert.equal(resolution.npcReply?.speaker, 'linyue');
  assert.match(resolution.actionNarration?.text ?? resolution.narration.text, /林越|Lin Yue|这不是我的包裹/);
  const actionLog = [...resolution.finalState.log].reverse().find((entry) => entry.channel === 'action');
  assert.match(actionLog?.text ?? '', /林越|Lin Yue|这不是我的包裹/);
}

async function testLinYueVisibleContextKeepsPhotoSeparateFromDoorAndPoliceKnowledge() {
  const state = createInitialGameState();
  state.linYuePhase = 'received_photo';
  state.policePhase = 'real_police_en_route';
  state.killerStatus = 'confronting';
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.package.state.photographed = true;

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
          method: 'send only the package photo to Lin Yue and ask whether he recognizes it',
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
      rationale: 'Keep this test focused on Lin Yue knowledge.',
      visibleToPlayer: false,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'share the package photo with Lin Yue', harness);
  const context = buildNpcVisibleContext(resolution.finalState, 'linyue', 'Do you recognize this package?');

  assert.equal(context.canReference.packagePhoto, true);
  assert.equal(context.canReference.doorActivity, false);
  assert.equal(context.canReference.policeReport, false);
  assert.equal(context.canReference.fakePoliceSuspicion, false);
  assert.ok(context.knownFactIds.includes('package_photo'));
  assert.ok(!context.knownFactIds.includes('player_reported_door_activity'));
  assert.equal('policePhase' in (context as unknown as Record<string, unknown>), false);
  assert.equal('room' in (context as unknown as Record<string, unknown>), false);
  assert.equal('killerStatus' in (context as unknown as Record<string, unknown>), false);
}

async function testLinYuePhotoOnlyRecommendationsDoNotMentionDoorQuoteOrPolice() {
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
          method: 'send only the package photo to Lin Yue',
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
      rationale: 'No exposed door coordination in this turn.',
      visibleToPlayer: false,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'share the package photo with Lin Yue', harness);
  const labels = resolution.recommendedActions?.map((action) => action.id + ' ' + action.label).join('\n') ?? '';

  assert.equal(labels.includes('send_door_quote_to_linyue'), false);
  assert.doesNotMatch(labels, /door quote|police|110|门外|原话|报警|警察/);
}

async function testDoorCoordinationCreatesPlayableNextSteps() {
  const state = createInitialGameState();
  state.policePhase = 'dispatch_pending';
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = false;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-wait-behind-door',
      raw: 'stay quiet and listen behind the locked door',
      summary: 'Stay quiet and listen behind the locked door',
      actions: [{
        id: 'action-wait',
        raw: 'stay quiet and listen behind the locked door',
        intent: 'wait',
        target: 'self',
        method: 'listen without approaching the door gap',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-spare-key-blocked',
      type: 'spare_key_entry',
      title: 'Door entry fails',
      rationale: 'The locked door blocks a quiet entry attempt.',
      responseHint: 'A low voice outside says, "Something inside is stopping the door. We cannot get in."',
      visibleToPlayer: true,
      risk: 'medium',
    }),
    narrateAction: async () => ({
      title: 'Hold position',
      text: 'You keep the door locked and stay away from the gap.',
    }),
    narrateAmbient: async () => ({
      title: 'Door held',
      text: 'A low voice outside says, "Something inside is stopping the door. We cannot get in."',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'listen without opening the locked door', harness);
  const labels = resolution.recommendedActions?.map((action) => action.label).join('\n') ?? '';

  assert.match(labels, /录下|录音/);
  assert.match(labels, /身份|姓名|来意/);
  assert.doesNotMatch(labels, /警号|接警编号/);
  assert.match(labels, /110|接线员/);
}

async function testFakePoliceClaimCreatesCredentialCheck() {
  const state = createInitialGameState();
  state.policePhase = 'dispatch_pending';
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = false;
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-wait-behind-door',
      raw: 'stay quiet and listen behind the locked door',
      summary: 'Stay quiet and listen behind the locked door',
      actions: [{
        id: 'action-wait',
        raw: 'stay quiet and listen behind the locked door',
        intent: 'wait',
        target: 'self',
        method: 'listen without approaching the door gap',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-fake-police',
      type: 'fake_police',
      title: 'Police identity claim',
      rationale: 'The person outside claims to be a police officer.',
      responseHint: '门外的人自称警察，要求玩家立刻开门配合调查。',
      visibleToPlayer: true,
      risk: 'high',
    }),
    narrateAction: async () => ({
      title: 'Hold position',
      text: 'You keep the door locked and stay away from the gap.',
    }),
    narrateAmbient: async () => ({
      title: 'Claim outside',
      text: '门外的人说：“我们是警察，开门配合调查。”',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'listen without opening the locked door', harness);
  const labels = resolution.recommendedActions?.map((action) => action.label).join('\n') ?? '';

  assert.match(labels, /警号|接警编号/);
}

async function testRecommendationAgentOutputTakesPriorityOverFallback() {
  const state = createInitialGameState();
  state.policePhase = 'dispatch_pending';
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = false;
  const agentActions: RecommendedAction[] = [{
    id: 'agent-ask-door-intent',
    label: '隔着门问清对方是谁、为何拿钥匙开门，并保持门锁关闭。',
    rationale: '门外的人只表现出试门行为，没有声称警察身份。',
    intent: 'communicate',
    target: 'front_door',
  }];
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-listen',
      raw: '悄悄把门锁上并听门外动静',
      summary: '锁门后倾听门外动静',
      actions: [{
        id: 'action-listen',
        raw: '悄悄把门锁上并听门外动静',
        intent: 'wait',
        target: 'self',
        method: '保持安静并倾听',
        confidence: 0.98,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.98,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-spare-key',
      type: 'spare_key_entry',
      title: '钥匙试门',
      rationale: '门外的人尝试用钥匙开门。',
      responseHint: '门外传来钥匙试探锁孔的声音。',
      visibleToPlayer: true,
      risk: 'medium',
    }),
    narrateAction: async () => ({ title: '门已锁好', text: '你锁好门，退到门侧。' }),
    narrateAmbient: async () => ({ title: '门外动静', text: '门外有人试了试钥匙，随后低声讨论锁芯。' }),
    recommendActions: async (context) => {
      assert.equal(context.planSummary, '锁门后倾听门外动静');
      assert.match(context.ambientNarration.text, /钥匙|锁芯/);
      assert.equal('killerStrategy' in context, false);
      assert.equal('killerPhase' in context.visibleState, false);
      return agentActions;
    },
  });

  const resolution = await resolveTurnHarness(state, '悄悄把门锁上并听门外动静', harness);

  assert.deepEqual(resolution.recommendedActions, agentActions);
  assert.doesNotMatch(resolution.recommendedActions?.map((action) => action.label).join('\n') ?? '', /警号|接警编号/);
  assert.equal(
    harness.dispatcher.getTrace().find((entry) => entry.agentId === 'recommender')?.source,
    'ai',
  );
}

async function testInvalidRecommendationAgentOutputFallsBack() {
  const state = createInitialGameState();
  const harness = createHarness({
    recommendActions: async () => ([{ id: 'invalid-agent-action' }] as unknown as RecommendedAction[]),
  });

  const resolution = await resolveTurnHarness(state, '等待一分钟', harness);
  const recommendationTrace = harness.dispatcher.getTrace().find((entry) => entry.agentId === 'recommender');

  assert.equal(recommendationTrace?.source, 'fallback');
  assert.ok((recommendationTrace?.warnings.length ?? 0) > 0);
  assert.equal(resolution.recommendedActions?.some((action) => action.id === 'invalid-agent-action'), false);
}

async function testMessageReplyAmbientNarrationIncludesConcreteMessageText() {
  const state = createInitialGameState();
  const responseHint = '陌生号码回：“哪个包裹？你先别动，我上来确认一下。”';
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-answer-chen',
      raw: 'reply to Chen and ask what package he means',
      summary: 'Reply to Chen Huaimin',
      actions: [{
        id: 'action-message-chen',
        raw: 'reply to Chen and ask what package he means',
        intent: 'communicate',
        target: 'chen_huaimin',
        method: 'send a message asking what package he means',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-message-reply',
      type: 'message_reply',
      title: 'Message reply',
      rationale: 'The killer replies to the player message.',
      responseHint,
      visibleToPlayer: true,
      risk: 'medium',
    }),
    narrateAction: async () => ({
      title: 'Message sent',
      text: 'You send the question and wait.',
    }),
    narrateAmbient: async () => ({
      title: 'Phone screen',
      text: 'The phone screen lights up. Chen Huaimin has replied, but the room stays quiet.',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'reply to Chen and ask what package he means', harness);

  assert.match(resolution.ambientNarration?.text ?? '', /哪个包裹/);
  assert.match(resolution.ambientNarration?.text ?? '', /你先别动/);
}

async function testNpcAgentReplyTakesPriorityOverPackageHandoffFallback() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-handoff-package',
      raw: '开门把包裹给房东',
      summary: '开门，把包裹交给门外自称房东的人',
      actions: [
        {
          id: 'action-open-door',
          raw: '开门',
          intent: 'open_door',
          target: 'front_door',
          method: '打开房门',
          confidence: 0.98,
          timeCost: 1,
          noise: 1,
          risk: 'high',
        },
        {
          id: 'action-handoff-package',
          raw: '把包裹给房东',
          intent: 'communicate',
          target: 'chen_huaimin',
          method: '把包裹交给门外自称房东的人',
          confidence: 0.96,
          timeCost: 1,
          noise: 1,
          risk: 'high',
        },
      ],
      confidence: 0.96,
      warnings: [],
    }),
    npcReply: async () => ({
      speaker: 'chen_huaimin',
      text: '“行，放在门口。我自己拿。”',
      intent: 'accept_package_on_agent_terms',
      riskWarning: '这是 NPC Agent 根据当前上下文生成的回复。',
      suggestedExternalAction: '与门口保持距离。',
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-retreat-after-handoff',
      type: 'retreat',
      title: '拿到包裹',
      rationale: '陈怀民的首要目标是收回包裹。',
      visibleToPlayer: true,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, '开门把包裹给房东', harness);

  assert.equal(resolution.npcReply?.speaker, 'chen_huaimin');
  assert.equal(resolution.npcReply?.text, '“行，放在门口。我自己拿。”');
  assert.equal(resolution.npcReply?.intent, 'accept_package_on_agent_terms');
  assert.match(resolution.actionNarration?.text ?? '', /放在门口/);
}

async function testVagueActionNarrationIncludesConcretePhoneProbeText() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({
      id: 'plan-lock-door',
      raw: 'quietly lock the door',
      summary: 'Quietly lock the door',
      actions: [{
        id: 'action-lock-door',
        raw: 'quietly lock the door',
        intent: 'secure_entry',
        target: 'front_door',
        method: 'quietly lock the front door',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 0.95,
      warnings: [],
    }),
    chooseKillerStrategy: async () => ({
      id: 'killer-phone-probe',
      type: 'phone_probe',
      title: 'Phone probe',
      rationale: 'The killer tests whether the player noticed the package.',
      responseHint: '陌生号码：“门口那个包裹你拿进去了吗？”',
      visibleToPlayer: true,
      risk: 'medium',
    }),
    narrateAction: async () => ({
      title: 'Door locked',
      text: '门已锁好。你退后半步，手机屏幕还亮着，一条陌生号码的信息停在屏幕上。',
    }),
    narrateAmbient: async () => ({
      title: 'Hallway',
      text: '楼道里传来两个不同的脚步声。',
    }),
  });

  const resolution = await resolveTurnHarness(state, '悄悄把门锁上', harness);

  assert.match(resolution.actionNarration?.text ?? '', /门口那个包裹你拿进去了吗/);
}

async function testResolveTurnHarnessAdvancesWorldTickByDefault() {
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
      rationale: 'Keep the test focused on the product world tick',
      visibleToPlayer: false,
      risk: 'low',
    }),
  });

  const resolution = await resolveTurnHarness(state, 'share the package photo with Lin Yue', harness);
  const world = resolution.finalState.world;

  assert.ok(world);
  assert.ok(world.events.some((event) => event.id === 'conflict.chen_intercepts_linyue'));
  const tickEventIds = resolution.worldTickTrace?.map((event) => event.id) ?? [];
  assert.ok(tickEventIds.includes('conflict.chen_intercepts_linyue'));
  assert.equal(tickEventIds.some((id) => id.startsWith('input.')), false);
  assert.equal(world.pendingNarration.length, 0);
  assert.ok(world.consumedNarrationEventIds.includes('conflict.chen_intercepts_linyue'));
  assert.equal(world.narrationCursor, world.events.length);
  assert.ok(world.characters.lin_yue.goalStack.includes('preserve_photo'));
  assert.ok(world.characters.chen_huaimin.goalStack.includes('suppress_lin_yue'));
  assert.notEqual(resolution.finalState.linYuePhase, 'endangered');
  assert.equal(state.world.events.length, 0);
}

async function testResolveTurnHarnessCanDisableWorldTickForControlledRuns() {
  const state = createInitialGameState();
  const harness = createHarness(undefined, { worldTick: 'disabled' });

  const resolution = await resolveTurnHarness(state, '检查门锁', harness);

  assert.deepEqual(resolution.worldTickTrace, []);
}

async function testHarnessUsesAiNpcAdapterForProductWorldTick() {
  const plannedNpcIds: string[] = [];
  const npcAdapter: NpcAdapter = {
    processNpc: async ({ npcId }) => {
      plannedNpcIds.push(npcId);
      return { npcId, plan: null };
    },
  };
  const state = createInitialGameState();
  state.room.package.state.photographed = true;
  state.evidencePhase = 'package_photographed';
  state.world = createInitialWorldState();
  for (const character of Object.values(state.world.characters)) {
    character.destination = undefined;
  }
  state.world.characters.real_police.location = 'lobby';
  state.world.characters.fake_police.location = 'parking_lot';
  state.world.characters.chen_huaimin.location = 'room_501';
  state.world.characters.lin_yue.location = 'lobby';
  const harness = createHarness({
    npcAdapter,
    parseAction: async () => ({
      id: 'plan-send-photo-to-linyue',
      raw: '把包裹照片发给林越',
      summary: '把包裹照片发给林越',
      actions: [{
        id: 'action-send-photo-to-linyue',
        raw: '把包裹照片发给林越',
        intent: 'communicate',
        target: 'linyue',
        method: '把包裹照片发给林越',
        confidence: 1,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      }],
      confidence: 1,
      warnings: [],
    }),
  });

  assert.equal(harness.options.npcAdapter, npcAdapter);
  assert.equal(harness.options.worldTick, 'enabled');

  const resolution = await resolveTurnHarness(state, '把包裹照片发给林越', harness);

  assert.deepEqual(plannedNpcIds, ['lin_yue']);
  assert.deepEqual(resolution.finalState.world?.affectedCharacters, []);
}

async function testDirectorRunsAsDeferredCriticOutsideTurnPath() {
  const state = createInitialGameState();
  let criticStarted = false;
  let releaseCritic!: () => void;
  const criticGate = new Promise<void>((resolve) => {
    releaseCritic = resolve;
  });
  const harness = createHarness({
    reviewNarration: async (input) => {
      criticStarted = true;
      assert.deepEqual(Object.keys(input).sort(), ['directorContext', 'narrationContext']);
      assert.equal(Object.isFrozen(input), true);
      assert.equal(Object.isFrozen(input.directorContext), true);
      await criticGate;
      return {
        score: { pacing: 8, infoLeak: 9, ruleConsistency: 9, prose: 8 },
        passed: true,
        violations: [],
      };
    },
  });
  const subscriptions = harness.registry.getAgentsForEvent('NarrationCritiqueRequested');
  assert.equal(subscriptions.some((subscription) => subscription.role === 'primary'), false);
  assert.equal(subscriptions[0]?.role, 'reviewer');
  assert.equal(subscriptions[0]?.defer, true);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const resolution = await Promise.race([
    resolveTurnHarness(state, '检查门锁', harness),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('turn waited for deferred critic')), 1_000);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  assert.equal(criticStarted, true);
  assert.ok(resolution.finalState);
  assert.equal(harness.dispatcher.getLatestArtifact('director', 'NarrationCritiqueRequested'), undefined);

  releaseCritic();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    harness.dispatcher.getLatestArtifact('director', 'NarrationCritiqueRequested'),
    {
      score: { pacing: 8, infoLeak: 9, ruleConsistency: 9, prose: 8 },
      passed: true,
      violations: [],
    },
  );
}

await testResolveTurnHarnessReturnsTraceAndFinalState();
await testPreparedLowRiskPlayerStateContinuesIntoKillerStages();
await testFailedPreparedCommunicationDoesNotTriggerNpcObserver();
await testMalformedParserAiOutputFallsBackToValidPlan();
await testSelfCareDoesNotTriggerHardcodedDeath();
await testReviveProtectionBlocksImmediateForcedEntryDeath();
await testReviveProtectionBlocksDeadlineDeathOnFirstTurn();
await testParserTimeCostAdvancesOneMinuteForSimpleAction();
await testParserTimeCostCanAdvanceUpToFiveMinutes();
await testStoryNodeShortCircuitIsLegacyOnly();
await testLinYueWarningAfterRetractionReachesPoliceAssistPhase();
await testResolveTurnHarnessPersistsSyncedWorldState();
await testResolveTurnHarnessAppliesPlayerWorldInputs();
await testChinesePhotoShareAndDoorLockFlowKeepsFactsSeparated();
await testLinYueMessageReplyStaysInActionNarration();
await testLinYueVisibleContextKeepsPhotoSeparateFromDoorAndPoliceKnowledge();
await testLinYuePhotoOnlyRecommendationsDoNotMentionDoorQuoteOrPolice();
await testDoorCoordinationCreatesPlayableNextSteps();
await testFakePoliceClaimCreatesCredentialCheck();
await testRecommendationAgentOutputTakesPriorityOverFallback();
await testInvalidRecommendationAgentOutputFallsBack();
await testMessageReplyAmbientNarrationIncludesConcreteMessageText();
await testNpcAgentReplyTakesPriorityOverPackageHandoffFallback();
await testVagueActionNarrationIncludesConcretePhoneProbeText();
await testResolveTurnHarnessAdvancesWorldTickByDefault();
await testResolveTurnHarnessCanDisableWorldTickForControlledRuns();
await testHarnessUsesAiNpcAdapterForProductWorldTick();
await testDirectorRunsAsDeferredCriticOutsideTurnPath();
