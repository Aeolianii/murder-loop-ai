import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema, KillerStrategySchema, NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { clueBook } from '@murder-loop-ai/content';
import { buildParserContext, chooseFallbackKillerStrategy, createFallbackActionNarrationFromConfirmedFacts, createFallbackAmbientNarrationFromConfirmedFacts, createHarness, createInitialGameState, fallbackParseAction, resolveTurnHarness } from '@murder-loop-ai/game-core';
import type { AiAdapters, DirectorContext, KillerContext } from '@murder-loop-ai/game-core';
import { minuteLabel, type ActionPlan, type GameState, type KillerStrategy, type Narration, type NarrationContext, type RecommendedAction, type RuleResult, type StoryLogEntry, type TurnResolution } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { createTurnBlackboard, verifyActionPlan, verifyNarration } from '../ai/turnCoordinator';
import { scoreNarrationWithDirector } from '../ai/directorScorer';
import { buildKillerPromptPayload } from '../ai/killerPrompt';
import { normalizeActionPlanJson, unwrapJsonObject } from '../ai/unwrapJsonObject';
import { formatWorldInfoPromptBlock } from '../ai/worldInfoPrompt';
import { formatConfirmedWorldEventsPromptBlock } from '../ai/worldEventPrompt';

interface FrontendAdapterRouteOptions {
  createAiAdapters?: (input: string, state: GameState) => {
    aiAdapters: AiAdapters;
    coordination?: {
      warnings?: string[];
      judgements?: Record<string, unknown>;
    };
  };
}

interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
  recommendedActions?: RecommendedAction[];
}

function attachRecommendedActions(
  nodes: FrontendStoryNode[],
  resolution: TurnResolution,
): FrontendStoryNode[] {
  if (!resolution.recommendedActions?.length) return nodes;
  let index = -1;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (nodes[i].type === 'action_result') {
      index = i;
      break;
    }
  }
  if (index < 0) return nodes;
  return nodes.map((node, nodeIndex) =>
    nodeIndex === index
      ? { ...node, recommendedActions: resolution.recommendedActions }
      : node
  );
}

function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action') {
    return {
      id: entry.id,
      type: 'action_result',
      content: `${entry.title ? `${entry.title}。` : ''}${entry.text}`,
      timestamp: minuteLabel(entry.minute),
    };
  }

  if (entry.tone === 'system') {
    return {
      id: entry.id,
      type: 'system',
      content: entry.title || entry.text,
      timestamp: minuteLabel(entry.minute),
    };
  }

  return {
    id: entry.id,
    type: 'narrative',
    content: entry.text,
    timestamp: minuteLabel(entry.minute),
  };
}

function collectNarrationOutcomeWarnings(
  actionNarration?: Narration | null,
  ambientNarration?: Narration | null,
): string[] {
  const warnings: string[] = [];
  const decisiveNarration = actionNarration?.ending || actionNarration?.isFatal || actionNarration?.killerKilled
    ? actionNarration
    : ambientNarration;

  if (decisiveNarration?.ending) {
    warnings.push(`narrated ending proposal ignored: ${decisiveNarration.ending}; only deterministic rules may validate world-state changes.`);
  }
  if (actionNarration?.isFatal || ambientNarration?.isFatal) {
    warnings.push('fatal narration proposal ignored: narration cannot directly set death.');
  }
  if (actionNarration?.killerKilled || ambientNarration?.killerKilled) {
    warnings.push('killerKilled narration proposal ignored: narration cannot directly change killer status.');
  }

  return warnings;
}

async function parseActionForFrontend(input: string, state: GameState, blackboard = createTurnBlackboard(input, state)): Promise<ActionPlan> {
  const fallback = fallbackParseAction(input);
  try {
    const { buildParseSystemPrompt } = await import('../ai/parserPrompt');
    const parserContext = buildParserContext(input, state);
    const ai = await completeRoleJson(
      'parse',
      buildParseSystemPrompt(),
      { input, state, parserContext },
      { temperature: 0.25 },
    );
  const parsed = ActionPlanSchema.safeParse(normalizeActionPlanJson(ai));
  if (!parsed.success) throw new Error('parse action schema mismatch');
  return verifyActionPlan(input, parsed.data, blackboard);
  } catch (error) {
    blackboard.warnings.push(`parse action AI failed; using fallback parser. ${error instanceof Error ? error.message : String(error)}`);
    return verifyActionPlan(input, fallback, blackboard);
  }
}

