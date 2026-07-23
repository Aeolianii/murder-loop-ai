import {
  ProposalSchema,
  SemanticCompilerResultSchema,
  SpecialistCandidateSchema,
  WORLD_MODEL_SCHEMA_VERSION,
  type CompactPlayerContext,
  type Fact,
  type Proposal,
  type ProposalDomain,
  type ProposedEvent,
  type SemanticCompilerRequest,
  type SpecialistCandidate,
  type TurnBrief,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import type { ActionPlan, GameState } from '@murder-loop-ai/shared';
import type { TurnFreshnessSnapshot } from '../commit/atomicTurnCommit';
import { buildFactLedgerFromGameState, buildKnowledgeProjections, type KnowledgeProjections } from '../facts/knowledgeProjection';
import { projectTurnIntent, type ConditionalIntentSignal, type IntentProjections } from '../intent/IntentProjector';
import { canonicalStoryMaterial } from '../storyMaterial/canonicalStoryMaterial';
import { supportedSpecialistClueDefinitions } from '../takeover/knowledgeClueTakeover';
import { validateTurnBrief, type SemanticCompiler } from '../intent/turnBriefValidator';
import {
  buildShadowArbitrationMetrics,
  compareShadowWithLegacy,
  runShadowArbiter,
  simulateShadowCommit,
  type LegacyEventSnapshot,
  type ShadowArbiterReport,
  type ShadowArbitrationMetrics,
  type ShadowDifferenceReport,
  type ShadowFactAuthorizationMode,
  type ShadowSourcePolicy,
} from './shadowArbiter';
import type { SimulatedShadowCommit } from './shadowArbiter';

const REQUIRED_SHADOW_DOMAINS: ProposalDomain[] = [
  'player',
  'killer',
  'npc',
  'environment',
  'clue',
  'recommendation',
];

export interface ShadowGenerationContext {
  envelope: TurnEnvelope;
  signal: AbortSignal;
}

export type ShadowCandidateAdapter = (
  projection: unknown,
  context: ShadowGenerationContext,
) => Promise<unknown>;

export interface ShadowSpecialistRegistration {
  id: string;
  domain: ProposalDomain;
  npcId?: string;
  generate: ShadowCandidateAdapter;
}

export interface ShadowRunAdapters {
  semanticCompiler: SemanticCompiler;
  mainWorldModel: ShadowCandidateAdapter;
  specialists: ShadowSpecialistRegistration[];
}

export type ShadowCallStatus = 'completed' | 'partial' | 'schema_invalid' | 'failed' | 'timed_out';

export interface ShadowCandidateCallRecord {
  sourceAgent: string;
  domain: ProposalDomain | 'world_model';
  status: ShadowCallStatus;
  durationMs: number;
  receivedCount: number;
  schemaValidCount: number;
  errors: string[];
}

export interface ShadowSemanticRecord {
  status: 'compiled' | 'clarification_required' | 'fallback_to_world_model' | 'schema_invalid' | 'timed_out' | 'failed';
  durationMs: number;
  issues: string[];
}

export interface ShadowCandidateWave {
  status: 'completed' | 'compiler_unavailable' | 'non_action';
  envelope: TurnEnvelope;
  semantic: ShadowSemanticRecord;
  turnBrief?: TurnBrief;
  mainProposals: Proposal[];
  specialistCandidates: SpecialistCandidate[];
  callRecords: ShadowCandidateCallRecord[];
  arbitration?: ShadowArbiterReport;
  completedAt: Date;
}

export interface RunShadowCandidateWaveInput {
  state: GameState;
  rawInput: string;
  envelope: TurnEnvelope;
  precompiledBrief?: TurnBrief;
  signal?: AbortSignal;
  adapters: ShadowRunAdapters;
  npcIds: string[];
  canonicalConstraints: string[];
  compilerTimeoutMs?: number;
  mainFactAuthorizationMode?: ShadowFactAuthorizationMode;
}

export interface CompileShadowTurnBriefInput {
  state: GameState;
  rawInput: string;
  envelope: TurnEnvelope;
  semanticCompiler: SemanticCompiler;
  npcIds: string[];
  compilerTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ShadowSemanticCompilation {
  record: ShadowSemanticRecord;
  brief?: TurnBrief;
}

export interface SemanticDifference {
  kind: 'action_count' | 'operation' | 'target' | 'constraint';
  index?: number;
  legacy?: string;
  shadow?: string;
  explanation: string;
}

export interface SemanticComparison {
  equivalent: boolean;
  differences: SemanticDifference[];
}

export interface ShadowRunMetrics extends ShadowArbitrationMetrics {
  semanticEquivalent: boolean;
  compilerDurationMs: number;
  secondWaveDurationMs: number;
  timedOutCallCount: number;
}

export interface ShadowRunReport {
  semanticComparison: SemanticComparison;
  differences: ShadowDifferenceReport;
  simulatedCommit: SimulatedShadowCommit;
  metrics: ShadowRunMetrics;
  replay: {
    envelope: TurnEnvelope;
    semantic: ShadowSemanticRecord;
    turnBrief: TurnBrief;
    mainProposals: Proposal[];
    specialistCandidates: SpecialistCandidate[];
    callRecords: ShadowCandidateCallRecord[];
    arbitration: ShadowArbiterReport;
    legacyPlan: ActionPlan;
    legacyEvents: LegacyEventSnapshot[];
    current: TurnFreshnessSnapshot;
    completedAt: string;
  };
}

export interface FinalizeShadowRunInput {
  wave: ShadowCandidateWave;
  legacyPlan: ActionPlan;
  legacyEvents: LegacyEventSnapshot[];
  current: TurnFreshnessSnapshot;
}

export async function runShadowCandidateWave(
  input: RunShadowCandidateWaveInput,
): Promise<ShadowCandidateWave> {
  const ledger = buildFactLedgerFromGameState(input.state, {
    loopId: input.envelope.loopId,
    turnId: input.envelope.turnId,
    stateVersion: input.envelope.inputStateVersion,
  });
  const knowledge = buildKnowledgeProjections(ledger, input.npcIds);
  const compilerRequest: SemanticCompilerRequest = {
    ...input.envelope,
    rawInput: input.rawInput,
    playerContext: buildCompactPlayerContext(input.state, knowledge),
  };
  const prefetched = input.precompiledBrief
    ? validatePrecompiledBrief(input.precompiledBrief, input.envelope, compilerRequest)
    : undefined;
  const compiler = prefetched ?? await runCompiler(
    input.adapters.semanticCompiler,
    compilerRequest,
    compilerTimeout(input.compilerTimeoutMs, input.envelope),
    input.signal,
  );

  if (!compiler.brief && compiler.record.status === 'clarification_required') {
    return {
      status: 'compiler_unavailable',
      envelope: input.envelope,
      semantic: compiler.record,
      mainProposals: [],
      specialistCandidates: [],
      callRecords: [],
      completedAt: new Date(),
    };
  }

  if (compiler.brief?.utteranceMode === 'non_action') {
    return {
      status: 'non_action',
      envelope: input.envelope,
      semantic: compiler.record,
      turnBrief: compiler.brief,
      mainProposals: [],
      specialistCandidates: [],
      callRecords: [],
      completedAt: new Date(),
    };
  }

  const turnBrief = compiler.brief ?? buildCompilerFallbackBrief(input.envelope);
  const compilerFallback = !compiler.brief;
  const storyMaterial = canonicalStoryMaterial();

  const intentProjections = projectTurnIntent({
    brief: turnBrief,
    knowledge,
    canonicalConstraints: input.canonicalConstraints,
    canonicalStoryMaterial: storyMaterial,
    conditionalSignals: compilerFallback ? [] : buildConditionalSignals(turnBrief),
  });
  const controller = new AbortController();
  const cancelFromCaller = () => controller.abort(input.signal?.reason ?? 'shadow_cancelled');
  if (input.signal?.aborted) cancelFromCaller();
  else input.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  const deadlineMs = Date.parse(input.envelope.deadlineAt);
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const deadlineTimer = setTimeout(() => controller.abort('shadow_hard_deadline'), remainingMs);
  const secondWaveStartedAt = Date.now();

  const mainCall = runCandidateCall({
    sourceAgent: 'main-world-model',
    domain: 'world_model',
    projection: compilerFallback
      ? {
          ...intentProjections.mainWorldModel,
          fallbackMode: 'raw_input',
          rawInput: input.rawInput,
        }
      : intentProjections.mainWorldModel,
    adapter: input.adapters.mainWorldModel,
    envelope: input.envelope,
    signal: controller.signal,
    specialist: false,
  });
  const specialistCalls = input.adapters.specialists.map((registration) => {
    const projection = projectionFor(registration, intentProjections);
    return runCandidateCall({
      sourceAgent: registration.id,
      domain: registration.domain,
      projection,
      adapter: registration.generate,
      envelope: input.envelope,
      signal: controller.signal,
      specialist: true,
    });
  });

  const [mainResult, ...specialistResults] = await Promise.all([mainCall, ...specialistCalls]);
  clearTimeout(deadlineTimer);
  input.signal?.removeEventListener('abort', cancelFromCaller);
  const completedAt = new Date();
  const mainProposals = mainResult.proposals;
  const specialistCandidates = specialistResults.flatMap((result) => result.candidates);
  const callRecords = [mainResult.record, ...specialistResults.map((result) => result.record)];
  const sourcePolicies = buildSourcePolicies(
    knowledge,
    intentProjections,
    input.adapters.specialists,
    input.mainFactAuthorizationMode ?? 'strict',
  );
  const arbitration = runShadowArbiter({
    envelope: input.envelope,
    compilerVersion: turnBrief.compilerVersion,
    schemaVersion: turnBrief.schemaVersion,
    mainProposals,
    specialistCandidates,
    requiredDomains: REQUIRED_SHADOW_DOMAINS,
    requiredActionIdsByDomain: {
      player: turnBrief.orderedActions.map((action) => action.actionId),
    },
    sourcePolicies,
    availableEvidenceRefs: [
      ...knowledge.worldModel.factIds,
      ...input.canonicalConstraints,
    ],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  return {
    status: 'completed',
    envelope: input.envelope,
    semantic: compiler.record,
    turnBrief,
    mainProposals,
    specialistCandidates,
    callRecords: callRecords.map((record) => ({
      ...record,
      durationMs: Math.min(record.durationMs, Math.max(0, completedAt.getTime() - secondWaveStartedAt)),
    })),
    arbitration,
    completedAt,
  };
}

export async function compileShadowTurnBrief(
  input: CompileShadowTurnBriefInput,
): Promise<ShadowSemanticCompilation> {
  const ledger = buildFactLedgerFromGameState(input.state, {
    loopId: input.envelope.loopId,
    turnId: input.envelope.turnId,
    stateVersion: input.envelope.inputStateVersion,
  });
  const knowledge = buildKnowledgeProjections(ledger, input.npcIds);
  const request: SemanticCompilerRequest = {
    ...input.envelope,
    rawInput: input.rawInput,
    playerContext: buildCompactPlayerContext(input.state, knowledge),
  };
  return runCompiler(
    input.semanticCompiler,
    request,
    compilerTimeout(input.compilerTimeoutMs, input.envelope),
    input.signal,
  );
}

export function finalizeShadowRun(input: FinalizeShadowRunInput): ShadowRunReport {
  if (!input.wave.turnBrief || !input.wave.arbitration) {
    throw new Error('Cannot finalize a Shadow run without a compiled TurnBrief and arbitration report.');
  }
  const semanticComparison = compareTurnBriefWithLegacyPlan(input.wave.turnBrief, input.legacyPlan);
  const differences = compareShadowWithLegacy(input.wave.arbitration, input.legacyEvents);
  const simulatedCommit = simulateShadowCommit({
    envelope: input.wave.envelope,
    transition: input.wave.arbitration.transition,
    highRiskDecisions: input.wave.arbitration.highRiskDecisions,
    current: input.current,
    completedAt: input.wave.completedAt,
  });
  const schemaAttempts = 1 + input.wave.callRecords.length;
  const compilerSchemaSuccess = ['compiled', 'clarification_required', 'fallback_to_world_model']
    .includes(input.wave.semantic.status) ? 1 : 0;
  const schemaSuccesses = compilerSchemaSuccess + input.wave.callRecords.filter((record) => (
    record.status === 'completed' || record.status === 'partial'
  )).length;
  const arbitrationMetrics = buildShadowArbitrationMetrics(
    input.wave.arbitration,
    schemaAttempts,
    schemaSuccesses,
  );

  return {
    semanticComparison,
    differences,
    simulatedCommit,
    metrics: {
      ...arbitrationMetrics,
      semanticEquivalent: semanticComparison.equivalent,
      compilerDurationMs: input.wave.semantic.durationMs,
      secondWaveDurationMs: Math.max(
        0,
        ...input.wave.callRecords.map((record) => record.durationMs),
      ),
      timedOutCallCount: input.wave.callRecords.filter((record) => record.status === 'timed_out').length,
    },
    replay: {
      envelope: input.wave.envelope,
      semantic: input.wave.semantic,
      turnBrief: input.wave.turnBrief,
      mainProposals: input.wave.mainProposals,
      specialistCandidates: input.wave.specialistCandidates,
      callRecords: input.wave.callRecords,
      arbitration: input.wave.arbitration,
      legacyPlan: input.legacyPlan,
      legacyEvents: input.legacyEvents,
      current: {
        ...input.current,
        committedTurnIds: [...input.current.committedTurnIds],
      },
      completedAt: input.wave.completedAt.toISOString(),
    },
  };
}

function buildCompilerFallbackBrief(envelope: TurnEnvelope): TurnBrief {
  return {
    ...envelope,
    compilerVersion: 'semantic-compiler-fallback-v1',
    schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

export function compareTurnBriefWithLegacyPlan(
  brief: TurnBrief,
  legacyPlan: ActionPlan,
): SemanticComparison {
  const differences: SemanticDifference[] = [];
  if (brief.orderedActions.length !== legacyPlan.actions.length) {
    differences.push({
      kind: 'action_count',
      legacy: String(legacyPlan.actions.length),
      shadow: String(brief.orderedActions.length),
      explanation: 'Semantic Compiler and legacy Parser produced different atomic action counts.',
    });
  }
  const count = Math.min(brief.orderedActions.length, legacyPlan.actions.length);
  for (let index = 0; index < count; index += 1) {
    const shadowAction = brief.orderedActions[index];
    const legacyAction = legacyPlan.actions[index];
    if (shadowAction.operation !== legacyAction.intent) {
      differences.push({
        kind: 'operation',
        index,
        legacy: legacyAction.intent,
        shadow: shadowAction.operation,
        explanation: `Action ${index + 1} has a different operation in the two semantic representations.`,
      });
    }
    if (!shadowAction.targetIds.includes(legacyAction.target)) {
      differences.push({
        kind: 'target',
        index,
        legacy: legacyAction.target,
        shadow: shadowAction.targetIds.join(','),
        explanation: `Action ${index + 1} resolves to a different target set.`,
      });
    }
  }
  if (brief.globalConstraints.length + brief.scopedConstraints.length > 0) {
    differences.push({
      kind: 'constraint',
      legacy: 'unstructured',
      shadow: String(brief.globalConstraints.length + brief.scopedConstraints.length),
      explanation: 'TurnBrief preserves explicit constraints that the legacy ActionPlan cannot represent structurally.',
    });
  }
  return { equivalent: differences.length === 0, differences };
}

function buildCompactPlayerContext(
  state: GameState,
  knowledge: KnowledgeProjections,
): CompactPlayerContext {
  const entityAliasIndex: Record<string, string[]> = {};
  for (const roomObject of Object.values(state.room)) {
    entityAliasIndex[roomObject.id] = [roomObject.id];
    entityAliasIndex[roomObject.name] = [roomObject.id];
  }
  return {
    facts: knowledge.player.facts,
    accessibleEntityIds: [...new Set([
      'player',
      ...knowledge.player.facts.map((fact) => fact.subject),
      ...Object.values(state.room).filter((item) => item.visible).map((item) => item.id),
    ])],
    capabilities: [
      'act',
      'inspect',
      'communicate',
      'secure_entry',
      'wait',
      ...(state.phoneFunctional ? ['photograph', 'record'] : []),
    ],
    activeCommunicationActorIds: ['lin_yue', 'police_dispatch', 'chen_huaimin'],
    recentConfirmedEventIds: (state.world?.events ?? []).slice(-5).map((event) => event.id),
    entityAliasIndex,
    recentReferenceCandidates: [],
    phaseSummary: `${state.phase} at minute ${state.minute}`,
  };
}

function buildConditionalSignals(brief: TurnBrief): ConditionalIntentSignal[] {
  return brief.candidateHandles.flatMap((handle) => [
    {
      id: `signal.clue.${handle.id}`,
      domain: 'clue' as const,
      visibleTo: ['clue'],
      prerequisiteEventIds: [`event.action_confirmed.${handle.producedByActionId}`],
      signalType: 'candidate_handle_confirmed',
      subjectId: handle.id,
      candidateHandleIds: [handle.id],
    },
    {
      id: `signal.recommendation.${handle.id}`,
      domain: 'recommendation' as const,
      visibleTo: ['recommendation'],
      prerequisiteEventIds: [`event.action_confirmed.${handle.producedByActionId}`],
      signalType: 'candidate_handle_confirmed',
      subjectId: handle.id,
      candidateHandleIds: [handle.id],
    },
  ]);
}

async function runCompiler(
  compiler: SemanticCompiler,
  request: SemanticCompilerRequest,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<ShadowSemanticCompilation> {
  const startedAt = Date.now();
  if (externalSignal?.aborted) {
    return {
      record: {
        status: 'failed',
        durationMs: 0,
        issues: ['semantic_compiler_cancelled'],
      },
    };
  }
  const controller = new AbortController();
  const timeout = Math.max(0, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort('semantic_compiler_timeout');
      resolve({ kind: 'timeout' });
    }, timeout);
  });
  let resolveCancelled!: (value: { kind: 'cancelled' }) => void;
  const cancelled = new Promise<{ kind: 'cancelled' }>((resolve) => {
    resolveCancelled = resolve;
  });
  const cancelFromCaller = () => {
    controller.abort(externalSignal?.reason ?? 'semantic_compiler_cancelled');
    resolveCancelled({ kind: 'cancelled' });
  };
  externalSignal?.addEventListener('abort', cancelFromCaller, { once: true });
  const execution = Promise.resolve()
    .then(() => compiler.compile(request, { signal: controller.signal }))
    .then((value) => ({ kind: 'value' as const, value }))
    .catch((error: unknown) => ({ kind: 'error' as const, error }));
  const outcome = await Promise.race([execution, timedOut, cancelled]);
  if (timer) clearTimeout(timer);
  externalSignal?.removeEventListener('abort', cancelFromCaller);
  const durationMs = Date.now() - startedAt;

  if (outcome.kind === 'timeout') {
    return { record: { status: 'timed_out', durationMs, issues: ['semantic_compiler_timeout'] } };
  }
  if (outcome.kind === 'cancelled') {
    return { record: { status: 'failed', durationMs, issues: ['semantic_compiler_cancelled'] } };
  }
  if (outcome.kind === 'error') {
    return {
      record: {
        status: 'failed',
        durationMs,
        issues: [outcome.error instanceof Error ? outcome.error.message : String(outcome.error)],
      },
    };
  }

  const parsed = SemanticCompilerResultSchema.safeParse(outcome.value);
  if (!parsed.success) {
    return {
      record: {
        status: 'schema_invalid',
        durationMs,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
    };
  }
  if (parsed.data.status !== 'compiled') {
    return {
      record: {
        status: parsed.data.status,
        durationMs,
        issues: parsed.data.status === 'clarification_required'
          ? parsed.data.questions
          : [parsed.data.reasonCode],
      },
    };
  }
  const validation = validateTurnBrief(parsed.data.brief, request);
  if (!validation.valid || !validation.brief) {
    return {
      record: { status: 'schema_invalid', durationMs, issues: validation.issues },
    };
  }
  return {
    record: { status: 'compiled', durationMs, issues: [] },
    brief: validation.brief,
  };
}

function validatePrecompiledBrief(
  brief: TurnBrief,
  envelope: TurnEnvelope,
  request: SemanticCompilerRequest,
): ShadowSemanticCompilation | undefined {
  const rebound = { ...brief, ...envelope };
  const validation = validateTurnBrief(rebound, request);
  if (!validation.valid || !validation.brief) return undefined;
  return {
    record: {
      status: 'compiled',
      durationMs: 0,
      issues: ['semantic_prefetch_hit'],
    },
    brief: validation.brief,
  };
}

function compilerTimeout(timeoutMs: number | undefined, envelope: TurnEnvelope): number {
  return Math.min(
    timeoutMs ?? 1_000,
    Math.max(0, Date.parse(envelope.deadlineAt) - Date.now()),
  );
}

async function runCandidateCall(input: {
  sourceAgent: string;
  domain: ProposalDomain | 'world_model';
  projection: unknown;
  adapter: ShadowCandidateAdapter;
  envelope: TurnEnvelope;
  signal: AbortSignal;
  specialist: boolean;
}): Promise<{
  record: ShadowCandidateCallRecord;
  proposals: Proposal[];
  candidates: SpecialistCandidate[];
}> {
  const startedAt = Date.now();
  const aborted = new Promise<{ kind: 'timeout' }>((resolve) => {
    if (input.signal.aborted) resolve({ kind: 'timeout' });
    else input.signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true });
  });
  const execution = Promise.resolve()
    .then(() => input.adapter(input.projection, { envelope: input.envelope, signal: input.signal }))
    .then((value) => ({ kind: 'value' as const, value }))
    .catch((error: unknown) => ({ kind: 'error' as const, error }));
  const outcome = await Promise.race([execution, aborted]);
  const durationMs = Date.now() - startedAt;
  const empty = { proposals: [] as Proposal[], candidates: [] as SpecialistCandidate[] };

  if (outcome.kind === 'timeout') {
    return {
      ...empty,
      record: {
        sourceAgent: input.sourceAgent,
        domain: input.domain,
        status: 'timed_out',
        durationMs,
        receivedCount: 0,
        schemaValidCount: 0,
        errors: ['shadow_hard_deadline'],
      },
    };
  }
  if (outcome.kind === 'error') {
    return {
      ...empty,
      record: {
        sourceAgent: input.sourceAgent,
        domain: input.domain,
        status: 'failed',
        durationMs,
        receivedCount: 0,
        schemaValidCount: 0,
        errors: [outcome.error instanceof Error ? outcome.error.message : String(outcome.error)],
      },
    };
  }

  const rawItems = extractCandidateArray(outcome.value, input.specialist ? 'candidates' : 'proposals');
  const valid: Array<Proposal | SpecialistCandidate> = [];
  const errors: string[] = [];
  const schema = input.specialist ? SpecialistCandidateSchema : ProposalSchema;
  for (const [index, item] of rawItems.entries()) {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      errors.push(`item ${index}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      continue;
    }
    if (parsed.data.sourceAgent !== input.sourceAgent) {
      errors.push(`item ${index}: sourceAgent mismatch`);
      continue;
    }
    if (input.specialist && parsed.data.domain !== input.domain) {
      errors.push(`item ${index}: specialist domain mismatch`);
      continue;
    }
    valid.push(completeMissingDisplayClaimRefs(parsed.data));
  }
  if (rawItems.length === 0) errors.push(`response did not contain a non-empty ${input.specialist ? 'candidates' : 'proposals'} array`);
  const status: ShadowCallStatus = rawItems.length === 0
    ? 'schema_invalid'
    : valid.length === rawItems.length
      ? 'completed'
      : valid.length > 0
        ? 'partial'
        : 'schema_invalid';

  return {
    record: {
      sourceAgent: input.sourceAgent,
      domain: input.domain,
      status,
      durationMs,
      receivedCount: rawItems.length,
      schemaValidCount: valid.length,
      errors,
    },
    proposals: input.specialist ? [] : valid as Proposal[],
    candidates: input.specialist ? valid as SpecialistCandidate[] : [],
  };
}

function extractCandidateArray(value: unknown, key: 'proposals' | 'candidates'): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function completeMissingDisplayClaimRefs(
  candidate: Proposal | SpecialistCandidate,
): Proposal | SpecialistCandidate {
  const eventsById = new Map(
    candidate.proposedEvents.map((event) => [event.id, event]),
  );
  let changed = false;
  const displayFragments = candidate.displayFragments.map((fragment) => {
    if (fragment.claimRefs.length > 0 || fragment.eventRefs.length === 0) {
      return fragment;
    }

    const referencedEvents = fragment.eventRefs
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is ProposedEvent => Boolean(event));
    if (referencedEvents.length !== fragment.eventRefs.length) return fragment;

    const claimRefs = [...new Set(referencedEvents.flatMap((event) => {
      const eventIsVisible = event.visibility.includes('player')
        || event.visibility.includes('public');
      if (!eventIsVisible) return [];
      return event.assertions
        .filter((assertion) => (
          assertion.visibleTo.includes('player')
          || assertion.visibleTo.includes('public')
        ))
        .map((assertion) => assertion.id);
    }))];
    if (claimRefs.length === 0) return fragment;

    changed = true;
    return { ...fragment, claimRefs };
  });

  return changed ? { ...candidate, displayFragments } : candidate;
}

function projectionFor(
  registration: ShadowSpecialistRegistration,
  projections: IntentProjections,
): unknown {
  if (registration.domain === 'player') return projections.playerSpecialist;
  if (registration.domain === 'killer') return projections.killerSpecialist;
  if (registration.domain === 'npc') {
    return registration.npcId ? projections.npcSpecialists[registration.npcId] : undefined;
  }
  if (registration.domain === 'environment') return projections.environmentSpecialist;
  if (registration.domain === 'clue') {
    return {
      ...projections.clueSpecialist,
      clueDefinitions: supportedSpecialistClueDefinitions(),
    };
  }
  if (registration.domain === 'recommendation') return projections.recommendationSpecialist;
  return projections.mainWorldModel;
}

function buildSourcePolicies(
  knowledge: KnowledgeProjections,
  projections: IntentProjections,
  specialists: ShadowSpecialistRegistration[],
  mainFactAuthorizationMode: ShadowFactAuthorizationMode,
): Record<string, ShadowSourcePolicy> {
  const authorizedFactIdsByActor: Record<string, string[]> = {};
  const authorizedOperationsByActor: Record<string, string[]> = {};
  const registerActorProjection = (
    viewerId: string,
    projection: { facts: Fact[]; factIds: string[] },
  ) => {
    const actorIds = new Set([
      viewerId,
      ...projection.facts
        .filter((fact) => fact.predicate === 'capability')
        .map((fact) => fact.subject),
    ]);
    for (const actorId of actorIds) {
      authorizedFactIdsByActor[actorId] = projection.factIds;
      authorizedOperationsByActor[actorId] = capabilityOperations(projection.facts);
    }
  };
  registerActorProjection('player', projections.playerSpecialist);
  registerActorProjection('killer', projections.killerSpecialist);
  for (const [npcId, projection] of Object.entries(projections.npcSpecialists)) {
    registerActorProjection(npcId, projection);
  }

  const policies: Record<string, ShadowSourcePolicy> = {
    'main-world-model': {
      allowedDomains: [...REQUIRED_SHADOW_DOMAINS, 'world'],
      authorizedFactIds: knowledge.worldModel.factIds,
      authorizedOperations: capabilityOperations(knowledge.worldModel.facts),
      authorizedFactIdsByDomain: {
        player: projections.playerSpecialist.factIds,
        killer: projections.killerSpecialist.factIds,
        npc: [...new Set(Object.values(projections.npcSpecialists).flatMap((projection) => projection.factIds))],
        environment: projections.environmentSpecialist.factIds,
        clue: projections.clueSpecialist.factIds,
        recommendation: projections.recommendationSpecialist.factIds,
        world: knowledge.worldModel.factIds,
      },
      authorizedOperationsByDomain: {
        player: capabilityOperations(projections.playerSpecialist.facts),
        killer: capabilityOperations(projections.killerSpecialist.facts),
        npc: [...new Set(Object.values(projections.npcSpecialists).flatMap((projection) => (
          capabilityOperations(projection.facts)
        )))],
        environment: capabilityOperations(projections.environmentSpecialist.facts),
        clue: capabilityOperations(projections.clueSpecialist.facts),
        recommendation: capabilityOperations(projections.recommendationSpecialist.facts),
        world: capabilityOperations(knowledge.worldModel.facts),
      },
      authorizedFactIdsByActor,
      authorizedOperationsByActor,
      enforceCapabilityChecks: true,
      factAuthorizationMode: mainFactAuthorizationMode,
    },
  };
  for (const registration of specialists) {
    const projection = projectionFor(registration, projections) as { factIds?: string[] } | undefined;
    policies[registration.id] = {
      allowedDomains: [registration.domain],
      authorizedFactIds: projection?.factIds ?? [],
      authorizedOperations: capabilityOperations(
        (projection as { facts?: Fact[] } | undefined)?.facts ?? [],
      ),
      enforceCapabilityChecks: true,
    };
  }
  return policies;
}

function capabilityOperations(facts: Fact[]): string[] {
  return [...new Set(facts.flatMap((fact) => (
    fact.predicate === 'capability' && typeof fact.value === 'string'
      ? [fact.value]
      : []
  )))];
}
