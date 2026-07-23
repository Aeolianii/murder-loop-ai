import type {
  ClueRecord,
  ActionPlan,
  AmbientResolution,
  GameState,
  KillerStrategy,
  Narration,
  NarrationContext,
  NpcReply,
  RecommendedAction,
  TurnResolution,
  WorldEvent,
} from '@murder-loop-ai/shared';
import { createClueFromTemplate } from '@murder-loop-ai/content';
import { chooseFallbackKillerStrategy } from '../killer/fallbackStrategy';
import { applyKillerStrategy } from '../killer/applyKillerStrategy';
import {
  createFallbackAmbientNarration,
  sanitizeNarration,
} from '../narration/fallbackNarration';
import { buildNarrationContext } from '../narration/buildNarrationContext';
import { buildDirectorContext, buildKillerContext, buildNarratorContext, buildNpcVisibleContext, buildParserContext, type DirectorContext, type KillerContext } from '../context/ContextBuilder';
import { advanceAmbientTurn } from '../ambient/advanceAmbientTurn';
import { transitionGamePhaseTo } from '../machines/gamePhaseMachine';
import { GameEventBus } from '../events/EventBus';
import { AgentRegistry } from '../events/AgentRegistry';
import { HarnessDispatcher } from '../events/HarnessDispatcher';
import { ParserAgent } from '../agents/ParserAgent';
import { RuleAgent } from '../agents/RuleAgent';
import { KillerAgent } from '../agents/KillerAgent';
import { NarratorAgent } from '../agents/NarratorAgent';
import { DirectorAgent } from '../agents/DirectorAgent';
import { NpcAgent } from '../agents/NpcAgent';
import { RecommenderAgent } from '../agents/RecommenderAgent';
import { UIAdapterAgent } from '../agents/UIAdapterAgent';
import { SidebarAgent } from '../agents/SidebarAgent';
import { recordDeathMemory, recordTurnMemory } from '../memory/loopMemory';
import { clearReviveProtection, hasReviveProtection } from './reviveProtection';
import { resolveStoryNode } from '../storyNodes/resolveStoryNode';
import type { StoryNodeResolution } from '../storyNodes/storyNodeTypes';
import { ensureWorldState } from '../world/syncGameWorld';
import { applyWorldInputs, buildWorldInputsFromDomainEvents } from '../world/worldInputs';
import { advanceWorldTick } from '../world/worldSimulator';
import type { NpcAdapter } from '../world/npcTypes';
import { calculateTurnTime } from '../rules/applyPlayerActions';
import type { DomainEvent } from '../domain/domainEvents';
import { commitWorldNarrationBatch, readWorldNarrationBatch } from '../world/narrationCursor';
import type { RecommendationContext, RecommendationRequest } from '../recommendations/recommendationTypes';

export { GameEventBus, AgentRegistry, HarnessDispatcher };
export { ParserAgent, RuleAgent, KillerAgent, NarratorAgent, DirectorAgent, NpcAgent, RecommenderAgent, UIAdapterAgent, SidebarAgent };
export type { RecommendationContext, RecommendationRequest };

// ============================================================================
// 向后兼容：保留旧的 AiAdapters 接口和 resolveTurn 函数
// ============================================================================

export interface AiAdapters {
  parseAction?: (input: string, state: GameState) => Promise<ActionPlan>;
  chooseKillerStrategy?: (context: KillerContext) => Promise<KillerStrategy>;
  narrate?: (context: NarrationContext) => Promise<Narration>;
  narrateAction?: (context: NarrationContext) => Promise<Narration>;
  narrateAmbient?: (context: NarrationContext) => Promise<Narration>;
  recommendActions?: (context: RecommendationContext) => Promise<RecommendedAction[]>;
  reviewNarration?: (input: {
    directorContext: DirectorContext;
    narrationContext: NarrationContext;
  }) => Promise<{ score: unknown; passed: boolean; violations: string[] }>;
  npcReply?: (
    speaker: NpcReply['speaker'],
    input: string,
    state: GameState,
  ) => Promise<NpcReply>;
  npcAdapter?: NpcAdapter;
}

export interface HarnessOptions {
  worldTick?: 'enabled' | 'disabled';
  npcAdapter?: NpcAdapter;
}

function replaceLogEntry(
  state: GameState,
  id: string | undefined,
  patch: Partial<GameState['log'][number]>,
) {
  if (!id) return;
  const index = state.log.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  state.log[index] = { ...state.log[index], ...patch };
}

