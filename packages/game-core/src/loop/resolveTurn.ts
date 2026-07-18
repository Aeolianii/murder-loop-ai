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
import { buildDirectorContext, buildKillerContext, buildNarratorContext, buildParserContext } from '../context/ContextBuilder';
import { advanceAmbientTurn } from '../ambient/advanceAmbientTurn';
import { GameEventBus } from '../events/EventBus';
import { AgentRegistry } from '../events/AgentRegistry';
import { HarnessDispatcher } from '../events/HarnessDispatcher';
import { ParserAgent } from '../agents/ParserAgent';
import { RuleAgent } from '../agents/RuleAgent';
import { KillerAgent } from '../agents/KillerAgent';
import { NarratorAgent } from '../agents/NarratorAgent';
import { DirectorAgent } from '../agents/DirectorAgent';
import { NpcAgent } from '../agents/NpcAgent';
import { UIAdapterAgent } from '../agents/UIAdapterAgent';
import { SidebarAgent } from '../agents/SidebarAgent';
import { recordDeathMemory, recordTurnMemory } from '../memory/loopMemory';
import { clearReviveProtection, hasReviveProtection } from './reviveProtection';
import { resolveStoryNode } from '../storyNodes/resolveStoryNode';
import type { StoryNodeResolution } from '../storyNodes/storyNodeTypes';
import { ensureWorldState } from '../world/syncGameWorld';
import { applyWorldInputs, buildWorldInputsFromPlayerPlan } from '../world/worldInputs';
import { advanceWorldTick } from '../world/worldSimulator';
import type { NpcAdapter } from '../world/npcTypes';
import { calculateTurnTime } from '../rules/applyPlayerActions';

export { GameEventBus, AgentRegistry, HarnessDispatcher };
export { ParserAgent, RuleAgent, KillerAgent, NarratorAgent, DirectorAgent, NpcAgent, UIAdapterAgent, SidebarAgent };

// ============================================================================
// 向后兼容：保留旧的 AiAdapters 接口和 resolveTurn 函数
// ============================================================================

export interface AiAdapters {
  parseAction?: (input: string, state: GameState) => Promise<ActionPlan>;
  chooseKillerStrategy?: (
    state: GameState,
    plan?: ActionPlan,
    playerResult?: TurnResolution['playerResult'],
  ) => Promise<KillerStrategy>;
  narrate?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
  narrateAction?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
  narrateAmbient?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
  reviewNarration?: (input: {
    narration: Narration;
    actionNarration: Narration;
    ambientNarration: Narration;
    state: GameState;
    narrationContext?: NarrationContext;
    playerResult?: TurnResolution['playerResult'];
    killerResult?: TurnResolution['killerResult'];
  }) => Promise<{ score: unknown; passed: boolean; violations: string[]; moodSignal?: string }>;
  npcReply?: (
    speaker: NpcReply['speaker'],
    input: string,
    state: GameState,
  ) => Promise<NpcReply>;
  npcAdapter?: NpcAdapter;
}

