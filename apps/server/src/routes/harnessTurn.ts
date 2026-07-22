import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  activatePlayerKnowledge,
  atomicLoopReset, createHarness, normalizeLoopMemory, prepareDeathLoopReset,
  compileShadowTurnBrief,
  resolveLegacyTurnHarness, resolveMinimumPlayableTurn,
  resolveTurnHarnessFromPreparedPlayerTurn,
  type AiAdapters,
  type HarnessOptions,
  canAccuse, buildDeductionPrompt, validateDeductionClaims,
  buildDeductionResponse, scoreEnding, generateEpiphanyHint,
  resolveDeathPath, shouldTriggerDeath,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type ActionAudioCue, type ActionPlan, type ClueRecord, type GameState, type Narration,
  type RuleEvent, type RuleResult, type StoryLogEntry, type TurnResolution,
} from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { selectPrimaryActionAudioCue } from '../ai/audioCueSelector';
import { createAiHarness, createAiHarnessAdapters } from '../ai/harnessAiAdapters';
import { createAiShadowAdapters } from '../ai/shadowAiAdapters';
import { env } from '../env';
import {
  applyConfirmedTurnNarration,
  buildDisplayedRecommendedActions,
  buildSidebarPayload,
  toFrontendClues,
  toFrontendNode,
  type FrontendStoryNode,
} from '../presenters/frontendTurnPresenter';
import {
  narrateConfirmedTurn,
  type ConfirmedTurnNarration,
} from '../presenters/confirmedTurnNarrator';
import { coerceGameState, normalizeDynamicClueId } from '../state/coerceGameState';
import {
  createInMemoryGameSessionStore,
  gameSessionLoopId,
  type GameSessionStore,
} from '../state/gameSessionStore';
import {
  createShadowRunCoordinator,
  type ShadowRunCoordinator,
  type ShadowRunSession,
} from '../shadow/shadowCoordinator';
import {
  createLowRiskTakeoverService,
  type LowRiskTakeoverService,
} from '../takeover/lowRiskTakeoverService';
import { buildConfirmedAiFirstResolution } from '../takeover/confirmedAiFirstResolution';
import {
  createSemanticPrefetchService,
  type SemanticPrefetchClaim,
  type SemanticPrefetchService,
} from '../prefetch/semanticPrefetchService';

export interface HarnessTurnRouteOptions {
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
  shadowCoordinator?: ShadowRunCoordinator | null;
  lowRiskTakeoverService?: LowRiskTakeoverService | null;
  semanticPrefetchService?: SemanticPrefetchService | null;
  gameSessionStore?: GameSessionStore;
}

interface HarnessResponseTraceEntry {
  taskId: string;
  agentId: string;
  source: string;
  warnings: string[];
  durationMs: number;
}

interface TurnTimingEntry {
  stageId: string;
  durationMs: number;
  status?: string;
}

function buildAgentTimingSummary(trace: HarnessResponseTraceEntry[]) {
  const entries = trace.map((entry) => ({
    taskId: entry.taskId,
    agentId: entry.agentId,
    source: entry.source,
    durationMs: entry.durationMs,
  }));
  const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const slowest = entries.reduce<typeof entries[number] | null>(
    (current, entry) => (!current || entry.durationMs > current.durationMs ? entry : current),
    null,
  );

  return {
    totalMs,
    slowest,
    entries,
  };
}

function buildTurnTimingSummary(entries: TurnTimingEntry[], wallClockMs: number) {
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
  }));
  const totalMs = normalizedEntries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const slowest = normalizedEntries.reduce<TurnTimingEntry | null>(
    (current, entry) => (!current || entry.durationMs > current.durationMs ? entry : current),
    null,
  );

  return {
    wallClockMs: Math.max(0, Math.round(wallClockMs)),
    totalMs,
    slowest,
    entries: normalizedEntries,
  };
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
  return ending === 'death' ? 'death' : 'survived';
}