function actionOnlyContext(context: NarrationContext): NarrationContext {
  return {
    ...context,
    events: context.events.filter((event) => event.kind === 'action' || event.kind === 'clue' || event.kind === 'state_change' || event.kind === 'ending'),
    confirmedFacts: context.confirmedFacts.filter((fact) => fact.origin === 'player' || fact.origin === 'rule'),
    forbiddenFacts: [
      ...context.forbiddenFacts,
      '行动回应只写玩家动作的直接结果，不能写下一波敲门、脚步、断电、来电或陌生号码回复。',
    ],
  };
}

function ambientOnlyContext(context: NarrationContext): NarrationContext {
  const ambientEvents = context.events.filter((event) => !['action', 'clue'].includes(event.kind));
  return {
    ...context,
    events: ambientEvents,
    confirmedFacts: context.confirmedFacts.filter((fact) => fact.origin === 'killer' || fact.origin === 'world'),
    forbiddenFacts: [
      ...context.forbiddenFacts,
      '环境播报只写外部环境和暗线反馈，不能复述玩家刚刚做了什么，也不能替玩家总结行动。',
    ],
  };
}

async function chooseKillerStrategyForFrontend(killerContext: KillerContext, blackboard: ReturnType<typeof createTurnBlackboard>): Promise<KillerStrategy> {
  const fallback = chooseFallbackKillerStrategy(killerContext);
  try {
    const ai = await completeRoleJson(
      'killer',
    [
      'You are the killer-side narrative analyst. First infer what the player just did, what the rule events confirmed, and what Chen Huaimin can reasonably know.',
      'Do not map a single clue to a canned strategy. Photo, upload, or social posting does not automatically mean framing_pressure; consider who saw it, whether it is public, and whether Chen knows.',
      'Director feasibility rule: the strategy must be supported by killerContext.visibleState and killerContext.observableEvents. If Chen cannot observe a fact, do not use it.',
      '你是《23:47》的暗线导演，只负责陈怀民与楼道环境的下一步压力，不写小说正文。',
      '你只能看 visibleState。玩家没有暴露的位置、证据备份、心理活动、房内细节，你都不知道。不要全知反制。',
      '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。他优先试探、欺骗、拖延、切断信息，而不是无脑冲门。',
      '节奏要像悬疑网文：一小步一小步收紧。低压用短信/轻敲/静默；中压用房东借口/断电/伪回拨；高压才考虑假警察、窗外路线、备用钥匙。',
      '如果玩家本回合是在回复陈怀民、陌生号码或门外人，优先选择 message_reply，只承接对话，不要突然切到敲门、断电、脚步逼近。',
      '如果玩家已经有证据外传、官方核验、门窗防御较强，可以选择 retreat 或 framing_pressure，不要硬杀。',
      'title 要像章节小标题，短而有画面；rationale 写给调试看，说明为什么这一步合理；visibleToPlayer 只表示玩家能感知到外部现象。',
      '短信策略硬规则：选择 phone_probe、message_reply、framing_pressure 时，responseHint 必填，且必须包含玩家能看到的具体短信原文（用中文引号）。不能只写“收到一条消息”。',
      '避免复读：检查 killerContext.visibleState.recentKillerActions/observableEvents，上一条短信问过什么，这一条必须换问法或升级压力。',
      '施压触发不只来自未回复短信：玩家拒绝开门/反锁门、核实身份、录音拍照、外传证据、拖延交出包裹，都可以让陈怀民升级为 framing_pressure。',
      'framing_pressure 话术边界：用“拿错别人东西/偷拿/房东登记/限时放回门口”施压；禁止主动说“毒品/违禁品/走私/贩毒”等定性词，除非剧情事件明确写入陈怀民可用这种话术。',
      '只输出一个裸 JSON 对象，不要包在 strategy/killerStrategy/result 字段里。',
      '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"短信/对话/威胁的具体可见原文；非短信策略可省略","visibleToPlayer":true,"risk":"low|medium|high"}',
    ].join('\n') + '\n' + formatWorldInfoPromptBlock(killerContext.worldInfo, 'killer'),
    buildKillerPromptPayload(killerContext),
    { temperature: 0.55 },
  );
  const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
  if (!parsed.success) throw new Error('killer strategy schema mismatch');
  blackboard.artifacts.killerStrategy = parsed.data;
  return parsed.data;
  } catch (error) {
    blackboard.warnings.push(`killer strategy AI failed; using fallback strategy. ${error instanceof Error ? error.message : String(error)}`);
    blackboard.artifacts.killerStrategy = fallback;
    return fallback;
  }
}

