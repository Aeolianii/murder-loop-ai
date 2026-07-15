import type { FastifyInstance } from 'fastify';
import {
  createHarness, normalizeLoopMemory, resolveTurnHarness,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type ActionAudioCue, type ActionPlan, type ClueRecord, type GameState, type Narration,
  type RuleEvent, type RuleResult, type StoryLogEntry, type TurnResolution,
} from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { selectPrimaryActionAudioCue } from '../ai/audioCueSelector';
import { createAiHarness } from '../ai/harnessAiAdapters';
import {
  buildSidebarPayload,
  toFrontendClues,
  toFrontendNode,
  type FrontendStoryNode,
} from '../presenters/frontendTurnPresenter';
import { coerceGameState, normalizeDynamicClueId } from '../state/coerceGameState';

interface HarnessTurnRouteOptions {
  createAiAdapters?: (input: string, state: GameState) => {
    aiAdapters: AiAdapters;
    coordination?: {
      warnings?: string[];
      judgements?: Record<string, unknown>;
    };
  };
  selectActionAudioCue?: (args: {
    input: string;
    plan: ActionPlan;
    state: GameState;
    playerResult: RuleResult;
  }) => Promise<ActionAudioCue | null>;
}

function generateRecap(state: GameState): string {
  const memories = normalizeLoopMemory(state.memory).crossRun;

  if (state.run > 1 && memories.length > 0) {
    const last = memories[memories.length - 1];
    return `第 ${state.run} 次循环。死因：${last.title}`;
  }

  return `第 ${state.run} 次循环。`;
}

function phaseFromEnding(ending: NonNullable<GameState['ending']>): GameState['phase'] {
  return ending.includes('survived') || ending === 'perfect_truth' || ending === 'escaped_without_truth' || ending === 'framed_survivor'
    ? 'survived'
    : 'death';
}

function isNarratedEndingSupported(
  ending: NonNullable<GameState['ending']>,
  finalState: GameState,
  plan?: ActionPlan,
): boolean {
  const didEscape = plan?.actions.some((action) => action.intent === 'escape') ?? false;
  const didOpenExit = Boolean(finalState.room.front_door.state.opened) || Boolean(finalState.room.window.state.opened);
  const hasEvidence = finalState.clues.some(c => c.id === 'package_photo')
    || finalState.clues.some(c => c.id === 'linyue_has_photo')
    || Boolean(finalState.room.phone.state.recording)
    || Boolean(finalState.room.package.state.backedUp);
  const policeTrusted = finalState.policePhase === 'real_police_en_route' || finalState.policePhase === 'arrived'
    || finalState.clues.some(c => c.id === 'police_verified');
  const killerDown = finalState.killerStatus === 'dead' || finalState.killerStatus === 'arrested' || finalState.killerStatus === 'fled';

  switch (ending) {
    case 'escaped_without_truth':
      return didEscape && didOpenExit;
    case 'survived_with_evidence':
    case 'perfect_truth':
    case 'framed_survivor':
      return hasEvidence || policeTrusted;
    case 'killer_dead_with_evidence':
      return finalState.killerStatus === 'dead' && hasEvidence;
    case 'killer_dead_no_evidence':
      return finalState.killerStatus === 'dead';
    case 'killer_arrested':
      return finalState.killerStatus === 'arrested' || policeTrusted;
    case 'killer_fled':
      return finalState.killerStatus === 'fled' || (didEscape && didOpenExit);
    default:
      return killerDown || didOpenExit || policeTrusted || hasEvidence;
  }
}

