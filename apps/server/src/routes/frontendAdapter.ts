import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema, KillerStrategySchema, NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { clueBook } from '@murder-loop-ai/content';
import { chooseFallbackKillerStrategy, createFallbackActionNarration, createFallbackAmbientNarration, createHarness, createInitialGameState, fallbackParseAction, projectKillerVisibleState, resolveTurnHarness } from '@murder-loop-ai/game-core';
import type { AiAdapters } from '@murder-loop-ai/game-core';
import { minuteLabel, type ActionPlan, type GameState, type KillerStrategy, type Narration, type NarrationContext, type RuleResult, type StoryLogEntry } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy, verifyNarration } from '../ai/turnCoordinator';
import { scoreNarrationWithDirector } from '../ai/directorScorer';
import { normalizeActionPlanJson, unwrapJsonObject } from '../ai/unwrapJsonObject';

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
    warnings.push(`narrated ending proposal ignored: ${decisiveNarration.ending}; rules/director must validate world-state changes.`);
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
    const ai = await completeRoleJson(
      'parse',
      buildParseSystemPrompt(),
      { input, state },
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

function actionOnlyContext(context: NarrationContext, playerResult: RuleResult): NarrationContext {
  return {
    ...context,
    events: playerResult.events,
    forbiddenFacts: [
      ...context.forbiddenFacts,
      '行动回应只写玩家动作的直接结果，不能写下一波敲门、脚步、断电、来电或陌生号码回复。',
    ],
  };
}

function ambientOnlyContext(context: NarrationContext, killerResult: RuleResult): NarrationContext {
  const ambientEvents = context.events.filter((event) => !['action', 'clue'].includes(event.kind));
  return {
    ...context,
    events: ambientEvents.length ? ambientEvents : killerResult.events,
    forbiddenFacts: [
      ...context.forbiddenFacts,
      '环境播报只写外部环境和暗线反馈，不能复述玩家刚刚做了什么，也不能替玩家总结行动。',
    ],
  };
}

async function chooseKillerStrategyForFrontend(state: GameState, plan?: ActionPlan, playerResult?: RuleResult, blackboard = createTurnBlackboard('', state)): Promise<KillerStrategy> {
  const visible = projectKillerVisibleState(state);
  const fallback = chooseFallbackKillerStrategy(state);
  try {
    const ai = await completeRoleJson(
      'killer',
    [
      'You are the killer-side narrative analyst. First infer what the player just did, what the rule events confirmed, and what Chen Huaimin can reasonably know.',
      'Do not map a single clue to a canned strategy. Photo, upload, or social posting does not automatically mean framing_pressure; consider who saw it, whether it is public, and whether Chen knows.',
      'Director feasibility rule: the strategy must be supported by visibleState, playerResult.events, and plan. If Chen cannot know the photo was shared, he cannot directly accuse the player of hiding contraband.',
      '你是《23:47》的暗线导演，只负责陈怀民与楼道环境的下一步压力，不写小说正文。',
      '你只能看 visibleState。玩家没有暴露的位置、证据备份、心理活动、房内细节，你都不知道。不要全知反制。',
      '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。他优先试探、欺骗、拖延、切断信息，而不是无脑冲门。',
      '节奏要像悬疑网文：一小步一小步收紧。低压用短信/轻敲/静默；中压用房东借口/断电/伪回拨；高压才考虑假警察、窗外路线、备用钥匙。',
      '如果玩家本回合是在回复陈怀民、陌生号码或门外人，优先选择 message_reply，只承接对话，不要突然切到敲门、断电、脚步逼近。',
      '如果玩家已经有证据外传、官方核验、门窗防御较强，可以选择 retreat 或 framing_pressure，不要硬杀。',
      'title 要像章节小标题，短而有画面；rationale 写给调试看，说明为什么这一步合理；visibleToPlayer 只表示玩家能感知到外部现象。',
      '只输出一个裸 JSON 对象，不要包在 strategy/killerStrategy/result 字段里。',
      '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"可选，若是短信/对话则写他发来的具体话","visibleToPlayer":true,"risk":"low|medium|high"}',
    ].join('\n'),
    { visibleState: visible, plan, playerResult },
    { temperature: 0.55 },
  );
  const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
  if (!parsed.success) throw new Error('killer strategy schema mismatch');
  return verifyKillerStrategy(state, parsed.data, blackboard);
  } catch (error) {
    blackboard.warnings.push(`killer strategy AI failed; using fallback strategy. ${error instanceof Error ? error.message : String(error)}`);
    return verifyKillerStrategy(state, fallback, blackboard);
  }
}

async function narrateActionForFrontend(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState, blackboard = createTurnBlackboard('', state)): Promise<Narration> {
  const narrationContext = actionOnlyContext(context, playerResult);
  const allowedTimeLabels = Array.from(new Set([
    minuteLabel(narrationContext.minute),
    ...narrationContext.recentLog.map((entry) => minuteLabel(entry.minute)),
  ]));
  const system = [
      '你是《23:47》的”行动回应”作者。只写玩家这次动作的落地结果，不写下一波环境推进。',
      '你只能使用 narrationContext.events 里的事实。不要新增证据，不改变时间、生死、NPC 状态，不让角色突然进场。',
      '',
      '【动作核对】上下文中有 playerInput 字段——这是玩家原始输入。叙事中每个动作必须对应 playerInput 中的动词。',
      '玩家输入”我打开纸条，看看这是什么东西”→ 叙事主体是打开纸条/看纸条，绝不能写成冲出门/翻包裹。',
      '',
      '目标是让玩家感到输入被认真执行：动作顺序、物体变化、代价、遗漏和可利用信息都要具体。',
      '文风参考悬疑网文：段落有推进，句子有钩子，但不要中二，不要空喊恐惧。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
      '可以有极短的第一人称反应，但不能替玩家悟出真相，不能泄露凶手内心。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '',
      '【★ 信息边界——叙事不能替玩家下结论 ★】',
      '沈知夏只是一个普通租客。她打开包裹看到旧书、药盒、纸条——但她不知道这是毒品。',
      '❌ 禁止在叙事或线索中使用”毒品””冰毒””海洛因””违禁品””走私””贩毒”等定性词。',
      '✅ 只描述物理特征和客观事实：铅笔字迹的内容、药板的包装状态、纸条上的数字格式。',
      '线索和叙事正文都不能写出玩家尚不知情的结论。信息边界一直维持到玩家获得确凿证据。',
      '',
      '【严格结局声明】只有当本回合事件已经把结局坐实时，才能声明 ending / isFatal / killerKilled。',
      '不能因为玩家嘴上说“我逃出去了”“我已经到手机店了”就直接给结局；必须是事件里已经完成了逃离、制服、死亡或脱险。',
      '可选字段：ending（escaped_without_truth|survived_with_evidence|perfect_truth|killer_dead_with_evidence|killer_dead_no_evidence|killer_arrested|killer_fled|framed_survivor|default_murder|opened_to_fake_police|window_route_death|hidden_inside_death|mutual_kill|phone_dead_helpless|suicide）',
      `【时间一致性】如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造上下文里不存在的时间。`,
      '220-520 个中文字符。只输出 JSON：{“title”:”...”,”text”:”...”,“ending”:”可选 endingId”}。',
    ].join('\n');
  const fallback = createFallbackActionNarration(playerResult);

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext, playerResult, state },
    { temperature: 0.72 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'actionNarration', {
    currentMinute: narrationContext.minute,
    allowedMinutes: [narrationContext.minute, ...narrationContext.recentLog.map((entry) => entry.minute)],
  }) : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('actionNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.actionNarration = fallback;
  }
  const score = await scoreNarrationWithDirector({ slot: 'action', narration, context: narrationContext, playerResult, killerResult, state });
  blackboard.directorScores.push(score);

  return narration;
}