async function narrateActionForFrontend(context: NarrationContext, blackboard: ReturnType<typeof createTurnBlackboard>): Promise<Narration> {
  const narrationContext = actionOnlyContext(context);
  const allowedTimeLabels = [minuteLabel(narrationContext.minute)];
  const system = [
      '你是《23:47》的”行动回应”作者。只写玩家这次动作的落地结果，不写下一波环境推进。',
      '你只能使用 narrationContext.events 里的事实。不要新增证据，不改变时间、生死、NPC 状态，不让角色突然进场。',
      '',
      '【动作核对】只写 narrationContext.confirmedFacts 中 origin=player 或 origin=rule 的已确认动作和后果。',
      '玩家输入”我打开纸条，看看这是什么东西”→ 叙事主体是打开纸条/看纸条，绝不能写成冲出门/翻包裹。',
      '',
      '目标是让玩家感到输入被认真执行：动作顺序、物体变化、代价、遗漏和可利用信息都要具体。',
      '文风参考悬疑网文：段落有推进，句子有钩子，但不要中二，不要空喊恐惧。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
      '可以有极短的第一人称反应，但不能替玩家悟出真相，不能泄露凶手内心。',
      '不得借用未出现在 confirmedFacts 中的旧叙事细节来补充本回合事实。',
      '',
      '【★ 信息边界——叙事不能替玩家下结论 ★】',
      '沈知夏只是一个普通租客。她打开包裹看到旧书、药盒、纸条——但她不知道这是毒品。',
      '❌ 禁止在叙事或线索中使用”毒品””冰毒””海洛因””违禁品””走私””贩毒”等定性词。',
      '✅ 只描述物理特征和客观事实：铅笔字迹的内容、药板的包装状态、纸条上的数字格式。',
      '线索和叙事正文都不能写出玩家尚不知情的结论。信息边界一直维持到玩家获得确凿证据。',
      '',
      '【严格结局声明】只有当本回合事件已经把结局坐实时，才能声明 ending / isFatal / killerKilled。',
      '不能因为玩家嘴上说“我逃出去了”“我已经到手机店了”就直接给结局；必须是事件里已经完成了逃离、制服、死亡或脱险。',
      '可选字段：ending（death|escaped_no_evidence|escaped_with_evidence）。具体死因或逃脱原因由规则系统写入 endingReason，叙事不能自造旧结局名。',
      `【时间一致性】如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造上下文里不存在的时间。`,
      '220-520 个中文字符。只输出 JSON：{“title”:”...”,”text”:”...”,“ending”:”可选 endingId”}。',
    ].join('\n')
      + '\n' + formatConfirmedWorldEventsPromptBlock(narrationContext.confirmedWorldEvents);
  const fallback = createFallbackActionNarrationFromConfirmedFacts(narrationContext);

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext },
    { temperature: 0.72 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'actionNarration', {
    currentMinute: narrationContext.minute,
    allowedMinutes: [narrationContext.minute],
  }) : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('actionNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.actionNarration = fallback;
  }
  return narration;
}

async function narrateAmbientForFrontend(context: NarrationContext, blackboard: ReturnType<typeof createTurnBlackboard>): Promise<Narration> {
  const narrationContext = ambientOnlyContext(context);
  const allowedTimeLabels = [minuteLabel(narrationContext.minute)];
  const system = [
      '你是《23:47》的”环境播报/暗线镜头”。只写门外、楼道、手机、时间、来电、灯光、窗外等环境变化。',
      '不要复述玩家动作细节，不要写玩家心理，不要解释凶手计划。你只呈现玩家能直接感知的现象。',
      '【信息边界】不使用”毒品””违禁品””走私”等玩家尚不知情的定性词。只呈现可感知的外部现象。',
      '节奏要短促、有镜头感：每次只推进一个压力点。不要每回合都大爆发，安静、停顿、误导同样重要。',
      '语言要像悬疑网文的收尾钩子：具体、克制、最后一句压住下一步选择。',
      '不得借用未出现在 confirmedFacts 中的旧叙事细节来补充本回合事实。',
      '【严格结局声明】只有当本回合事件已经把结局坐实时，才能声明 ending / isFatal / killerKilled。',
      '不能因为玩家嘴上说自己已经脱险就直接给结局；必须是外部事件已经把结果坐实。',
      `【时间一致性】如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造上下文里不存在的时间。`,
      '90-240 个中文字符。只输出 JSON：{"title":"...","text":"...","ending":"可选 endingId"}。',
    ].join('\n')
      + '\n' + formatConfirmedWorldEventsPromptBlock(narrationContext.confirmedWorldEvents);
  const fallback = createFallbackAmbientNarrationFromConfirmedFacts(narrationContext);

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext },
    { temperature: 0.78 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'ambientNarration', {
    currentMinute: narrationContext.minute,
    allowedMinutes: [narrationContext.minute],
  }) : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('ambientNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.ambientNarration = fallback;
  }
  return narration;
}