function applyNarrationOutcomeHints(
  finalState: GameState,
  plan?: ActionPlan,
  actionNarration?: Narration | null,
  ambientNarration?: Narration | null,
): string[] {
  void finalState;
  void plan;
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

// ============================================================================
// Plot Director — 上帝视角，评估剧情并指导下一步走向
// ============================================================================

interface PlotGuidance {
  phase: string;           // 当前剧情阶段: 'opening' | 'rising_tension' | 'climax' | 'resolution'
  progress: string;        // 一行总结：故事已经走到了哪里
  stuck: boolean;          // 剧情是否卡住了
  stuckReason: string;     // 如果卡住了，原因是什么
  nextDirection: string;   // 下一回合叙事应该朝什么方向发展（1-2句话）
  killerDirective: string; // 杀手下一步应该做什么
  missedOpportunities: string[]; // 玩家错过的线索或行动机会（可以自然提示的）
}

const plotGuidanceCache = new Map<string, string>();
const MAX_PLOT_GUIDANCE_CACHE = 200;

function plotGuidanceCacheKey(state: GameState): string {
  const lastLogId = state.log[state.log.length - 1]?.id ?? 'no-log';
  return [state.run, state.minute, state.phase, state.ending ?? 'none', lastLogId].join(':');
}

function formatPlotGuidance(guidance: PlotGuidance): string {
  return [
    `剧情阶段: ${guidance.phase} | ${guidance.progress}`,
    `下一步: ${guidance.nextDirection}`,
    `杀手行动: ${guidance.killerDirective}`,
    guidance.stuck ? `⚠ 卡住了: ${guidance.stuckReason}` : '',
    guidance.missedOpportunities.length ? `可提示线索: ${guidance.missedOpportunities.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function hydrateCachedPlotGuidance(state: GameState): GameState {
  if (state.plotGuidance) return state;
  const cached = plotGuidanceCache.get(plotGuidanceCacheKey(state));
  return cached ? { ...state, plotGuidance: cached } : state;
}

function cachePlotGuidance(state: GameState, plotGuidance: string): void {
  const key = plotGuidanceCacheKey(state);
  plotGuidanceCache.set(key, plotGuidance);
  if (plotGuidanceCache.size <= MAX_PLOT_GUIDANCE_CACHE) return;
  const oldestKey = plotGuidanceCache.keys().next().value;
  if (oldestKey) {
    plotGuidanceCache.delete(oldestKey);
  }
}

function schedulePlotGuidance(state: GameState): void {
  const key = plotGuidanceCacheKey(state);
  if (state.plotGuidance || plotGuidanceCache.has(key)) return;
  void directPlot(state)
    .then((guidanceResult) => {
      if (!guidanceResult) return;
      cachePlotGuidance(state, formatPlotGuidance(guidanceResult));
    })
    .catch(() => undefined);
}

async function directPlot(state: GameState): Promise<PlotGuidance | null> {
  try {
    const recentEvents = state.log.slice(-6).map(l => `${l.channel}: ${l.title} — ${l.text.slice(0, 100)}`).join('\n');
    const combatCount = state.log.filter(l => l.text.includes('攻击') || l.text.includes('砍') || l.text.includes('砸') || l.text.includes('杀') || l.text.includes('打') || l.text.includes('搏斗')).length;
    const system = [
      '你是剧情导演。你的唯一使命：让这个故事成为精彩的悬疑智斗体验。',
      '',
      '【铁律——违反即失职】',
      '1. 这是智斗游戏。物理攻击和肉搏是彻底的失败——代表导演没有给玩家提供更好的选择。',
      '2. 杀手的行动必须给玩家留下智取空间：设陷阱、伪造证据、欺骗、谈判、收集证据。',
      '3. 不要让杀手直接破门而入。给玩家时间去调查、准备、设局。',
      `4. 当前已发生${combatCount}次战斗事件——${combatCount > 2 ? '已经太多了！立刻转向智斗。' : '还算可控，但不要再增加了。'}`,
      '',
      '【故事设定】',
      '沈知夏误收了装有毒品的包裹。陈怀民（房东/毒贩）必须确认包裹去向。',
      '核心悬疑：包裹里的毒品会让陈怀民坐牢，所以他必须灭口。',
      '但陈怀民不想杀人——他想先确认：她看到毒品了吗？拍照了吗？报警了吗？',
      '杀人是他最后的选项，不是第一反应。先试探、欺骗、威胁、谈判。',
      '',
      '【当前状态】',
      `时间: ${minuteLabel(state.minute)} | 第${state.run}轮 | 距23:47还有${1427 - state.minute}分钟`,
      `杀手状态: ${state.killerStatus} | 威胁值: ${state.threat}/100`,
      `手机电量: ${state.phoneBattery}分钟 | 可用: ${state.phoneFunctional}`,
      `已有线索: ${state.clues.map(c => c.title).join('、') || '无'}`,
      `玩家: injury=${state.player.injury}, stress=${state.player.stress}`,
      `最近事件:\n${recentEvents}`,
      '',
      '【指引规则】',
      '- nextDirection: 具体告诉叙事AI写什么。不要写抽象方向，写具体场景。',
      '  例: "叙事聚焦于包裹里的毒品包装细节——密封袋上的批号和生产日期"',
      '  例: "叙事揭示桌下有一张被踢到角落的快递单，上面有寄件人信息"',
      '- killerDirective: 告诉杀手做什么。优先非暴力手段：',
      '  短信试探 > 房东借口 > 假警察 > 威胁 > 谈判 > 最后才是暴力',
      '- 如果玩家在调查：杀手在门外等待、观察、试探——不要直接破门',
      '- 如果玩家在对话回复：杀手应该继续对话、套取信息',
      '- 只有威胁值>70或时间<23:35时，杀手才考虑暴力手段',
      '- 每回合指引至少包含1个可发现的线索或可互动的物品',
      '',
      '输出 JSON:',
      '{"phase":"opening|investigation|negotiation|escalation|climax","progress":"故事走到了X","stuck":true/false,"stuckReason":"","nextDirection":"叙事AI应该写什么（具体场景）","killerDirective":"杀手做什么（非暴力优先）","missedOpportunities":["玩家可以发现的线索1","可以使用的道具2"]}',
    ].join('\n');

    const ai = await completeRoleJson('recap', system, { state: { minute: state.minute, phase: state.phase, clues: state.clues.map(c => c.title), log: state.log.slice(-8) } }, { temperature: 0.5 });
    if (!ai) return null;
    return {
      phase: (ai as any).phase || 'rising_tension',
      progress: (ai as any).progress || '',
      stuck: (ai as any).stuck || false,
      stuckReason: (ai as any).stuckReason || '',
      nextDirection: (ai as any).nextDirection || '',
      killerDirective: (ai as any).killerDirective || '',
      missedOpportunities: (ai as any).missedOpportunities || [],
    };
  } catch {
    return null;
  }
}

function normalizeVisibleFactText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, '')
    .replace(/[，。！？、；：：“”‘’《》（）()\[\]【】.,!?;:'"~-]/g, '')
    .trim();
}

function buildVisibleFactCorpus(entries: StoryLogEntry[]) {
  return normalizeVisibleFactText(
    entries
      .map((entry) => `${entry.title || ''} ${entry.text || ''}`.trim())
      .filter(Boolean)
      .join('\n'),
  );
}

function extractQuotedPhrases(text: string) {
  return Array.from(text.matchAll(/[“"]([^”"]{2,30})[”"]/g)).map((match) => match[1]);
}

function extractDetailNeedles(text: string) {
  return text
    .split(/[，。！？、；：:\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 || /\d/.test(part));
}

function isClueExplicitlyMentioned(visibleFactCorpus: string, title: string, detail: string) {
  if (!visibleFactCorpus) return false;
  const needles = [
    title,
    ...extractQuotedPhrases(detail),
    ...extractDetailNeedles(detail),
  ]
    .map(normalizeVisibleFactText)
    .filter((needle) => needle.length >= 4 || /\d/.test(needle));

  return needles.some((needle) => visibleFactCorpus.includes(needle));
}

function addDynamicClue(state: GameState, clue: Omit<ClueRecord, 'source' | 'discoveredAt' | 'isPersistent'>) {
  const id = normalizeDynamicClueId(clue.id);
  if (state.clues.some((existing) => existing.id === id || existing.title === clue.title)) return;

  state.clues.push({
    ...clue,
    id,
    source: 'ai_generated',
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });
}

function addNarrationClues(state: GameState, narrations: Array<Narration | undefined>, visibleFactCorpus: string) {
  for (const narration of narrations) {
    if (!narration?.clue) continue;
    if (!isClueExplicitlyMentioned(visibleFactCorpus, narration.clue.title, narration.clue.detail)) continue;
    addDynamicClue(state, {
      id: narration.clue.id,
      title: narration.clue.title,
      detail: narration.clue.detail,
      weight: narration.clue.weight,
    });
  }
}

function isDynamicClueEvent(event: RuleEvent) {
  if (event.visibility !== 'player') return false;
  if (event.kind === 'clue' || event.kind === 'ending' || event.kind === 'threat') return false;
  if (event.kind === 'state_change') return false;
  return event.kind === 'message';
}

function addEventClues(state: GameState, events: RuleEvent[], visibleFactCorpus: string) {
  for (const event of events.filter(isDynamicClueEvent)) {
    const title = '通讯异常';
    const specificTitle = event.sensoryHints[0] ? `${title}：${event.sensoryHints[0]}` : title;
    if (!isClueExplicitlyMentioned(visibleFactCorpus, specificTitle, event.summary)) continue;
    addDynamicClue(state, {
      id: `dyn_${state.run}_${state.minute}_${event.subject}`,
      title: specificTitle.slice(0, 28),
      detail: event.summary,
      weight: 6,
    });
  }
}

function addTurnDynamicClues(resolution: TurnResolution, visibleEntries: StoryLogEntry[]) {
  const state = resolution.finalState;
  const visibleFactCorpus = buildVisibleFactCorpus(visibleEntries);
  addNarrationClues(state, [resolution.actionNarration, resolution.ambientNarration, resolution.narration], visibleFactCorpus);
  addEventClues(state, [
    ...resolution.playerResult.events,
    ...resolution.killerResult.events,
  ], visibleFactCorpus);
}

// ============================================================================
// 路由
// ============================================================================

export async function harnessTurnRoute(app: FastifyInstance, options: HarnessTurnRouteOptions = {}) {
  app.post('/api/harness/turn', async (request) => {
    const body = request.body as { input?: string; state?: GameState };
    const input = body.input?.trim() ?? '';
    const rawState = coerceGameState(body.state);

    // 死亡状态自动回退——无论有没有输入，先复活
    let state = rawState;
    if (rawState.phase === 'death' || (rawState.ending && rawState.phase !== 'loop_started')) {
      const { rewindAfterDeath } = await import('@murder-loop-ai/game-core');
      state = rewindAfterDeath(rawState);
    }
    state = hydrateCachedPlotGuidance(state);

    if (!input) {
      const sidebar = await buildSidebarPayload(createAiHarness(), state, true);
      return {
        coreState: state, time: minuteLabel(state.minute), location: '青荷公寓 503 室',
        phase: state.phase, clues: toFrontendClues(state),
        audioCue: null,
        ending: state.ending,
        deathTitle: null,
        deathSummary: null,
        deathMethod: null,
        recap: generateRecap(state),
        sidebar,
        storyLog: [] satisfies FrontendStoryNode[],
        agentTrace: [],
        coordination: { warnings: [], trace: [], judgements: {} },
      };
    }

    const adapterBundle = options.createAiAdapters?.(input, state);
    const harness = adapterBundle ? createHarness(adapterBundle.aiAdapters) : createAiHarness();
    const routeWarnings = [...(adapterBundle?.coordination?.warnings ?? [])];
    const routeJudgements = adapterBundle?.coordination?.judgements ?? {};

    const recap = generateRecap(state);

    const beforeLen = state.log.length;
    const resolution = await resolveTurnHarness(state, input, harness);

    routeWarnings.push(...applyNarrationOutcomeHints(
      resolution.finalState,
      resolution.plan,
      resolution.actionNarration,
      resolution.ambientNarration,
    ));

    const visibleEntries = resolution.finalState.log.slice(beforeLen);
    addTurnDynamicClues(resolution, visibleEntries);

    // 并发启动回合后的附加工作：audioCue、sidebar 和后台 plot guidance。
    schedulePlotGuidance(resolution.finalState);

    const audioCuePromise = options.selectActionAudioCue?.({
      input,
      plan: resolution.plan,
      state: resolution.finalState,
      playerResult: resolution.playerResult,
    }) ?? selectPrimaryActionAudioCue({
      input,
      plan: resolution.plan,
      state: resolution.finalState,
      playerResult: resolution.playerResult,
    });
    const sidebarPromise = buildSidebarPayload(harness, resolution.finalState);

    const endingEntry = resolution.finalState.ending ? resolution.finalState.log[resolution.finalState.log.length - 1] : null;
    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType, agentId: e.agentId, source: e.source, warnings: e.warnings, durationMs: e.durationMs,
    }));
    const agentTrace = harness.dispatcher.getAgentTrace();
    const [audioCue, sidebar] = await Promise.all([audioCuePromise, sidebarPromise]);

    return {
      recap,
      coreState: resolution.finalState, time: minuteLabel(resolution.finalState.minute),
      location: '青荷公寓 503 室', phase: resolution.finalState.phase,
      audioCue,
      clues: toFrontendClues(resolution.finalState), ending: resolution.finalState.ending,
      deathTitle: resolution.finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: resolution.finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod: null, score: resolution.finalState.score,
      storyLog: [
        { id: `input-${Date.now()}`, type: 'player_input', content: input },
        ...visibleEntries.map(toFrontendNode),
      ] satisfies FrontendStoryNode[],
      turn: { plan: resolution.plan, killerStrategy: resolution.killerStrategy, actionNarration: resolution.actionNarration ?? resolution.narration, ambientNarration: resolution.ambientNarration ?? null },
      agentTrace,
      coordination: { warnings: [...routeWarnings, ...trace.flatMap(t => t.warnings)], trace, judgements: routeJudgements },
      sidebar,
    };
  });
}