export interface HarnessOptions {
  advanceWorldTick?: boolean;
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
    finalState.phase = storyNode.phase;
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

async function applyPlayerPlanToWorldState(
  state: GameState,
  plan: ActionPlan,
  shouldAdvanceWorldTick = false,
  npcAdapter?: NpcAdapter,
): Promise<{ state: GameState; worldTickTrace: WorldEvent[]; interrupted?: WorldEvent }> {
  let world = ensureWorldState(state);
  const inputs = buildWorldInputsFromPlayerPlan(plan, world);
  if (inputs.length > 0) world = applyWorldInputs(world, inputs);
  let worldTickTrace: WorldEvent[] = [];
  let interrupted: WorldEvent | undefined;
  if (shouldAdvanceWorldTick) {
    const totalMinutes = calculateTurnTime(plan.actions);
    for (let i = 0; i < totalMinutes && !interrupted; i++) {
      const beforeCount = world.events.length;
      world = await advanceWorldTick(world, npcAdapter);
      const newEvents = world.events.slice(beforeCount);
      worldTickTrace.push(...newEvents);
      interrupted = newEvents.find((e) => e.type === 'ending' || e.type === 'threat');
    }
  }
  return { state: { ...state, world }, worldTickTrace, interrupted };
}

function consumePendingWorldNarration(state: GameState, confirmedWorldEvents?: WorldEvent[]): GameState {
  if (!state.world || !confirmedWorldEvents?.length || state.world.pendingNarration.length === 0) return state;
  const pendingIds = new Set(state.world.pendingNarration.map((event) => event.id));
  const consumedIds = confirmedWorldEvents
    .map((event) => event.id)
    .filter((id) => pendingIds.has(id));
  if (consumedIds.length === 0) return state;

  const consumedSet = new Set(consumedIds);
  return {
    ...state,
    world: {
      ...state.world,
      pendingNarration: state.world.pendingNarration.filter((event) => !consumedSet.has(event.id)),
      consumedNarrationEventIds: [...new Set([
        ...(state.world.consumedNarrationEventIds ?? []),
        ...consumedIds,
      ])],
    },
  };
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
  npcReply?: NpcReply | null,
): RecommendedAction[] {
  void plan;
  void playerResult;
  const text = [
    killerStrategy.type,
    killerResult.title,
    killerResult.text,
    ...killerResult.events.map((event) => `${event.subject} ${event.summary} ${event.sensoryHints.join(' ')}`),
    npcReply?.riskWarning ?? '',
    npcReply?.suggestedExternalAction ?? '',
  ].join('\n');
  const actions: RecommendedAction[] = [];
  const door = state.room.front_door?.state ?? {};
  const doorSecuredButNotBarricaded = Boolean(door.locked || door.chainLocked) && !door.barricaded;
  const exposedDoorCoordination = killerStrategy.type === 'spare_key_entry'
    || killerStrategy.type === 'fake_police'
    || hasText(text, ['门里有东西挡着', '东西挡着', '进不去', '打不开', '压低声音', '冒充警察', '假警察', 'blocked', 'get in']);

  if (doorSecuredButNotBarricaded && exposedDoorCoordination) {
    actions.push(
      {
        id: 'record_blocked_door_voice',
        label: '录下门外压低声音说“进不去”的原话，别靠近门缝。',
        rationale: '这句话说明门外的人不是正常核验身份，而是在协调进入方式；录音能变成证据。',
        intent: 'record',
        target: 'front_door',
      },
      {
        id: 'bait_hallway_speaker',
        label: '隔门套话：让对方报单位、警号和接警编号，但不要开门。',
        rationale: '真正的身份核验应该经得起复述；对方如果回避或说错，就是新的破绽。',
        intent: 'communicate',
        target: 'chen_huaimin',
      },
    );
  }

  if (state.policePhase !== 'not_contacted' && exposedDoorCoordination) {
    actions.push({
      id: 'report_door_coordination_to_police',
      label: '把“门里有东西挡着，进不去”这句补充给 110 或接线员。',
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

  if (state.linYuePhase === 'received_photo' || state.linYuePhase === 'calling_police') {
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

// ============================================================================
// 新架构：Harness 工厂 + 事件驱动的回合解析
// ============================================================================

/**
 * 回合上下文 — 在事件处理过程中累积中间结果。
 * 每个 Agent 在处理事件时读取/写入此上下文，
 * 替代旧架构中通过函数参数传递的临时变量。
 */
export interface TurnContext {
  /** 玩家原始输入 */
  input: string;
  /** 当前游戏状态（在处理过程中会变化） */
  state: GameState;
  /** 行动解析结果 */
  plan?: ActionPlan;
  /** 玩家行动执行结果 */
  playerResult?: TurnResolution['playerResult'];
  /** 凶手策略 */
  killerStrategy?: KillerStrategy;
  /** 凶手行动执行结果 */
  killerResult?: TurnResolution['killerResult'];
  /** 行动叙事 */
  actionNarration?: Narration;
  /** 环境叙事 */
  ambientNarration?: Narration;
  npcReply?: NpcReply | null;
  /** 叙事上下文 */
  narrationContext?: NarrationContext;
  /** 导演评分结果 */
  directorResult?: { score: unknown; passed: boolean; violations: string[]; moodSignal?: string };
  /** Autonomous World tick events only; player input bridge events are excluded. */
  worldTickTrace?: WorldEvent[];
}

// ============================================================================
// 致命行为检测 & 对话节点复活
// ============================================================================

// Fatal outcomes are resolved by rule execution and reviewed narration proposals, not by intent lookup.

/**
 * 保存对话检查点到 memory，用于死亡后复活到最近对话节点。
 * 只在有 NPC 通信时保存。
 */
function saveConversationCheckpoint(state: GameState): void {
  const lastCommunicate = [...state.log].reverse().find(
    (entry) =>
      entry.channel === 'action' &&
      (entry.text.includes('林越') || entry.text.includes('陈怀民') || entry.text.includes('陌生号码') || entry.text.includes('警察')),
  );
  if (!lastCommunicate) return;

  // 检查是否已保存过同一对话的检查点
  const alreadySaved = state.memory.currentRun.some(
    (m) => m.id === `checkpoint-${lastCommunicate.id}`,
  );
  if (alreadySaved) return;

  state.memory.currentRun.push({
    id: `checkpoint-${lastCommunicate.id}`,
    run: state.run,
    title: '对话节点',
    text: `你在那一刻和外界建立了联系。如果发生意外，这是你最后的锚点。`,
  });
}

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
        const ctx = payload as TurnContext;
        return aiFn(ctx.state, ctx.plan, ctx.playerResult);
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
        const ctx = payload as TurnContext;
        const context = ctx.narrationContext ?? buildNarratorContext({
          state: ctx.state,
          playerResult: ctx.playerResult!,
          killerResult: ctx.killerResult!,
          playerActionSummary: ctx.plan?.summary ?? '',
          playerInput: ctx.input,
        });
        // 并行调用两个叙事 AI，任一个失败即抛错误让 dispatcher fallback
        const [actionNarration, ambientNarration] = await Promise.all([
          actionNarrator
            ? actionNarrator(context, ctx.playerResult!, ctx.killerResult!, ctx.state)
            : (agent.fallback(payload) as Promise<{ actionNarration: Narration; ambientNarration: Narration }>).then(f => f.actionNarration),
          ambientNarrator
            ? ambientNarrator(context, ctx.playerResult!, ctx.killerResult!, ctx.state)
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
          narration: Narration;
          actionNarration: Narration;
          ambientNarration: Narration;
          state: GameState;
          narrationContext?: NarrationContext;
          playerResult?: TurnResolution['playerResult'];
          killerResult?: TurnResolution['killerResult'];
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
        return aiFn(action.target as NpcReply['speaker'], action.raw ?? action.method ?? plan?.raw ?? '', state);
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
      advanceWorldTick: Boolean(options.advanceWorldTick),
      npcAdapter: options.npcAdapter,
    },
  };
}

/**
 * 事件驱动的回合解析 — 新架构入口。
 *
 * 流程：
 * 1. 构建 TurnContext（包含输入和初始状态）
 * 2. 依次发射事件，Agent 通过 EventBus 订阅响应
 * 3. 收集最终状态和诊断信息
 *
 * 与旧 resolveTurn 的接口兼容，返回值结构相同。
 */
export async function resolveTurnHarness(
  state: GameState,
  input: string,
  harness: ReturnType<typeof createHarness>,
): Promise<TurnResolution> {
  const startedWithReviveProtection = hasReviveProtection(state);
  // 构建回合上下文 — 在事件链中共享的可变状态
  const ctx: TurnContext = { input, state: { ...state } };

  // Step 1: 解析行动
  const parserContext = buildParserContext(input, ctx.state);
  const plan = await harness.dispatcher.runCommand('PlayerActionSubmitted', {
    input,
    state: ctx.state,
    traceContext: { worldInfo: parserContext.worldInfo },
  });

  ctx.plan = plan;
  const worldUpdate = await applyPlayerPlanToWorldState(ctx.state, plan, harness.options.advanceWorldTick, harness.options.npcAdapter);
  ctx.state = worldUpdate.state;
  ctx.worldTickTrace = worldUpdate.worldTickTrace;

  const storyNode = resolveStoryNode(ctx.state, plan);
  if (storyNode) {
    const resolution = buildStoryNodeTurnResolution(ctx.state, plan, storyNode);
    if (startedWithReviveProtection) {
      clearReviveProtection(resolution.finalState);
    }
    resolution.worldTickTrace = ctx.worldTickTrace ?? [];
    recordTurnMemory(resolution.finalState, {
      playerInput: ctx.input,
      summary: plan.summary,
      title: storyNode.title,
      text: storyNode.text,
    });
    resolution.finalState.world = ensureWorldState(resolution.finalState);
    await harness.dispatcher.runCommand('TurnCompleted', {
      finalState: resolution.finalState,
      moodSignal: undefined,
    });
    return resolution;
  }

  // Step 1.5: 致命行为检测 — AI 或规则判定危及生命的行为直接死亡
  const fatalResult = null as null | { endingId: import('@murder-loop-ai/shared').EndingId; title: string; text: string };
  if (fatalResult) {
    const deathState = { ...ctx.state };
    deathState.ending = fatalResult.endingId;
    deathState.phase = 'death' as const;
    deathState.log = [
      ...deathState.log,
      {
        id: `death-${Date.now()}`,
        run: deathState.run,
        minute: deathState.minute,
        title: fatalResult.title,
        text: fatalResult.text,
        tone: 'death' as const,
        channel: 'action' as const,
      },
    ];
    // 保存对话检查点到 memory（用于复活）
    saveConversationCheckpoint(deathState);

    return {
      plan,
      playerResult: { title: fatalResult.title, text: fatalResult.text, tone: 'death' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [], state: deathState },
      killerStrategy: { id: 'fatal', type: 'retreat' as const, title: '无', rationale: '玩家已死亡', risk: 'low' as const, visibleToPlayer: false },
      killerResult: { title: '', text: '', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [], state: deathState },
      narration: { title: fatalResult.title, text: fatalResult.text },
      actionNarration: { title: fatalResult.title, text: fatalResult.text },
      ambientNarration: { title: '', text: '' },
      worldTickTrace: ctx.worldTickTrace ?? [],
      finalState: deathState,
    };
  }

  // Step 2: 执行规则
  const playerResult = await harness.dispatcher.runCommand('ActionParsed', {
    plan,
    state: ctx.state,
  });
  ctx.playerResult = playerResult;
  ctx.state = playerResult.state;
  ctx.npcReply = (harness.dispatcher.getLatestArtifact('npc', 'ActionParsed') as NpcReply | null | undefined) ?? null;
  const playerLogId = ctx.state.log[ctx.state.log.length - 1]?.id;

  // Step 3: 凶手策略
  const killerContext = buildKillerContext(ctx.state, { plan, playerResult });
  const killerStrategy = ctx.state.ending
    ? chooseFallbackKillerStrategy(ctx.state)
    : await harness.dispatcher.runCommand('RulesApplied', {
        playerResult,
        state: ctx.state,
        plan,
        traceContext: { worldInfo: killerContext.worldInfo },
      });
  ctx.killerStrategy = killerStrategy;

  // Step 4: 执行凶手策略 + 叙事
  const killerResult = ctx.state.ending
    ? { ...playerResult, text: '', title: '对抗结束', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [] }
    : await harness.dispatcher.runCommand('KillerActed', {
        killerStrategy,
        playerResult,
        state: ctx.state,
      });
  ctx.killerResult = killerResult;
  ctx.state = killerResult.state;
  const killerLogId = ctx.state.ending ? undefined : ctx.state.log[ctx.state.log.length - 1]?.id;

  // Step 5: 叙事生成
  const narrationContext = buildNarratorContext({
    state: ctx.state,
    playerResult,
    killerResult,
    playerActionSummary: plan.summary,
    playerInput: ctx.input,
  });
  ctx.narrationContext = narrationContext;

  const narrationPair = await harness.dispatcher.runCommand('NarrationRequested', {
    plan,
    playerResult,
    killerResult,
    state: ctx.state,
    narrationContext,
  });
  const actionNarration = applyNpcReplyToActionNarration(
    sanitizeNarration(narrationPair.actionNarration),
    ctx.npcReply,
  );
  const ambientNarration = playerResult.state.ending
    ? actionNarration
    : sanitizeNarration(narrationPair.ambientNarration);
  ctx.actionNarration = actionNarration;
  ctx.ambientNarration = ambientNarration;
  ctx.state = consumePendingWorldNarration(ctx.state, narrationContext.confirmedWorldEvents);

  // Step 6: Director review uses the same agent event chain, but it is kept
  // outside the response critical path. Narration proposals are advisory now,
  // so a slow pro-model review should not delay the next playable beat.
  const directorPayload = {
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    state: ctx.state,
    narrationContext,
    playerResult,
    killerResult,
    directorContext: buildDirectorContext({
      state: ctx.state,
      narration: actionNarration,
      actionNarration,
      ambientNarration,
      playerResult,
      killerResult,
      agentTrace: [...harness.dispatcher.getAgentTrace()],
    }),
  };
  const directorResult = {
    score: { pacing: 7, infoLeak: 8, ruleConsistency: 8, prose: 7 },
    passed: true,
    violations: [],
    moodSignal: undefined,
  };
  void harness.dispatcher.runCommand('NarrationDone', directorPayload).catch(() => null);
  ctx.directorResult = directorResult;

  // Step 7: 组装最终状态
  const finalState = { ...ctx.state };
  if (startedWithReviveProtection) {
    clearReviveProtection(finalState);
  }

  replaceLogEntry(finalState, playerLogId, {
    title: actionNarration.title,
    text: actionNarration.text,
    isAiNarration: harness.narrationAiUsage.action,
    channel: 'action',
    tone: playerResult.tone,
  });
  replaceLogEntry(finalState, killerLogId, {
    title: ambientNarration.title,
    text: ambientNarration.text,
    isAiNarration: playerResult.state.ending
      ? harness.narrationAiUsage.action
      : harness.narrationAiUsage.ambient,
    channel: 'ambient',
    tone: killerResult.tone === 'death' ? 'death' : killerResult.tone,
  });

  // Step 8: 完成回合
  recordTurnMemory(finalState, {
    playerInput: ctx.input,
    summary: plan.summary,
    title: actionNarration.title,
    text: actionNarration.text,
  });
  if (finalState.phase === 'death') {
    recordDeathMemory(finalState);
  }
  finalState.world = ensureWorldState(finalState);

  await harness.dispatcher.runCommand('TurnCompleted', {
    finalState,
    moodSignal: directorResult.moodSignal,
  });

  return {
    plan,
    playerResult,
    killerStrategy,
    killerResult,
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    npcReply: ctx.npcReply ?? null,
    recommendedActions: buildRecommendedActionsForTurn(
      finalState,
      plan,
      killerStrategy,
      playerResult,
      killerResult,
      ctx.npcReply,
    ),
    worldTickTrace: ctx.worldTickTrace ?? [],
    finalState,
  };
}

export async function resolveAmbientTurn(
  state: GameState,
  aiAdapters: Omit<AiAdapters, 'parseAction'> = {},
): Promise<AmbientResolution> {
  const startedWithReviveProtection = hasReviveProtection(state);
  const ambientResult = advanceAmbientTurn(state);
  const killerStrategy = ambientResult.state.ending
    ? chooseFallbackKillerStrategy(ambientResult.state)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters
          .chooseKillerStrategy(ambientResult.state)
          .catch(() => chooseFallbackKillerStrategy(ambientResult.state))
      : chooseFallbackKillerStrategy(ambientResult.state);

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
    '我暂时没有采取新行动，时间和环境继续推进',
  );
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawNarration = ambientNarrator
    ? await ambientNarrator(narrationContext, ambientResult, killerResult, killerResult.state).catch(
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

export { rewindAfterDeath } from './rewind';