async function critiqueNarrationForFrontend(input: {
  directorContext: DirectorContext;
  narrationContext: NarrationContext;
}) {
  const [actionScore, ambientScore] = await Promise.all([
    scoreNarrationWithDirector({
      slot: 'action',
      narration: input.directorContext.actionNarration,
      context: input.narrationContext,
    }),
    scoreNarrationWithDirector({
      slot: 'ambient',
      narration: input.directorContext.ambientNarration,
      context: input.narrationContext,
    }),
  ]);
  const average = (left: number, right: number) => Math.round((left + right) / 20);
  const violations = [...actionScore.issues, ...ambientScore.issues];

  return {
    score: {
      pacing: average(actionScore.pace, ambientScore.pace),
      infoLeak: average(actionScore.infoSafety, ambientScore.infoSafety),
      ruleConsistency: average(actionScore.ruleConsistency, ambientScore.ruleConsistency),
      prose: average(actionScore.prose, ambientScore.prose),
    },
    passed: actionScore.verdict === 'pass' && ambientScore.verdict === 'pass',
    violations,
  };
}

export function createFrontendHarnessAdapters(input: string, state: GameState) {
  const blackboard = createTurnBlackboard(input, state);
  const aiAdapters: AiAdapters = {
    parseAction: async (actionInput, currentState) =>
      verifyActionPlan(actionInput, await parseActionForFrontend(actionInput, currentState, blackboard), blackboard),
    chooseKillerStrategy: (killerContext) => chooseKillerStrategyForFrontend(killerContext, blackboard),
    narrateAction: (context) => narrateActionForFrontend(context, blackboard),
    narrateAmbient: (context) => narrateAmbientForFrontend(context, blackboard),
    reviewNarration: critiqueNarrationForFrontend,
  };

  return {
    aiAdapters,
    coordination: {
      warnings: blackboard.warnings,
      judgements: {
        facts: blackboard.facts,
      },
    },
  };
}

export async function frontendAdapterRoute(app: FastifyInstance, options: FrontendAdapterRouteOptions = {}) {
  app.post('/api/frontend/resolve-action', async (request) => {
    const body = request.body as { actionText?: string; coreState?: GameState };
    const actionText = body.actionText?.trim();
    const baseState = body.coreState ?? createInitialGameState();

    if (!actionText) {
      return {
        coreState: baseState,
        time: minuteLabel(baseState.minute),
        location: '青荷公寓 503室',
        phase: baseState.phase,
        clues: baseState.clues.map((id) => ({ id, name: id, description: '线索已记录。', status: 'known' })),
        storyLog: [] satisfies FrontendStoryNode[],
        actionConfirmation: null,
      };
    }

    const beforeLogLength = baseState.log.length;
    const adapterBundle = options.createAiAdapters?.(actionText, baseState) ?? createFrontendHarnessAdapters(actionText, baseState);
    const harness = createHarness(adapterBundle.aiAdapters);
    const resolution = await resolveTurnHarness(baseState, actionText, harness);
    const finalState = resolution.finalState;
    const outcomeWarnings = collectNarrationOutcomeWarnings(
      resolution.actionNarration,
      resolution.ambientNarration,
    );
    const newNodes = finalState.log.slice(beforeLogLength).map(toFrontendNode);
    const storyLog = attachRecommendedActions(
      [
        {
          id: `input-${Date.now()}`,
          type: 'player_input',
          content: actionText,
        },
        ...newNodes,
      ],
      resolution,
    );
    const endingEntry = finalState.ending ? finalState.log[finalState.log.length - 1] : null;
    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType,
      agentId: e.agentId,
      source: e.source,
      warnings: e.warnings,
      durationMs: e.durationMs,
    }));
    const agentTrace = harness.dispatcher.getAgentTrace();
    return {
      coreState: finalState,
      time: minuteLabel(finalState.minute),
      location: '青荷公寓 503室',
      phase: finalState.phase,
      clues: finalState.clues.map((clue, index) => ({
        id: clue.id,
        name: clue.title,
        description: clue.detail,
        status: index === finalState.clues.length - 1 ? 'new' : 'known',
      })),
      storyLog: storyLog satisfies FrontendStoryNode[],
      actionConfirmation: null,
      ending: finalState.ending,
      deathTitle: finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod: null,
      score: finalState.score,
      agentTrace,
      coordination: {
        warnings: [
          ...(adapterBundle.coordination?.warnings ?? []),
          ...outcomeWarnings,
          ...trace.flatMap(t => t.warnings),
        ],
        trace,
        ...(adapterBundle.coordination?.judgements ?? {}),
      },
    };
  });
}