function isNarratedEndingSupported(
  ending: NonNullable<GameState['ending']>,
  finalState: GameState,
  plan?: ActionPlan,
): boolean {
  const didEscape = plan?.actions.some((action) => action.intent === 'escape') ?? false;
  const didOpenExit = Boolean(finalState.room.front_door.state.opened) || Boolean(finalState.room.window.state.opened);
  const hasPackagePhoto = finalState.clues.some(c => c.id === 'package_photo') || Boolean(finalState.room.package.state.photographed);
  const hasExternalRecord = finalState.clues.some(c => c.id === 'linyue_has_photo')
    || Boolean(finalState.room.phone.state.recording)
    || Boolean(finalState.room.package.state.backedUp)
    || finalState.clues.some(c => c.id === 'police_verified')
    || finalState.policePhase === 'real_police_en_route'
    || finalState.policePhase === 'arrived';
  const hasEvidence = hasPackagePhoto && hasExternalRecord;
  const policeTrusted = finalState.policePhase === 'real_police_en_route' || finalState.policePhase === 'arrived'
    || finalState.clues.some(c => c.id === 'police_verified');
  const killerDown = finalState.killerStatus === 'dead' || finalState.killerStatus === 'arrested' || finalState.killerStatus === 'fled';
  const safeOutcome = killerDown || didOpenExit || policeTrusted || didEscape;

  switch (ending) {
    case 'death':
      return finalState.phase === 'death' || finalState.player.injury === 'critical';
    case 'escaped_no_evidence':
      return safeOutcome && !hasEvidence;
    case 'escaped_with_evidence':
      return safeOutcome && hasEvidence;
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

function isPaperNoteClueText(text: string) {
  return text.includes('纸条') && /(门缝|门底|门外|塞入|塞进)/.test(text);
}

function hasUnopenedPaperNoteClaim(text: string) {
  return /(尚未|还未|未)(展开|打开|查看)/.test(text);
}

function hasRevealedPaperNoteContent(text: string) {
  return /[“"]([^”"]{2,})[”"]/.test(text) || /写着|写字|内容/.test(text);
}

function paperNoteClueResolution(existing: ClueRecord, candidate: ClueRecord) {
  const existingText = `${existing.title} ${existing.detail}`;
  const candidateText = `${candidate.title} ${candidate.detail}`;
  const sameTurn = existing.discoveredAt.run === candidate.discoveredAt.run && existing.discoveredAt.minute === candidate.discoveredAt.minute;
  if (!sameTurn || !isPaperNoteClueText(existingText) || !isPaperNoteClueText(candidateText)) return 'keep-both';

  const existingRevealed = hasRevealedPaperNoteContent(existingText);
  const candidateRevealed = hasRevealedPaperNoteContent(candidateText);
  const existingUnopened = hasUnopenedPaperNoteClaim(existingText);
  const candidateUnopened = hasUnopenedPaperNoteClaim(candidateText);

  if (candidateUnopened && existingRevealed) return 'skip-candidate';
  if (candidateRevealed && existingUnopened) return 'replace-existing';
  return 'skip-candidate';
}

function addDynamicClue(state: GameState, clue: Omit<ClueRecord, 'source' | 'discoveredAt' | 'isPersistent'>) {
  const id = normalizeDynamicClueId(clue.id);
  if (state.clues.some((existing) => existing.id === id || existing.title === clue.title)) return;

  const candidate: ClueRecord = {
    ...clue,
    id,
    source: 'ai_generated',
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  };

  const paperNoteIndex = state.clues.findIndex((existing) => {
    const resolution = paperNoteClueResolution(existing, candidate);
    return resolution === 'skip-candidate' || resolution === 'replace-existing';
  });
  if (paperNoteIndex >= 0) {
    const resolution = paperNoteClueResolution(state.clues[paperNoteIndex], candidate);
    if (resolution === 'replace-existing') {
      state.clues.splice(paperNoteIndex, 1, candidate);
    }
    return;
  }

  state.clues.push(candidate);
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

function attachRecommendedActions(
  nodes: FrontendStoryNode[],
  resolution: TurnResolution,
): FrontendStoryNode[] {
  const recommendedActions = buildDisplayedRecommendedActions(
    resolution.recommendedActions ?? [],
    resolution.finalState,
  );
  if (recommendedActions.length === 0) return nodes;
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
      ? { ...node, recommendedActions }
      : node
  );
}

// ============================================================================
// 路由
// ============================================================================

export async function harnessTurnRoute(app: FastifyInstance, options: HarnessTurnRouteOptions = {}) {
  const gameSessionStore = options.gameSessionStore ?? createInMemoryGameSessionStore();
  const anyStateTakeoverEnabled = env.aiLowRiskTakeoverEnabled
    || env.aiKnowledgeClueTakeoverEnabled
    || env.aiHighRiskTakeoverEnabled
    || env.aiLegacyMainPathExitEnabled;
  const lowRiskTakeoverService = options.lowRiskTakeoverService === undefined
    ? anyStateTakeoverEnabled
      ? createLowRiskTakeoverService({
          knowledgeClueTakeoverEnabled: env.aiKnowledgeClueTakeoverEnabled
            || env.aiHighRiskTakeoverEnabled
            || env.aiLegacyMainPathExitEnabled,
          highRiskTakeoverEnabled: env.aiHighRiskTakeoverEnabled
            || env.aiLegacyMainPathExitEnabled,
          legacyMainPathExitEnabled: env.aiLegacyMainPathExitEnabled,
        })
      : null
    : options.lowRiskTakeoverService;
  const shadowCoordinator = options.shadowCoordinator === undefined
    ? env.aiShadowRunEnabled || anyStateTakeoverEnabled
      ? createShadowRunCoordinator({
          deadlineMs: env.aiShadowDeadlineMs,
          compilerTimeoutMs: env.aiShadowCompilerTimeoutMs,
          mainFactAuthorizationMode: env.aiShadowMainFactAuthorizationMode,
        })
      : null
    : options.shadowCoordinator;
  const semanticPrefetchService = options.semanticPrefetchService === undefined
    ? env.aiSemanticPrefetchEnabled && shadowCoordinator
      ? createDefaultSemanticPrefetchService()
      : null
    : options.semanticPrefetchService;
  const highRiskTakeoverActive = lowRiskTakeoverService === null
    ? false
    : lowRiskTakeoverService?.highRiskTakeoverEnabled
      ?? (env.aiHighRiskTakeoverEnabled || env.aiLegacyMainPathExitEnabled);
  const legacyMainPathExitActive = lowRiskTakeoverService === null
    ? false
    : lowRiskTakeoverService?.legacyMainPathExitEnabled
      ?? env.aiLegacyMainPathExitEnabled;

  app.post('/api/harness/turn', async (request, reply) => {
    const requestStartedAt = performance.now();
    let cancelledSemanticPrefetchCount = 0;
    const body = request.body as {
      operation?: 'turn' | 'reset_loop';
      input?: string;
      state?: GameState;
      gameSessionId?: string;
      inputStateVersion?: number;
      recommendationId?: string;
    };
    const operation = body.operation ?? 'turn';
    if (operation !== 'turn' && operation !== 'reset_loop') {
      return reply.code(400).send({ error: 'invalid_operation' });
    }
    const input = body.input?.trim() ?? '';
    const bootstrapState = coerceGameState(body.state);
    const gameSessionId = body.gameSessionId?.trim() || `legacy-${randomUUID()}`;
    const recommendationId = body.recommendationId?.trim() || undefined;
    if (semanticPrefetchService && (!recommendationId || operation === 'reset_loop')) {
      cancelledSemanticPrefetchCount = semanticPrefetchService.cancelSession(
        gameSessionId,
        operation === 'reset_loop' ? 'loop_reset_submitted' : 'natural_language_submitted',
      );
    }

    // v3: 断案检测——管道前拦截
    const isAccusation = input.includes('指认') || input.includes('断案') || input.includes('真相') || input.includes('凶手是') || input.includes('赵鸿远');
    if (isAccusation && operation === 'turn' && canAccuse(bootstrapState)) {
      semanticPrefetchService?.cancelSession(gameSessionId, 'deduction_submitted');
      const deductionResult = validateDeductionClaims(bootstrapState, input);
      if (deductionResult.passed) {
        const ending = scoreEnding(bootstrapState);
        return reply.send({
          recap: generateRecap(bootstrapState), coreState: bootstrapState,
          time: minuteLabel(bootstrapState.minute), location: '青荷公寓 503 室',
          phase: bootstrapState.phase, ending, deduction: deductionResult,
          deductionResponse: buildDeductionResponse(deductionResult),
          storyLog: [], clues: bootstrapState.clues, audioCue: null, worldTickTrace: [],
          coordination: { warnings: [], trace: [], agentTiming: { totalMs: 0, slowest: null, entries: [] }, turnTiming: [], judgements: {} },
        });
      }
      return reply.send({
        recap: generateRecap(bootstrapState), coreState: bootstrapState,
        time: minuteLabel(bootstrapState.minute), location: '青荷公寓 503 室',
        phase: bootstrapState.phase, deduction: deductionResult,
        deductionPrompt: buildDeductionPrompt(bootstrapState),
        deductionResponse: buildDeductionResponse(deductionResult),
        epiphany: generateEpiphanyHint(bootstrapState, 1),
        storyLog: [], clues: bootstrapState.clues, audioCue: null, worldTickTrace: [],
        coordination: { warnings: [], trace: [], agentTiming: { totalMs: 0, slowest: null, entries: [] }, turnTiming: [], judgements: {} },
      });
    }

    const requestedStateVersion = body.inputStateVersion ?? 0;
    if (!Number.isInteger(requestedStateVersion) || requestedStateVersion < 0) {
      return reply.code(400).send({
        error: 'invalid_input_state_version',
        gameSessionId,
      });
    }
    const openedSession = gameSessionStore.open({
      gameSessionId,
      inputStateVersion: requestedStateVersion,
      bootstrapState,
    });
    if (openedSession.status === 'conflict') {
      return reply.code(409).send({
        error: 'state_version_conflict',
        gameSessionId,
        inputStateVersion: requestedStateVersion,
        authoritativeStateVersion: openedSession.authoritativeStateVersion,
        authoritativeLoopId: openedSession.authoritativeLoopId,
      });
    }
    let sessionLoopId = openedSession.loopId;
    let sessionStateVersion = openedSession.stateVersion;
    let outputStateVersion = sessionStateVersion;
    let turnCommittedToSession = false;
    const harnessOptions: HarnessOptions = {
      worldTick: 'enabled',
    };

    let state = openedSession.state;
    const isDeathState = state.phase === 'death' || state.ending === 'death';
    if (operation === 'reset_loop') {
      if (!isDeathState) {
        return reply.code(409).send({
          error: 'loop_reset_not_allowed',
          gameSessionId,
          inputStateVersion: sessionStateVersion,
          authoritativeLoopId: sessionLoopId,
          authoritativeStateVersion: sessionStateVersion,
        });
      }

      const nextLoopId = gameSessionLoopId(gameSessionId, state.run + 1);
      const preparedReset = prepareDeathLoopReset(state, {
        previousLoopId: sessionLoopId,
        nextLoopId,
        startingStateVersion: 0,
        nextRun: state.run + 1,
      });
      const resetOutcome = await atomicLoopReset({
        expectedLoopId: sessionLoopId,
        expectedStateVersion: sessionStateVersion,
        reset: preparedReset,
      }, openedSession.store);
      if (resetOutcome.status !== 'reset') {
        return reply.code(resetOutcome.status === 'conflict' ? 409 : 503).send({
          error: resetOutcome.status === 'conflict' ? 'state_version_conflict' : 'session_persistence_failed',
          gameSessionId,
          inputStateVersion: sessionStateVersion,
        });
      }

      state = preparedReset.state;
      sessionLoopId = nextLoopId;
      sessionStateVersion = 0;
      outputStateVersion = 0;

      const sidebar = await buildSidebarPayload(createAiHarness(harnessOptions), state);
      return {
        gameSessionId,
        inputStateVersion: requestedStateVersion,
        outputStateVersion,
        coreState: state,
        time: minuteLabel(state.minute),
        location: '青荷公寓 503 室',
        phase: state.phase,
        clues: toFrontendClues(state),
        audioCue: null,
        ending: state.ending,
        worldTickTrace: [],
        deathTitle: null,
        deathSummary: null,
        deathMethod: null,
        recap: generateRecap(state),
        sidebar,
        storyLog: [] satisfies FrontendStoryNode[],
        agentTrace: [],
        coordination: { warnings: [], trace: [], agentTiming: buildAgentTimingSummary([]), judgements: {} },
        loopReset: {
          status: resetOutcome.status,
          previousLoopId: resetOutcome.previousLoopId,
          nextLoopId: resetOutcome.nextLoopId,
          rebuildProjections: preparedReset.rebuildProjections,
          invalidatedWork: preparedReset.invalidatedWork,
        },
      };
    }

    if (isDeathState && input) {
      return reply.code(409).send({
        error: 'loop_reset_required',
        gameSessionId,
        inputStateVersion: sessionStateVersion,
        authoritativeLoopId: sessionLoopId,
        authoritativeStateVersion: sessionStateVersion,
      });
    }

    if (!input) {
      const sidebar = await buildSidebarPayload(createAiHarness(harnessOptions), state);
      return {
        gameSessionId,
        inputStateVersion: sessionStateVersion,
        outputStateVersion,
        coreState: state, time: minuteLabel(state.minute), location: '青荷公寓 503 室',
        phase: state.phase, clues: toFrontendClues(state),
        audioCue: null,
        ending: state.ending,
        worldTickTrace: [],
        deathTitle: null,
        deathSummary: null,
        deathMethod: null,
        recap: generateRecap(state),
        sidebar,
        storyLog: [] satisfies FrontendStoryNode[],
        agentTrace: [],
        coordination: { warnings: [], trace: [], agentTiming: buildAgentTimingSummary([]), judgements: {} },
      };
    }

    let semanticPrefetchClaim: SemanticPrefetchClaim | undefined;
    let semanticPrefetchWarning: string | undefined;
    if (recommendationId && semanticPrefetchService) {
      try {
        semanticPrefetchClaim = await semanticPrefetchService.claim({
          gameSessionId,
          loopId: sessionLoopId,
          stateVersion: sessionStateVersion,
          recommendationId,
          label: input,
        });
      } catch (error) {
        semanticPrefetchWarning = `Semantic prefetch claim failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const adapterBundle = options.createAiAdapters?.(input, state);
    const aiAdapters = adapterBundle?.aiAdapters ?? createAiHarnessAdapters();
    const harness = createHarness(aiAdapters, harnessOptions);
    const routeWarnings = [
      ...(adapterBundle?.coordination?.warnings ?? []),
      ...(semanticPrefetchWarning ? [semanticPrefetchWarning] : []),
    ];
    const routeJudgements = adapterBundle?.coordination?.judgements ?? {};
    const turnTimingEntries: TurnTimingEntry[] = [];
    let shadowTimingPromise: Promise<void> | undefined;

    let shadowSession: ShadowRunSession | undefined;
    if (shadowCoordinator) {
      try {
        shadowSession = shadowCoordinator.start({
          rawInput: input,
          state,
          loopId: sessionLoopId,
          inputStateVersion: sessionStateVersion,
          precompiledBrief: semanticPrefetchClaim?.brief,
        });
        shadowTimingPromise = shadowSession.wave.then((wave) => {
          if (wave.semantic && Number.isFinite(wave.semantic.durationMs)) {
            turnTimingEntries.push({
              stageId: 'semantic-compiler',
              durationMs: wave.semantic.durationMs,
              status: wave.semantic.status,
            });
          }
          for (const call of wave.callRecords ?? []) {
            if (!Number.isFinite(call.durationMs)) continue;
            turnTimingEntries.push({
              stageId: call.sourceAgent,
              durationMs: call.durationMs,
              status: call.status,
            });
          }
        }).catch((error) => {
          routeWarnings.push(`Shadow timing unavailable: ${error instanceof Error ? error.message : String(error)}`);
        });
      } catch (error) {
        routeWarnings.push(`Shadow Run start failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const recap = generateRecap(state);

    const beforeLen = state.log.length;
    const lowRiskTakeoverStartedAt = performance.now();
    const lowRiskTakeoverDuration = () => Math.round(performance.now() - lowRiskTakeoverStartedAt);
    let lowRiskTakeoverCoordination: Record<string, unknown> | undefined;
    let knowledgeClueTakeoverCoordination: Record<string, unknown> | undefined;
    let highRiskTakeoverCoordination: Record<string, unknown> | undefined;
    let legacyMainPathExitCoordination: Record<string, unknown> | undefined;
    let confirmedTurnNarration: ConfirmedTurnNarration | undefined;
    let minimumFallbackReason: string | undefined;
    let phaseSixBlockingFailure: {
      reason: string;
      fallbackMode: 'clarification_required' | 'formal_rejection';
    } | undefined;
    let resolution: TurnResolution | undefined;
    if (lowRiskTakeoverService && shadowSession) {
      try {
        const preparation = await lowRiskTakeoverService.prepare(shadowSession, state, {
          store: openedSession.store,
        });
        if (preparation.status === 'prepared') {
          const ruleCommitStartedAt = performance.now();
          resolution = legacyMainPathExitActive
            ? buildConfirmedAiFirstResolution({
                prepared: preparation.prepared,
                state: preparation.prepared.playerResult.state,
                displayFragments: [],
                publishedEventIds: new Set(),
                recommendedActions: preparation.recommendedActions,
              })
            : await resolveTurnHarnessFromPreparedPlayerTurn({
                state,
                input,
                plan: preparation.prepared.plan,
              playerResult: preparation.prepared.playerResult,
              }, harness, { deferTurnCompleted: true });

          let committed: Awaited<ReturnType<LowRiskTakeoverService['commit']>>;
          try {
            committed = await lowRiskTakeoverService.commit(
              shadowSession.envelope.turnId,
              legacyMainPathExitActive
                ? preparation.prepared.playerResult.state
                : resolution.finalState,
            );
          } catch (error) {
            lowRiskTakeoverService.discard(shadowSession.envelope.turnId);
            routeWarnings.push(`Low-risk takeover commit failed: ${error instanceof Error ? error.message : String(error)}`);
            if (shadowCoordinator) void shadowCoordinator.complete(shadowSession, resolution);
            return reply.code(503).send({
              error: 'low_risk_takeover_failed',
              coordination: {
                warnings: routeWarnings,
                lowRiskTakeover: {
                  status: 'failed',
                  reason: 'commit_exception',
                  durationMs: lowRiskTakeoverDuration(),
                },
                ...(highRiskTakeoverActive ? {
                  highRiskTakeover: {
                    status: 'failed',
                    reason: 'commit_exception',
                  },
                } : {}),
                shadowRun: { turnId: shadowSession.envelope.turnId, status: 'scheduled' },
              },
            });
          }

          if (committed.outcome.result.commitStatus !== 'committed' || !committed.state) {
            if (shadowCoordinator) void shadowCoordinator.complete(shadowSession, resolution);
            const conflict = committed.outcome.result.commitStatus === 'conflict';
            return reply.code(conflict ? 409 : 503).send({
              error: conflict ? 'low_risk_takeover_conflict' : 'low_risk_takeover_failed',
              coordination: {
                warnings: routeWarnings,
                lowRiskTakeover: {
                  status: committed.outcome.result.commitStatus,
                  reason: committed.outcome.discardReason,
                  turnId: shadowSession.envelope.turnId,
                  durationMs: lowRiskTakeoverDuration(),
                },
                ...(highRiskTakeoverActive ? {
                  highRiskTakeover: {
                    status: committed.outcome.result.commitStatus,
                    reason: committed.outcome.discardReason,
                  },
                } : {}),
                shadowRun: { turnId: shadowSession.envelope.turnId, status: 'scheduled' },
              },
            });
          }
          turnCommittedToSession = true;
          outputStateVersion = committed.outcome.result.outputStateVersion!;

          if (legacyMainPathExitActive) {
            const publishedEventIds = new Set(
              committed.highRiskProjection
                ? [
                    ...committed.highRiskProjection.acceptedEventIds,
                    ...committed.highRiskProjection.correctedEventIds,
                  ]
                : committed.outcome.result.confirmedEventIds,
            );
            resolution = buildConfirmedAiFirstResolution({
              prepared: preparation.prepared,
              state: committed.state,
              displayFragments: committed.outcome.displayFragments,
              publishedEventIds,
              recommendedActions: committed.recommendedActions,
            });
            legacyMainPathExitCoordination = {
              status: 'committed',
              storyNodeAuthority: 'material_only',
              keywordFallbackAuthority: 'disabled',
              minimumPlayableFallback: 'ai_unavailable_only',
            };
          } else {
            resolution = {
              ...resolution,
              recommendedActions: committed.recommendedActions,
              finalState: committed.state,
            };
          }
          lowRiskTakeoverCoordination = {
            status: 'committed',
            turnId: shadowSession.envelope.turnId,
            executionAuthorityId: preparation.prepared.executionAuthorityId,
            outputStateVersion: committed.outcome.result.outputStateVersion,
            confirmedEventCount: committed.outcome.confirmedEvents.length,
            durationMs: lowRiskTakeoverDuration(),
          };
          if (committed.knowledgeClueProjection) {
            knowledgeClueTakeoverCoordination = {
              status: 'committed',
              observationCount: committed.knowledgeClueProjection.addedObservationIds.length,
              knowledgeUpdateCount: committed.knowledgeClueProjection.addedKnowledgeFactIds.length,
              clueCount: committed.knowledgeClueProjection.addedClueIds.length,
              acceptedSpecialistClueCount:
                committed.knowledgeClueProjection.acceptedSpecialistClueIds?.length ?? 0,
              rejectedSpecialistClueCount:
                committed.knowledgeClueProjection.rejectedSpecialistClueIds?.length ?? 0,
              narratorClueAuthority: 'disabled',
            };
          }
          if (committed.highRiskProjection) {
            const publishedEventIds = new Set([
              ...committed.highRiskProjection.acceptedEventIds,
              ...committed.highRiskProjection.correctedEventIds,
            ]);
            const confirmedOutcomeText = committed.outcome.displayFragments
              .filter((fragment) => fragment.eventRefs.some((eventId) => publishedEventIds.has(eventId)))
              .map((fragment) => fragment.text)
              .join(' ');
            const actionNarration: Narration = {
              title: preparation.prepared.playerResult.title,
              text: preparation.prepared.playerResult.text,
            };
            const ambientNarration: Narration = {
              title: confirmedOutcomeText ? 'Confirmed world outcome' : 'No high-risk outcome confirmed',
              text: confirmedOutcomeText || 'No high-risk state change passed the deterministic gate.',
            };
            if (!legacyMainPathExitActive) {
              resolution = {
                ...resolution,
                finalState: committed.state,
                killerStrategy: {
                  id: `phase5.${shadowSession.envelope.turnId}`,
                  type: 'confirmed_shadow_result',
                  title: ambientNarration.title,
                  rationale: 'Only events accepted by the phase-five deterministic reducer are authoritative.',
                  visibleToPlayer: confirmedOutcomeText.length > 0,
                  risk: committed.highRiskProjection.highRiskDecisions.some((decision) => (
                    decision.decision === 'pass'
                  )) ? 'high' : 'low',
                },
                killerResult: {
                  title: ambientNarration.title,
                  text: ambientNarration.text,
                  tone: committed.state.ending === 'death'
                    ? 'death'
                    : confirmedOutcomeText
                      ? 'threat'
                      : 'neutral',
                  addedClues: [],
                  timePassed: 0,
                  threatDelta: 0,
                  events: [],
                  state: committed.state,
                },
                narration: actionNarration,
                actionNarration,
                ambientNarration,
                npcReply: null,
                recommendedActions: [],
                worldTickTrace: [],
              };
            }
            const decisions = committed.highRiskProjection.highRiskDecisions;
            highRiskTakeoverCoordination = {
              status: 'committed',
              acceptedEventCount: committed.highRiskProjection.acceptedEventIds.length,
              correctedEventCount: committed.highRiskProjection.correctedEventIds.length,
              deferredEventCount: committed.highRiskProjection.deferredEventIds.length,
              rejectedEventCount: committed.highRiskProjection.rejectedEventIds.length,
              passDecisionCount: decisions.filter((decision) => decision.decision === 'pass').length,
              deferDecisionCount: decisions.filter((decision) => decision.decision === 'defer').length,
              rejectDecisionCount: decisions.filter((decision) => decision.decision === 'reject').length,
              decisions,
              narratorHighRiskAuthority: 'disabled',
              legacyHighRiskAuthority: 'disabled',
            };
          }
          turnTimingEntries.push({
            stageId: 'rule-commit',
            durationMs: performance.now() - ruleCommitStartedAt,
          });
        } else {
          lowRiskTakeoverCoordination = {
            status: 'bypassed',
            reason: preparation.reason,
            durationMs: lowRiskTakeoverDuration(),
          };
          if (highRiskTakeoverActive) {
            highRiskTakeoverCoordination = {
              status: 'bypassed',
              reason: preparation.reason,
            };
          }
          if (legacyMainPathExitActive) {
            if (preparation.fallbackMode === 'ai_unavailable') {
              minimumFallbackReason = preparation.reason;
            } else {
              phaseSixBlockingFailure = {
                reason: preparation.reason,
                fallbackMode: preparation.fallbackMode,
              };
            }
          }
        }
      } catch (error) {
        lowRiskTakeoverService.discard(shadowSession.envelope.turnId);
        routeWarnings.push(`Low-risk takeover preparation failed: ${error instanceof Error ? error.message : String(error)}`);
        lowRiskTakeoverCoordination = {
          status: 'bypassed',
          reason: 'preparation_failed',
          durationMs: lowRiskTakeoverDuration(),
        };
        if (highRiskTakeoverActive) {
          highRiskTakeoverCoordination = {
            status: 'bypassed',
            reason: 'preparation_failed',
          };
        }
        if (legacyMainPathExitActive) {
          phaseSixBlockingFailure = {
            reason: 'preparation_failed',
            fallbackMode: 'formal_rejection',
          };
        }
      }
    } else if (lowRiskTakeoverService) {
      lowRiskTakeoverCoordination = {
        status: 'bypassed',
        reason: 'shadow_unavailable',
        durationMs: lowRiskTakeoverDuration(),
      };
      if (highRiskTakeoverActive) {
        highRiskTakeoverCoordination = {
          status: 'bypassed',
          reason: 'shadow_unavailable',
        };
      }
      if (legacyMainPathExitActive) minimumFallbackReason = 'shadow_unavailable';
    } else if (legacyMainPathExitActive) {
      minimumFallbackReason = 'takeover_service_unavailable';
    }

    if (!resolution && legacyMainPathExitActive && phaseSixBlockingFailure) {
      const clarification = phaseSixBlockingFailure.fallbackMode === 'clarification_required';
      return reply.code(clarification ? 422 : 503).send({
        error: clarification ? 'ai_first_clarification_required' : 'ai_first_turn_rejected',
        coordination: {
          warnings: routeWarnings,
          legacyMainPathExit: {
            status: 'not_committed',
            reason: phaseSixBlockingFailure.reason,
            fallbackMode: phaseSixBlockingFailure.fallbackMode,
            storyNodeAuthority: 'material_only',
            keywordFallbackAuthority: 'disabled',
            minimumPlayableFallback: 'ai_unavailable_only',
          },
          ...(shadowSession ? {
            shadowRun: { turnId: shadowSession.envelope.turnId, status: 'scheduled' as const },
          } : {}),
        },
      });
    }
    if (!resolution && legacyMainPathExitActive && minimumFallbackReason) {
      resolution = resolveMinimumPlayableTurn(state, input);
      legacyMainPathExitCoordination = {
        status: 'offline_fallback',
        reason: minimumFallbackReason,
        storyNodeAuthority: 'material_only',
        keywordFallbackAuthority: 'disabled',
        minimumPlayableFallback: 'ai_unavailable_only',
      };
    }
    if (!resolution) {
      const legacyResolutionStartedAt = performance.now();
      resolution = await resolveLegacyTurnHarness(state, input, harness);
      turnTimingEntries.push({
        stageId: 'legacy-resolution',
        durationMs: performance.now() - legacyResolutionStartedAt,
      });
    }
    if (!turnCommittedToSession) {
      const legacyCommitStartedAt = performance.now();
      const legacyTurnId = shadowSession?.envelope.turnId ?? `route-${randomUUID()}`;
      const legacyCommit = await openedSession.store.commitTurn({
        expectedLoopId: sessionLoopId,
        turnId: legacyTurnId,
        expectedInputStateVersion: sessionStateVersion,
        outputStateVersion: sessionStateVersion + 1,
        candidateState: resolution.finalState,
        confirmedEvents: [],
      });
      if (legacyCommit.status !== 'committed') {
        const conflict = legacyCommit.status === 'conflict';
        return reply.code(conflict ? 409 : 503).send({
          error: conflict ? 'state_version_conflict' : 'session_persistence_failed',
          gameSessionId,
          inputStateVersion: sessionStateVersion,
          ...(conflict ? { reason: legacyCommit.reason } : {}),
        });
      }
      turnCommittedToSession = true;
      outputStateVersion = sessionStateVersion + 1;
      turnTimingEntries.push({
        stageId: 'rule-commit',
        durationMs: performance.now() - legacyCommitStartedAt,
      });
    }
    if (legacyMainPathExitCoordination?.status === 'committed') {
      const narrationStartedAt = performance.now();
      confirmedTurnNarration = await narrateConfirmedTurn(resolution, aiAdapters);
      turnTimingEntries.push({
        stageId: 'confirmed-narration',
        durationMs: performance.now() - narrationStartedAt,
      });
      routeWarnings.push(...confirmedTurnNarration.warnings);
      if (
        confirmedTurnNarration.actionNarration
        || confirmedTurnNarration.ambientNarration
        || confirmedTurnNarration.npcReply
      ) {
        resolution = {
          ...resolution,
          narration: confirmedTurnNarration.actionNarration ?? resolution.narration,
          actionNarration: confirmedTurnNarration.actionNarration
            ?? resolution.actionNarration
            ?? resolution.narration,
          ambientNarration: confirmedTurnNarration.ambientNarration
            ?? resolution.ambientNarration,
          npcReply: confirmedTurnNarration.npcReply ?? resolution.npcReply,
        };
        legacyMainPathExitCoordination.storyNodeAuthority = 'confirmed_facts_narrator';
      }
    }
    if (shadowSession && shadowCoordinator) {
      void shadowCoordinator.complete(shadowSession, resolution);
    }

    if (highRiskTakeoverCoordination?.status !== 'committed') {
      routeWarnings.push(...applyNarrationOutcomeHints(
        resolution.finalState,
        resolution.plan,
        resolution.actionNarration,
        resolution.ambientNarration,
      ));
    }

    const visibleEntries = resolution.finalState.log.slice(beforeLen);
    if (lowRiskTakeoverCoordination?.status !== 'committed') {
      addTurnDynamicClues(resolution, visibleEntries);
    }

    // 并发启动回合后的非权威展示工作：audioCue 和 sidebar。

    const presentationStartedAt = performance.now();
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
    const [audioCue, sidebar] = await Promise.all([audioCuePromise, sidebarPromise]);
    turnTimingEntries.push({
      stageId: 'presentation',
      durationMs: performance.now() - presentationStartedAt,
    });
    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType, agentId: e.agentId, source: e.source, warnings: e.warnings, durationMs: e.durationMs,
    }));
    const agentTiming = buildAgentTimingSummary(trace);
    if (trace.some((entry) => entry.taskId !== 'TurnCompleted')) {
      const aggregateIndex = turnTimingEntries.findIndex((entry) => (
        entry.stageId === 'legacy-resolution'
      ));
      if (aggregateIndex >= 0) turnTimingEntries.splice(aggregateIndex, 1);
    }
    for (const entry of trace) {
      if (entry.taskId === 'TurnCompleted') continue;
      turnTimingEntries.push({
        stageId: `legacy-${entry.agentId}`,
        durationMs: entry.durationMs,
        status: entry.source,
      });
    }
    if (lowRiskTakeoverService && shadowTimingPromise) await shadowTimingPromise;
    const turnTiming = buildTurnTimingSummary(
      turnTimingEntries,
      performance.now() - requestStartedAt,
    );
    const agentTrace = harness.dispatcher.getAgentTrace();

    const materialNodes = visibleEntries.map(toFrontendNode);
    const presentedNodes = confirmedTurnNarration
      ? applyConfirmedTurnNarration(materialNodes, {
          turnId: shadowSession?.envelope.turnId ?? `turn-${resolution.finalState.log.length}`,
          timestamp: minuteLabel(resolution.finalState.minute),
          actionNarration: confirmedTurnNarration.actionNarration,
          ambientNarration: confirmedTurnNarration.ambientNarration,
        })
      : materialNodes;
    const storyLog = attachRecommendedActions(
      [
        { id: `input-${Date.now()}`, type: 'player_input', content: input },
        ...presentedNodes,
      ],
      resolution,
    );

    // v3: post-commit 知识激活 + 死亡路径
    const committedStateForPrefetch = resolution.finalState;
    const knowledgeResult = activatePlayerKnowledge(resolution.finalState);
    resolution = { ...resolution, finalState: knowledgeResult.state };
    const deathPath = shouldTriggerDeath(resolution.finalState) ? resolveDeathPath(resolution.finalState) : null;

    if (semanticPrefetchService && !resolution.finalState.ending) {
      const recommendations = [...storyLog]
        .reverse()
        .find((node) => node.recommendedActions?.length)
        ?.recommendedActions ?? [];
      if (recommendations.length > 0) {
        try {
          semanticPrefetchService.schedule({
            gameSessionId,
            loopId: sessionLoopId,
            stateVersion: outputStateVersion,
            state: committedStateForPrefetch,
            recommendations,
          });
        } catch (error) {
          routeWarnings.push(`Semantic prefetch scheduling failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return {
      gameSessionId,
      inputStateVersion: sessionStateVersion,
      outputStateVersion,
      recap,
      coreState: resolution.finalState, time: minuteLabel(resolution.finalState.minute),
      location: '青荷公寓 503 室', phase: resolution.finalState.phase,
      audioCue,
      clues: toFrontendClues(resolution.finalState), ending: resolution.finalState.ending,
      deathTitle: resolution.finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: resolution.finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod: null, score: resolution.finalState.score,
      deathPath: deathPath ?? null,
      worldTickTrace: resolution.worldTickTrace ?? [],
      storyLog: storyLog satisfies FrontendStoryNode[],
      turn: {
        plan: resolution.plan,
        killerStrategy: resolution.killerStrategy,
        actionNarration: resolution.actionNarration ?? resolution.narration,
        ambientNarration: resolution.ambientNarration ?? null,
        npcReply: resolution.npcReply ?? null,
      },
      agentTrace,
      coordination: {
        warnings: [...routeWarnings, ...trace.flatMap(t => t.warnings)],
        trace,
        agentTiming,
        turnTiming,
        judgements: routeJudgements,
        ...(shadowSession ? {
          shadowRun: { turnId: shadowSession.envelope.turnId, status: 'scheduled' as const },
        } : {}),
        ...(lowRiskTakeoverCoordination ? { lowRiskTakeover: lowRiskTakeoverCoordination } : {}),
        ...(knowledgeClueTakeoverCoordination ? {
          knowledgeClueTakeover: knowledgeClueTakeoverCoordination,
        } : {}),
        ...(highRiskTakeoverCoordination ? {
          highRiskTakeover: highRiskTakeoverCoordination,
        } : {}),
        ...(legacyMainPathExitCoordination ? {
          legacyMainPathExit: legacyMainPathExitCoordination,
        } : {}),
        ...(semanticPrefetchService ? {
          semanticPrefetch: {
            status: semanticPrefetchClaim?.status
              ?? (recommendationId
                ? 'miss'
                : cancelledSemanticPrefetchCount > 0
                  ? 'cancelled'
                  : 'standard'),
            ...(semanticPrefetchClaim?.savedCompilerMs === undefined
              ? {}
              : { savedCompilerMs: semanticPrefetchClaim.savedCompilerMs }),
            ...(cancelledSemanticPrefetchCount > 0
              ? { cancelledCount: cancelledSemanticPrefetchCount }
              : {}),
            metrics: semanticPrefetchService.metrics(),
          },
        } : {}),
      },
      sidebar,
    };
  });
}

function createDefaultSemanticPrefetchService(): SemanticPrefetchService {
  const semanticCompiler = createAiShadowAdapters().semanticCompiler;
  return createSemanticPrefetchService({
    ttlMs: env.aiSemanticPrefetchTtlMs,
    compile: async ({ state, recommendation, envelope, signal }) => {
      const result = await compileShadowTurnBrief({
        state,
        rawInput: recommendation.label,
        envelope,
        semanticCompiler,
        npcIds: ['lin_yue', 'police_dispatch'],
        compilerTimeoutMs: env.aiShadowCompilerTimeoutMs,
        signal,
      });
      return {
        brief: result.brief,
        durationMs: result.record.durationMs,
      };
    },
  });
}