async function narrateAmbientForFrontend(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState, blackboard = createTurnBlackboard('', state)): Promise<Narration> {
  const narrationContext = ambientOnlyContext(context, killerResult);
  const allowedTimeLabels = Array.from(new Set([
    minuteLabel(narrationContext.minute),
    ...narrationContext.recentLog.map((entry) => minuteLabel(entry.minute)),
  ]));
  const system = [
      '你是《23:47》的”环境播报/暗线镜头”。只写门外、楼道、手机、时间、来电、灯光、窗外等环境变化。',
      '不要复述玩家动作细节，不要写玩家心理，不要解释凶手计划。你只呈现玩家能直接感知的现象。',
      '【信息边界】不使用”毒品””违禁品””走私”等玩家尚不知情的定性词。只呈现可感知的外部现象。',
      '节奏要短促、有镜头感：每次只推进一个压力点。不要每回合都大爆发，安静、停顿、误导同样重要。',
      '语言要像悬疑网文的收尾钩子：具体、克制、最后一句压住下一步选择。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '【严格结局声明】只有当本回合事件已经把结局坐实时，才能声明 ending / isFatal / killerKilled。',
      '不能因为玩家嘴上说自己已经脱险就直接给结局；必须是外部事件已经把结果坐实。',
      `【时间一致性】如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造上下文里不存在的时间。`,
      '90-240 个中文字符。只输出 JSON：{"title":"...","text":"...","ending":"可选 endingId"}。',
    ].join('\n');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext, killerResult, state },
    { temperature: 0.78 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'ambientNarration', {
    currentMinute: narrationContext.minute,
    allowedMinutes: [narrationContext.minute, ...narrationContext.recentLog.map((entry) => entry.minute)],
  }) : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('ambientNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.ambientNarration = fallback;
  }
  const score = await scoreNarrationWithDirector({ slot: 'ambient', narration, context: narrationContext, playerResult, killerResult, state });
  blackboard.directorScores.push(score);

  return narration;
}

export function createFrontendHarnessAdapters(input: string, state: GameState) {
  const blackboard = createTurnBlackboard(input, state);
  const aiAdapters: AiAdapters = {
    parseAction: async (actionInput, currentState) =>
      verifyActionPlan(actionInput, await parseActionForFrontend(actionInput, currentState, blackboard), blackboard),
    chooseKillerStrategy: (currentState, plan, playerResult) => chooseKillerStrategyForFrontend(currentState, plan, playerResult, blackboard),
    narrateAction: (context, playerResult, killerResult, currentState) =>
      narrateActionForFrontend(context, playerResult, killerResult, currentState, blackboard),
    narrateAmbient: (context, playerResult, killerResult, currentState) =>
      narrateAmbientForFrontend(context, playerResult, killerResult, currentState, blackboard),
  };

  return {
    aiAdapters,
    coordination: {
      warnings: blackboard.warnings,
      judgements: {
        facts: blackboard.facts,
        directorScores: blackboard.directorScores,
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
    const endingEntry = finalState.ending ? finalState.log[finalState.log.length - 1] : null;
    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType,
      agentId: e.agentId,
      source: e.source,
      warnings: e.warnings,
      durationMs: e.durationMs,
    }));
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
      storyLog: [
        {
          id: `input-${Date.now()}`,
          type: 'player_input',
          content: actionText,
        },
        ...newNodes,
      ] satisfies FrontendStoryNode[],
      actionConfirmation: null,
      ending: finalState.ending,
      deathTitle: finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod: null,
      score: finalState.score,
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