function buildStoryNodeTurnResolution(
  state: GameState,
  plan: ActionPlan,
  storyNode: StoryNodeResolution,
): TurnResolution {
  const finalState = structuredClone(state) as GameState;
  const addedClues: ClueRecord[] = [];

  finalState.minute += storyNode.timePassed;
  finalState.threat = Math.max(0, Math.min(100, finalState.threat + storyNode.threatDelta));
  if (typeof storyNode.stressDelta === 'number') {
    finalState.player.stress = Math.max(0, Math.min(100, finalState.player.stress + storyNode.stressDelta));
  }
  if (storyNode.phase) {
    finalState.phase = transitionGamePhaseTo(finalState.phase, storyNode.phase);
  }
  storyNode.statePatch?.(finalState);

  for (const clueId of storyNode.addedClueIds) {
    if (finalState.clues.some((clue) => clue.id === clueId)) continue;
    const clue = createClueFromTemplate(clueId, finalState.run, finalState.minute);
    if (!clue) continue;
    finalState.clues.push(clue);
    addedClues.push(clue);
  }

  finalState.log = [
    ...finalState.log,
    {
      id: `story-node-${storyNode.storyNodeId}-${finalState.run}-${finalState.minute}-${Math.random().toString(36).slice(2, 8)}`,
      run: finalState.run,
      minute: finalState.minute,
      title: storyNode.title,
      text: storyNode.text,
      tone: storyNode.tone,
      channel: 'action',
      isAiNarration: false,
    },
  ];

  const playerResult = {
    title: storyNode.title,
    text: storyNode.text,
    tone: storyNode.tone,
    addedClues,
    timePassed: storyNode.timePassed,
    threatDelta: storyNode.threatDelta,
    events: [
      {
        kind: 'clue' as const,
        subject: storyNode.storyNodeId,
        summary: `剧情节点命中：${storyNode.title}`,
        sensoryHints: [],
        visibility: 'player' as const,
      },
    ],
    state: finalState,
  };
  const killerStrategy: KillerStrategy = {
    id: `story-node-skip-${storyNode.storyNodeId}`,
    type: 'story_node_skipped',
    title: '剧情节点短路',
    rationale: '规则剧情节点已返回固定文本，本回合跳过 KillerAgent。',
    visibleToPlayer: false,
    risk: 'low',
  };
  const killerResult = {
    title: '',
    text: '',
    tone: 'system' as const,
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const narration = { title: storyNode.title, text: storyNode.text };

  return {
    plan,
    playerResult,
    killerStrategy,
    killerResult,
    narration,
    actionNarration: narration,
    ambientNarration: { title: '', text: '' },
    recommendedActions: storyNode.recommendedActions,
    finalState,
  };
}

async function applyConfirmedPlayerEventsToWorldState(
  beforeState: GameState,
  resolvedState: GameState,
  plan: ActionPlan,
  confirmedEvents: DomainEvent[],
  worldTickEnabled: boolean,
  npcAdapter?: NpcAdapter,
): Promise<{ state: GameState; worldTickTrace: WorldEvent[]; interrupted?: WorldEvent }> {
  let world = ensureWorldState(beforeState);
  const inputs = buildWorldInputsFromDomainEvents(confirmedEvents, world);
  if (inputs.length > 0) world = applyWorldInputs(world, inputs);
  let worldTickTrace: WorldEvent[] = [];
  let interrupted: WorldEvent | undefined;
  if (worldTickEnabled) {
    const totalMinutes = calculateTurnTime(plan.actions);
    for (let i = 0; i < totalMinutes && !interrupted; i++) {
      const beforeCount = world.events.length;
      world = await advanceWorldTick(world, npcAdapter);
      const newEvents = world.events.slice(beforeCount);
      worldTickTrace.push(...newEvents);
      interrupted = newEvents.find((e) => e.type === 'ending' || e.type === 'threat');
    }
  }
  return { state: { ...resolvedState, world }, worldTickTrace, interrupted };
}

function npcReplyTitle(reply: NpcReply) {
  if (reply.speaker === 'linyue') return '林越回复';
  if (reply.speaker === 'police_dispatch') return '接线员回复';
  return '陈怀民回复';
}

function applyNpcReplyToActionNarration(narration: Narration, reply?: NpcReply | null): Narration {
  if (!reply) return narration;
  return {
    ...narration,
    title: npcReplyTitle(reply),
    text: reply.text,
  };
}

function extractConcreteMessageText(context: NarrationContext) {
  const candidates = context.confirmedFacts
    .filter((fact) => fact.origin === 'killer' || fact.origin === 'world')
    .flatMap((fact) => [fact.summary, ...fact.facts]);

  for (const candidate of candidates) {
    const quoted = candidate.match(/[“"]([^”"]+)[”"]/)?.[1]?.trim();
    if (quoted) return candidate;
  }
  return undefined;
}

function narrationMentionsVagueMessage(text: string) {
  return hasText(text, ['陌生号码', '短信', '消息', '手机屏幕', '屏幕亮起'])
    && !/[“"][^”"]+[”"]/.test(text);
}

function ensureNarrationIncludesConcreteVisibleMessage(
  narration: Narration,
  context: NarrationContext,
): Narration {
  const concreteMessage = extractConcreteMessageText(context);
  if (!concreteMessage) return narration;
  const isConfirmedReply = context.confirmedFacts.some(
    (fact) => fact.origin === 'killer' && fact.subject === 'message_reply',
  );
  if (!isConfirmedReply && !narrationMentionsVagueMessage(narration.text)) return narration;
  if (narration.text.includes(concreteMessage)) return narration;
  const quoted = concreteMessage.match(/[“"]([^”"]+)[”"]/)?.[1];
  if (quoted && narration.text.includes(quoted)) return narration;
  return {
    ...narration,
    text: `${narration.text}\n\n${concreteMessage}`,
  };
}

function hasText(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function dedupeRecommendedActions(actions: RecommendedAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  }).slice(0, 3);
}

function buildRecommendedActionsForTurn(
  state: GameState,
  plan: ActionPlan,
  killerStrategy: KillerStrategy,
  playerResult: TurnResolution['playerResult'],
  killerResult: TurnResolution['killerResult'],
): RecommendedAction[] {
  void plan;
  void playerResult;
  const observableThreatText = [
    killerStrategy.visibleToPlayer ? killerStrategy.responseHint ?? '' : '',
    killerResult.title,
    killerResult.text,
    ...killerResult.events.map((event) => `${event.subject} ${event.summary} ${event.sensoryHints.join(' ')}`),
  ].join('\n');
  const actions: RecommendedAction[] = [];
  const door = state.room.front_door?.state ?? {};
  const doorSecuredButNotBarricaded = Boolean(door.locked || door.chainLocked) && !door.barricaded;
  const exposedDoorCoordination = killerStrategy.type === 'spare_key_entry'
    || killerStrategy.type === 'fake_police'
    || hasText(observableThreatText, ['门里有东西挡着', '东西挡着', '进不去', '打不开', '尝试开门', '锁芯', '压低声音', 'blocked', 'get in']);
  const claimedPoliceIdentity = killerStrategy.type === 'fake_police';

  if (doorSecuredButNotBarricaded && exposedDoorCoordination) {
    actions.push({
      id: 'record_blocked_door_voice',
      label: '录下门外试图进门或自报身份的原话，别靠近门缝。',
      rationale: '保留门外实际说法和开门动静，能为后续报警或身份核验提供证据。',
      intent: 'record',
      target: 'front_door',
    });

    if (claimedPoliceIdentity) {
      actions.push({
        id: 'bait_hallway_speaker',
        label: '隔门套话：让对方报单位、警号和接警编号，但不要开门。',
        rationale: '对方已经声称自己是警察，此时才需要核验警务身份，并通过 110 独立确认。',
        intent: 'communicate',
        target: 'front_door',
      });
    } else {
      actions.push({
        id: 'question_hallway_speaker',
        label: '隔门询问对方是谁、来意是什么、为何试图开门，但不要开门。',
        rationale: '门外的人没有声称自己是警察；先核对其实际身份和来意，不套用警号核验。',
        intent: 'communicate',
        target: 'front_door',
      });
    }
  }

  if (state.policePhase !== 'not_contacted' && exposedDoorCoordination) {
    actions.push({
      id: 'report_door_coordination_to_police',
      label: '把门外试图开门和低声交谈的实际情况补充给 110 或接线员。',
      rationale: '这能让警方知道门外的人在尝试进入，而不是正常上门询问。',
      intent: 'verify_identity',
      target: 'police',
    });
  } else if (state.policePhase === 'not_contacted' && exposedDoorCoordination) {
    actions.push({
      id: 'call_police_with_door_coordination',
      label: '报警时直接复述门外原话，说明有人正在尝试进入。',
      rationale: '比单纯说“有人敲门”更具体，能提高事件紧急度。',
      intent: 'call_police',
      target: 'police',
    });
  }

  const linYueVisibleContext = buildNpcVisibleContext(state, 'linyue', plan.raw);
  if (
    (state.linYuePhase === 'received_photo' || state.linYuePhase === 'calling_police')
    && linYueVisibleContext.canReference.doorActivity
  ) {
    actions.push({
      id: 'send_door_quote_to_linyue',
      label: '把门外原话发给林越，让他只在楼下找真正警察，不要上楼。',
      rationale: '林越可以做外部证人，但必须留在安全位置。',
      intent: 'communicate',
      target: 'linyue',
    });
  }

  return dedupeRecommendedActions(actions);
}

function buildRecommendationContext(input: {
  playerInput: string;
  plan: ActionPlan;
  actionNarration: Narration;
  ambientNarration: Narration;
  npcReply: NpcReply | null;
  narrationContext: NarrationContext;
}): RecommendationContext {
  return {
    playerInput: input.playerInput,
    planSummary: input.plan.summary,
    actionNarration: input.actionNarration,
    ambientNarration: input.ambientNarration,
    npcReply: input.npcReply,
    confirmedFacts: input.narrationContext.confirmedFacts,
    confirmedWorldEvents: input.narrationContext.confirmedWorldEvents ?? [],
    visibleState: {
      run: input.narrationContext.run,
      minute: input.narrationContext.minute,
      injury: input.narrationContext.stateSnapshot.injury,
      stress: input.narrationContext.stateSnapshot.stress,
      ending: input.narrationContext.stateSnapshot.ending,
      phoneBattery: input.narrationContext.stateSnapshot.phoneBattery,
      phoneFunctional: input.narrationContext.stateSnapshot.phoneFunctional,
      playerHolding: input.narrationContext.stateSnapshot.playerHolding,
    },
    knownClueTitles: input.narrationContext.knownClueTitles,
  };
}

// ============================================================================
// 新架构：Harness 工厂 + 事件驱动的回合解析
// ============================================================================

/**
 * 创建 Harness 系统（EventBus + AgentRegistry 含所有 Agent）。
 *
 * 用法：
 * ```ts
 * const harness = createHarness();
 *
 * // 注入 AI adapter（可选，不注入则全部使用 fallback）
 * const parser = harness.registry.getAgent('parser');
 * if (parser) { parser.handler = myAiParser; parser.mode = 'ai'; }
 *
 * // 执行回合
 * const result = await resolveTurnHarness(state, input, harness);
 * ```
 */
export function createHarness(aiAdapters?: AiAdapters, options: HarnessOptions = {}) {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  const dispatcher = new HarnessDispatcher(bus, registry);
  const narrationAiUsage = {
    action: Boolean(aiAdapters?.narrateAction ?? aiAdapters?.narrate),
    ambient: Boolean(aiAdapters?.narrateAmbient ?? aiAdapters?.narrate),
  };

  // 注册所有 Agent
  registry.register(ParserAgent);
  registry.register(RuleAgent);
  registry.register(KillerAgent);
  registry.register(NarratorAgent);
  registry.register(DirectorAgent);
  registry.register(NpcAgent);
  registry.register(RecommenderAgent);
  registry.register(UIAdapterAgent);
  registry.register(SidebarAgent);

  // 注入 AI adapter（如果提供）
  // 注意：handler 不吞错误——HarnessDispatcher 负责 AI→fallback 降级和 trace 标记
  if (aiAdapters?.parseAction) {
    const agent = registry.getAgent('parser');
    if (agent) {
      const aiFn = aiAdapters.parseAction;
      agent.handler = async (payload: unknown) => {
        const { input, state } = payload as { input: string; state: GameState };
        // 直接调用 AI，失败时让 HarnessDispatcher 处理 fallback
        return aiFn(input, state);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.chooseKillerStrategy) {
    const agent = registry.getAgent('killer');
    if (agent) {
      const aiFn = aiAdapters.chooseKillerStrategy;
      agent.handler = async (payload: unknown) => {
        const { killerContext } = payload as { killerContext: KillerContext };
        return aiFn(killerContext);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.narrate || aiAdapters?.narrateAction || aiAdapters?.narrateAmbient) {
    const agent = registry.getAgent('narrator');
    if (agent) {
      const actionNarrator = aiAdapters.narrateAction ?? aiAdapters.narrate;
      const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
      agent.handler = async (payload: unknown) => {
        if (!actionNarrator && !ambientNarrator) {
          throw new Error('no narrate adapter provided');
        }
        const { narrationContext: context } = payload as { narrationContext: NarrationContext };
        // 并行调用两个叙事 AI，任一个失败即抛错误让 dispatcher fallback
        const [actionNarration, ambientNarration] = await Promise.all([
          actionNarrator
            ? actionNarrator(context)
            : (agent.fallback(payload) as Promise<{ actionNarration: Narration; ambientNarration: Narration }>).then(f => f.actionNarration),
          ambientNarrator
            ? ambientNarrator(context)
            : (agent.fallback(payload) as Promise<{ actionNarration: Narration; ambientNarration: Narration }>).then(f => f.ambientNarration),
        ]);
        return { actionNarration, ambientNarration };
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.reviewNarration) {
    const agent = registry.getAgent('director');
    if (agent) {
      const aiFn = aiAdapters.reviewNarration;
      agent.handler = async (payload: unknown) => {
        const ctx = payload as {
          directorContext: DirectorContext;
          narrationContext: NarrationContext;
        };
        return aiFn(ctx);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.npcReply) {
    const agent = registry.getAgent('npc');
    if (agent) {
      const aiFn = aiAdapters.npcReply;
      agent.handler = async (payload: unknown) => {
        const { plan, state } = payload as {
          plan?: { raw?: string; actions?: Array<{ intent: string; target?: string; method?: string; raw?: string }> };
          state: GameState;
        };
        const action = plan?.actions?.find((candidate) => candidate.intent === 'communicate');
        if (!action?.target) return null;
        const speaker = action.target as NpcReply['speaker'];
        const input = action.raw ?? action.method ?? plan?.raw ?? '';
        return aiFn(speaker, input, state);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.recommendActions) {
    const agent = registry.getAgent('recommender');
    if (agent) {
      const aiFn = aiAdapters.recommendActions;
      agent.handler = async (payload: unknown) => {
        const { recommendationContext } = payload as RecommendationRequest;
        return aiFn(recommendationContext);
      };
      agent.mode = 'ai';
    }
  }

  return {
    bus,
    registry,
    dispatcher,
    narrationAiUsage,
    options: {
      worldTick: options.worldTick ?? 'enabled',
      npcAdapter: options.npcAdapter ?? aiAdapters?.npcAdapter,
    },
  };
}

/** Strongly typed stage data for the event-driven turn pipeline. */
type HarnessRuntime = ReturnType<typeof createHarness>;

interface ParsedHarnessTurn {
  input: string;
  state: GameState;
  plan: ActionPlan;
  worldTickTrace: WorldEvent[];
  startedWithReviveProtection: boolean;
}

interface ResolvedHarnessTurn extends ParsedHarnessTurn {
  playerResult: TurnResolution['playerResult'];
  killerStrategy: KillerStrategy;
  killerResult: TurnResolution['killerResult'];
  npcReply: NpcReply | null;
  playerLogId?: string;
  killerLogId?: string;
}

interface NarratedHarnessTurn extends ResolvedHarnessTurn {
  narrationContext: NarrationContext;
  actionNarration: Narration;
  ambientNarration: Narration;
}

async function parseHarnessTurn(
  state: GameState,
  input: string,
  harness: HarnessRuntime,
): Promise<ParsedHarnessTurn> {
  const startedWithReviveProtection = hasReviveProtection(state);
  const turnState = { ...state };
  const parserContext = buildParserContext(input, turnState);
  const plan = await harness.dispatcher.runCommand('PlayerActionSubmitted', {
    input,
    state: turnState,
    traceContext: { worldInfo: parserContext.worldInfo },
  });

  return {
    input,
    state: turnState,
    plan,
    worldTickTrace: [],
    startedWithReviveProtection,
  };
}

async function resolveStoryNodeTurn(
  turn: ParsedHarnessTurn,
  harness: HarnessRuntime,
  runTurnCompleted = true,
): Promise<TurnResolution | undefined> {
  const storyNode = resolveStoryNode(turn.state, turn.plan);
  if (!storyNode) return undefined;

  const resolution = buildStoryNodeTurnResolution(turn.state, turn.plan, storyNode);
  if (turn.startedWithReviveProtection) {
    clearReviveProtection(resolution.finalState);
  }
  resolution.worldTickTrace = turn.worldTickTrace;
  recordTurnMemory(resolution.finalState, {
    playerInput: turn.input,
    summary: turn.plan.summary,
    title: storyNode.title,
    text: storyNode.text,
  });
  resolution.finalState.world = ensureWorldState(resolution.finalState);
  const actionNarration = resolution.actionNarration ?? resolution.narration;
  const ambientNarration = resolution.ambientNarration?.text
    ? resolution.ambientNarration
    : actionNarration;
  const narrationContext = buildNarratorContext({
    state: resolution.finalState,
    playerResult: resolution.playerResult,
    killerResult: resolution.killerResult,
  });
  resolution.recommendedActions = await harness.dispatcher.runCommand('RecommendationsRequested', {
    recommendationContext: buildRecommendationContext({
      playerInput: turn.input,
      plan: turn.plan,
      actionNarration,
      ambientNarration,
      npcReply: null,
      narrationContext,
    }),
    fallbackActions: resolution.recommendedActions ?? [],
  });
  if (runTurnCompleted) {
    await harness.dispatcher.runCommand('TurnCompleted', {
      finalState: resolution.finalState,
    });
  }
  return resolution;
}

async function resolveRuleStages(
  turn: ParsedHarnessTurn,
  harness: HarnessRuntime,
  preparedPlayerResult?: TurnResolution['playerResult'] & { domainEvents?: DomainEvent[] },
): Promise<ResolvedHarnessTurn> {
  const playerResult = preparedPlayerResult ?? await harness.dispatcher.runCommand('ActionParsed', {
    plan: turn.plan,
    state: turn.state,
  });
  if (
    preparedPlayerResult?.domainEvents?.some((event) => event.eventType === 'message_delivered')
  ) {
    await harness.dispatcher.runObservers('ActionParsed', {
      plan: turn.plan,
      state: playerResult.state,
    });
  }
  const confirmedEvents = (
    playerResult as TurnResolution['playerResult'] & { domainEvents?: DomainEvent[] }
  ).domainEvents ?? [];
  const worldUpdate = await applyConfirmedPlayerEventsToWorldState(
    turn.state,
    playerResult.state,
    turn.plan,
    confirmedEvents,
    harness.options.worldTick === 'enabled',
    harness.options.npcAdapter,
  );
  const projectedPlayerResult = { ...playerResult, state: worldUpdate.state };
  const npcReply = (
    harness.dispatcher.getLatestArtifact('npc', 'ActionParsed') as NpcReply | null | undefined
  ) ?? null;
  const playerLogId = projectedPlayerResult.state.log[projectedPlayerResult.state.log.length - 1]?.id;
  const killerContext = buildKillerContext(projectedPlayerResult.state, {
    plan: turn.plan,
    playerResult: projectedPlayerResult,
  });
  const killerStrategy = projectedPlayerResult.state.ending
    ? chooseFallbackKillerStrategy(killerContext)
    : await harness.dispatcher.runCommand('RulesApplied', { killerContext });
  const killerResult: TurnResolution['killerResult'] = projectedPlayerResult.state.ending
    ? {
        ...projectedPlayerResult,
        text: '',
        title: '对抗结束',
        tone: 'system',
        addedClues: [],
        timePassed: 0,
        threatDelta: 0,
        events: [],
      }
    : await harness.dispatcher.runCommand('KillerActed', {
        killerStrategy,
        playerResult: projectedPlayerResult,
        state: projectedPlayerResult.state,
      });
  const killerLogId = killerResult.state.ending
    ? undefined
    : killerResult.state.log[killerResult.state.log.length - 1]?.id;

  return {
    ...turn,
    state: killerResult.state,
    worldTickTrace: worldUpdate.worldTickTrace,
    playerResult: projectedPlayerResult,
    killerStrategy,
    killerResult,
    npcReply,
    playerLogId,
    killerLogId,
  };
}

async function renderHarnessTurn(
  turn: ResolvedHarnessTurn,
  harness: HarnessRuntime,
): Promise<NarratedHarnessTurn> {
  const worldNarrationBatch = turn.state.world
    ? readWorldNarrationBatch(turn.state.world)
    : undefined;
  const narrationContext = buildNarratorContext({
    state: turn.state,
    playerResult: turn.playerResult,
    killerResult: turn.killerResult,
    worldEvents: worldNarrationBatch?.events,
  });
  const narrationPair = await harness.dispatcher.runCommand('NarrationRequested', {
    narrationContext,
  });
  const actionNarration = ensureNarrationIncludesConcreteVisibleMessage(
    applyNpcReplyToActionNarration(
      sanitizeNarration(narrationPair.actionNarration),
      turn.npcReply,
    ),
    narrationContext,
  );
  const ambientNarration = turn.playerResult.state.ending
    ? actionNarration
    : ensureNarrationIncludesConcreteVisibleMessage(
        sanitizeNarration(narrationPair.ambientNarration),
        narrationContext,
      );

  return {
    ...turn,
    state: worldNarrationBatch && turn.state.world
      ? {
          ...turn.state,
          world: commitWorldNarrationBatch(turn.state.world, worldNarrationBatch),
        }
      : turn.state,
    narrationContext,
    actionNarration,
    ambientNarration,
  };
}

function dispatchNarrationCritic(
  turn: NarratedHarnessTurn,
  harness: HarnessRuntime,
): void {
  harness.dispatcher.dispatchDeferred('NarrationCritiqueRequested', {
    narrationContext: turn.narrationContext,
    directorContext: buildDirectorContext({
      state: turn.state,
      narration: turn.actionNarration,
      actionNarration: turn.actionNarration,
      ambientNarration: turn.ambientNarration,
      playerResult: turn.playerResult,
      killerResult: turn.killerResult,
      agentTrace: [...harness.dispatcher.getAgentTrace()],
    }),
  });
}

async function finalizeHarnessTurn(
  turn: NarratedHarnessTurn,
  harness: HarnessRuntime,
  runTurnCompleted = true,
): Promise<TurnResolution> {
  const finalState = { ...turn.state };
  if (turn.startedWithReviveProtection) {
    clearReviveProtection(finalState);
  }

  replaceLogEntry(finalState, turn.playerLogId, {
    title: turn.actionNarration.title,
    text: turn.actionNarration.text,
    isAiNarration: harness.narrationAiUsage.action,
    channel: 'action',
    tone: turn.playerResult.tone,
  });
  replaceLogEntry(finalState, turn.killerLogId, {
    title: turn.ambientNarration.title,
    text: turn.ambientNarration.text,
    isAiNarration: turn.playerResult.state.ending
      ? harness.narrationAiUsage.action
      : harness.narrationAiUsage.ambient,
    channel: 'ambient',
    tone: turn.killerResult.tone === 'death' ? 'death' : turn.killerResult.tone,
  });
  recordTurnMemory(finalState, {
    playerInput: turn.input,
    summary: turn.plan.summary,
    title: turn.actionNarration.title,
    text: turn.actionNarration.text,
  });
  if (finalState.phase === 'death') {
    recordDeathMemory(finalState);
  }
  finalState.world = ensureWorldState(finalState);

  const fallbackActions = buildRecommendedActionsForTurn(
    finalState,
    turn.plan,
    turn.killerStrategy,
    turn.playerResult,
    turn.killerResult,
  );
  const recommendedActions = await harness.dispatcher.runCommand('RecommendationsRequested', {
    recommendationContext: buildRecommendationContext({
      playerInput: turn.input,
      plan: turn.plan,
      actionNarration: turn.actionNarration,
      ambientNarration: turn.ambientNarration,
      npcReply: turn.npcReply,
      narrationContext: turn.narrationContext,
    }),
    fallbackActions,
  });

  if (runTurnCompleted) {
    await harness.dispatcher.runCommand('TurnCompleted', { finalState });
  }

  return {
    plan: turn.plan,
    playerResult: turn.playerResult,
    killerStrategy: turn.killerStrategy,
    killerResult: turn.killerResult,
    narration: turn.actionNarration,
    actionNarration: turn.actionNarration,
    ambientNarration: turn.ambientNarration,
    npcReply: turn.npcReply,
    recommendedActions,
    worldTickTrace: turn.worldTickTrace,
    finalState,
  };
}

/**
 * Runs one player turn through the Harness pipeline.
 * Deterministic stages own state changes; AI stages return proposals or render artifacts.
 * Story material cannot short-circuit the player's confirmed action.
 */
export async function resolveTurnHarness(
  state: GameState,
  input: string,
  harness: HarnessRuntime,
): Promise<TurnResolution> {
  const parsedTurn = await parseHarnessTurn(state, input, harness);
  const resolvedTurn = await resolveRuleStages(parsedTurn, harness);
  const narratedTurn = await renderHarnessTurn(resolvedTurn, harness);
  dispatchNarrationCritic(narratedTurn, harness);
  return finalizeHarnessTurn(narratedTurn, harness);
}

/**
 * Rollback adapter for the pre-phase-six turn path.
 * It intentionally preserves StoryNode short-circuit behavior while the phase-six flag is off.
 */
export async function resolveLegacyTurnHarness(
  state: GameState,
  input: string,
  harness: HarnessRuntime,
  options: { deferTurnCompleted?: boolean } = {},
): Promise<TurnResolution> {
  const parsedTurn = await parseHarnessTurn(state, input, harness);
  const storyNodeResolution = await resolveStoryNodeTurn(
    parsedTurn,
    harness,
    !options.deferTurnCompleted,
  );
  if (storyNodeResolution) return storyNodeResolution;

  const resolvedTurn = await resolveRuleStages(parsedTurn, harness);
  const narratedTurn = await renderHarnessTurn(resolvedTurn, harness);
  dispatchNarrationCritic(narratedTurn, harness);
  return finalizeHarnessTurn(narratedTurn, harness, !options.deferTurnCompleted);
}

export interface PreparedPlayerTurnInput {
  state: GameState;
  input: string;
  plan: ActionPlan;
  playerResult: TurnResolution['playerResult'] & { domainEvents?: DomainEvent[] };
}

export async function resolveTurnHarnessFromPreparedPlayerTurn(
  input: PreparedPlayerTurnInput,
  harness: HarnessRuntime,
  options: { deferTurnCompleted?: boolean } = {},
): Promise<TurnResolution> {
  const parsedTurn: ParsedHarnessTurn = {
    input: input.input,
    state: structuredClone(input.state) as GameState,
    plan: structuredClone(input.plan) as ActionPlan,
    worldTickTrace: [],
    startedWithReviveProtection: hasReviveProtection(input.state),
  };
  const preparedPlayerResult = structuredClone(input.playerResult) as PreparedPlayerTurnInput['playerResult'];
  const resolvedTurn = await resolveRuleStages(parsedTurn, harness, preparedPlayerResult);
  const narratedTurn = await renderHarnessTurn(resolvedTurn, harness);
  dispatchNarrationCritic(narratedTurn, harness);
  return finalizeHarnessTurn(narratedTurn, harness, !options.deferTurnCompleted);
}

export async function resolveAmbientTurn(
  state: GameState,
  aiAdapters: Omit<AiAdapters, 'parseAction'> = {},
): Promise<AmbientResolution> {
  const startedWithReviveProtection = hasReviveProtection(state);
  const ambientResult = advanceAmbientTurn(state);
  const killerContext = buildKillerContext(ambientResult.state, { playerResult: ambientResult });
  const killerStrategy = ambientResult.state.ending
    ? chooseFallbackKillerStrategy(killerContext)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters
          .chooseKillerStrategy(killerContext)
          .catch(() => chooseFallbackKillerStrategy(killerContext))
      : chooseFallbackKillerStrategy(killerContext);

  const killerResult = ambientResult.state.ending
    ? {
        ...ambientResult,
        text: '',
        title: '对抗结束',
        tone: 'system' as const,
        addedClues: [],
        timePassed: 0,
        threatDelta: 0,
        events: [],
      }
    : applyKillerStrategy(ambientResult.state, killerStrategy);
  const narrationContext = buildNarrationContext(
    ambientResult,
    killerResult,
  );
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawNarration = ambientNarrator
    ? await ambientNarrator(narrationContext).catch(
        () => createFallbackAmbientNarration(ambientResult, killerResult),
      )
    : createFallbackAmbientNarration(ambientResult, killerResult);
  const narration = sanitizeNarration(rawNarration);

  const finalState = { ...killerResult.state };
  if (startedWithReviveProtection) {
    clearReviveProtection(finalState);
  }
  finalState.log = [
    ...finalState.log,
    {
      id: `ambient-log-${finalState.run}-${finalState.minute}-${Math.random().toString(36).slice(2, 8)}`,
      run: finalState.run,
      minute: finalState.minute,
      title: narration.title,
      text: narration.text,
      tone:
        killerResult.tone === 'death'
          ? 'death'
          : ambientResult.tone === 'threat' || killerResult.tone === 'threat'
            ? 'threat'
            : 'neutral',
      channel: 'ambient',
      isAiNarration: Boolean(ambientNarrator),
    },
  ];
  recordTurnMemory(finalState, {
    summary: 'ambient turn advanced',
    title: narration.title,
    text: narration.text,
  });
  if (finalState.phase === 'death') {
    recordDeathMemory(finalState);
  }

  return { ambientResult, killerStrategy, killerResult, narration, finalState };
}

export { prepareDeathLoopReset, rewindAfterDeath } from './rewind';
