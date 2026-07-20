import { isDeepStrictEqual } from 'node:util';
import type {
  DisplayFragment,
  Fact,
  HighRiskDecision,
  Proposal,
  SpecialistCandidate,
} from '@murder-loop-ai/ai-contracts';
import {
  InMemoryAtomicTurnStore,
  buildFactLedgerFromGameState,
  commitPreparedLowRiskTurn,
  projectConfirmedKnowledgeAndClues,
  projectConfirmedHighRiskResults,
  prepareLowRiskTurn,
  type AtomicTurnStore,
  type CommitEventCandidate,
  type LowRiskTakeoverPreparation,
  type PreparedLowRiskTurn,
  type ShadowCandidateWave,
} from '@murder-loop-ai/game-core';
import type { GameState, RecommendedAction } from '@murder-loop-ai/shared';
import type { ShadowRunSession } from '../shadow/shadowCoordinator';

export type LowRiskTakeoverBypassReason =
  | Exclude<LowRiskTakeoverPreparation, { status: 'prepared' }>['reason']
  | 'shadow_incomplete'
  | 'envelope_mismatch';

export type LowRiskTakeoverPrepareResult = {
  status: 'prepared';
  prepared: PreparedLowRiskTurn;
  recommendedActions: RecommendedAction[];
} | {
  status: 'bypassed';
  reason: LowRiskTakeoverBypassReason;
  fallbackMode: 'ai_unavailable' | 'clarification_required' | 'formal_rejection';
};

export type LowRiskTakeoverCommitResult = Awaited<ReturnType<typeof commitPreparedLowRiskTurn>>;

export interface KnowledgeClueProjectionSummary {
  addedObservationIds: string[];
  addedKnowledgeFactIds: string[];
  addedClueIds: string[];
}

export interface HighRiskProjectionSummary {
  acceptedEventIds: string[];
  correctedEventIds: string[];
  deferredEventIds: string[];
  rejectedEventIds: string[];
  highRiskDecisions: HighRiskDecision[];
}

export type LowRiskTakeoverServiceCommitResult = LowRiskTakeoverCommitResult & {
  recommendedActions: RecommendedAction[];
  knowledgeClueProjection?: KnowledgeClueProjectionSummary;
  highRiskProjection?: HighRiskProjectionSummary;
};

interface AcceptedRecommendationSnapshot {
  action: RecommendedAction;
  factValues: Array<{
    id: string;
    value: Fact['value'];
  }>;
}

export interface LowRiskTakeoverService {
  readonly highRiskTakeoverEnabled?: boolean;
  readonly legacyMainPathExitEnabled?: boolean;
  prepare(
    session: ShadowRunSession,
    state: GameState,
    options?: { store?: AtomicTurnStore<GameState> },
  ): Promise<LowRiskTakeoverPrepareResult>;
  commit(turnId: string, finalState: GameState): Promise<LowRiskTakeoverServiceCommitResult>;
  discard(turnId: string): void;
}

export interface LowRiskTakeoverServiceOptions {
  createStore?: (initial: {
    loopId: string;
    stateVersion: number;
    state: GameState;
  }) => AtomicTurnStore<GameState>;
  now?: () => Date;
  knowledgeClueTakeoverEnabled?: boolean;
  highRiskTakeoverEnabled?: boolean;
  legacyMainPathExitEnabled?: boolean;
}

export function createLowRiskTakeoverService(
  options: LowRiskTakeoverServiceOptions = {},
): LowRiskTakeoverService {
  const createStore = options.createStore ?? ((initial) => new InMemoryAtomicTurnStore(initial));
  const now = options.now ?? (() => new Date());
  const legacyMainPathExitEnabled = options.legacyMainPathExitEnabled ?? false;
  const highRiskTakeoverEnabled = (options.highRiskTakeoverEnabled ?? false)
    || legacyMainPathExitEnabled;
  const knowledgeClueTakeoverEnabled = (options.knowledgeClueTakeoverEnabled ?? false)
    || highRiskTakeoverEnabled;
  const pending = new Map<string, {
    prepared: PreparedLowRiskTurn;
    store: AtomicTurnStore<GameState>;
    baselineState: GameState;
    highRiskEventCandidates: CommitEventCandidate[];
    authorityRejectedEventIds: string[];
    authorityRejectionDecisions: HighRiskDecision[];
    recommendationSnapshots: AcceptedRecommendationSnapshot[];
  }>();

  return {
    highRiskTakeoverEnabled,
    legacyMainPathExitEnabled,
    async prepare(session, state, prepareOptions) {
      let wave: ShadowCandidateWave;
      try {
        wave = await session.wave;
      } catch {
        return {
          status: 'bypassed',
          reason: 'shadow_incomplete',
          fallbackMode: 'ai_unavailable',
        };
      }
      const gate = validateDeterministicTurnBriefGate(session, wave);
      if (gate.status === 'bypassed') return gate;

      const preparation = prepareLowRiskTurn({
        state,
        brief: gate.brief,
        allowHighRiskContinuation: highRiskTakeoverEnabled,
      });
      if (preparation.status === 'not_eligible') {
        return {
          status: 'bypassed',
          reason: preparation.reason,
          fallbackMode: 'formal_rejection',
        };
      }

      const publishAiDownstream = arbitrationCanPublishCreativeOutputs(wave);
      const downstreamEvents = publishAiDownstream
        ? selectDownstreamEventCandidates(wave)
        : { eventCandidates: [], rejectedEventIds: [], rejectionDecisions: [] };
      const recommendationSnapshots = publishAiDownstream
        ? selectAcceptedRecommendations(wave, state)
        : [];
      const recommendedActions = recommendationSnapshots.map(({ action }) => action);
      pending.set(session.envelope.turnId, {
        prepared: preparation,
        store: prepareOptions?.store ?? createStore({
          loopId: preparation.envelope.loopId,
          stateVersion: preparation.envelope.inputStateVersion,
          state,
        }),
        baselineState: structuredClone(state) as GameState,
        highRiskEventCandidates: downstreamEvents.eventCandidates,
        authorityRejectedEventIds: downstreamEvents.rejectedEventIds,
        authorityRejectionDecisions: downstreamEvents.rejectionDecisions,
        recommendationSnapshots,
      });
      return {
        status: 'prepared',
        prepared: preparation,
        recommendedActions,
      };
    },

    async commit(turnId, finalState) {
      const entry = pending.get(turnId);
      if (!entry) throw new Error(`No prepared low-risk takeover exists for turn "${turnId}".`);
      pending.delete(turnId);
      let candidateState = finalState;
      let knowledgeClueProjection: KnowledgeClueProjectionSummary | undefined;
      let highRiskProjection: HighRiskProjectionSummary | undefined;
      let additionalEventCandidates: CommitEventCandidate[] = [];
      let additionalDisplayFragments: DisplayFragment[] = [];
      let highRiskDecisions: HighRiskDecision[] = [];

      if (highRiskTakeoverEnabled) {
        const projection = projectConfirmedHighRiskResults({
          baselineState: entry.prepared.playerResult.state,
          candidateState: finalState,
          eventCandidates: entry.highRiskEventCandidates,
          reservedEventIds: entry.prepared.eventCandidates.map(({ event }) => event.id),
        });
        candidateState = projection.state;
        additionalEventCandidates = projection.acceptedEventCandidates;
        additionalDisplayFragments = projection.displayFragments;
        highRiskDecisions = [
          ...projection.highRiskDecisions,
          ...entry.authorityRejectionDecisions,
        ];
        highRiskProjection = {
          acceptedEventIds: projection.acceptedEventIds,
          correctedEventIds: projection.correctedEventIds,
          deferredEventIds: projection.deferredEventIds,
          rejectedEventIds: [
            ...projection.rejectedEventIds,
            ...entry.authorityRejectedEventIds,
          ],
          highRiskDecisions,
        };
      }

      if (knowledgeClueTakeoverEnabled) {
        const projection = projectConfirmedKnowledgeAndClues({
          baselineState: entry.baselineState,
          candidateState,
          eventCandidates: [
            ...entry.prepared.eventCandidates,
            ...additionalEventCandidates,
          ],
          candidates: entry.prepared.knowledgeClueCandidates,
        });
        if (projection.status === 'rejected') {
          throw new Error(`Knowledge/Clue projection rejected: ${projection.reason}`);
        }
        candidateState = projection.state;
        knowledgeClueProjection = {
          addedObservationIds: projection.addedObservationIds,
          addedKnowledgeFactIds: projection.addedKnowledgeFactIds,
          addedClueIds: projection.addedClueIds,
        };
      }

      const committed = await commitPreparedLowRiskTurn({
        prepared: entry.prepared,
        finalState: candidateState,
        store: entry.store,
        now: now(),
        additionalEventCandidates,
        additionalDisplayFragments,
        highRiskDecisions,
      });
      if (committed.outcome.result.commitStatus !== 'committed' || !committed.state) {
        return { ...committed, recommendedActions: [] };
      }
      return {
        ...committed,
        recommendedActions: selectRecommendationsWithStableFacts(
          entry.recommendationSnapshots,
          committed.state,
          entry.prepared.envelope,
          committed.outcome.result.outputStateVersion,
        ),
        knowledgeClueProjection,
        highRiskProjection,
      };
    },

    discard(turnId) {
      pending.delete(turnId);
    },
  };
}

function selectAcceptedRecommendations(
  wave: ShadowCandidateWave,
  state: GameState,
): AcceptedRecommendationSnapshot[] {
  const selectedProposalIds = new Set(wave.arbitration?.selectedProposalIds ?? []);
  const rejectedProposalIds = new Set(
    wave.arbitration?.rejectedProposals.map((proposal) => proposal.proposalId) ?? [],
  );
  const proposals: Array<Proposal | SpecialistCandidate> = [
    ...wave.mainProposals,
    ...wave.specialistCandidates,
  ];
  const factById = new Map(
    buildFactLedgerFromGameState(state, {
      loopId: wave.envelope.loopId,
      turnId: wave.envelope.turnId,
      stateVersion: wave.envelope.inputStateVersion,
    }).activeFacts().map((fact) => [fact.id, fact]),
  );
  const recommendationIds = new Set<string>();
  const accepted: AcceptedRecommendationSnapshot[] = [];

  for (const proposal of proposals) {
    if (
      proposal.domain !== 'recommendation'
      || !selectedProposalIds.has(proposal.id)
      || rejectedProposalIds.has(proposal.id)
    ) {
      continue;
    }
    for (const recommendation of proposal.recommendations) {
      if (recommendationIds.has(recommendation.id)) continue;
      const factValues = recommendation.basedOnFactIds.flatMap((factId) => {
        const fact = factById.get(factId);
        return fact ? [{ id: factId, value: structuredClone(fact.value) }] : [];
      });
      if (factValues.length !== recommendation.basedOnFactIds.length) continue;
      recommendationIds.add(recommendation.id);
      accepted.push({
        action: {
          id: recommendation.id,
          label: recommendation.label,
          rationale: recommendation.rationale,
        },
        factValues,
      });
    }
  }

  return accepted;
}

function selectRecommendationsWithStableFacts(
  snapshots: AcceptedRecommendationSnapshot[],
  state: GameState,
  envelope: PreparedLowRiskTurn['envelope'],
  outputStateVersion: number | null,
): RecommendedAction[] {
  const finalFactById = new Map(
    buildFactLedgerFromGameState(state, {
      loopId: envelope.loopId,
      turnId: envelope.turnId,
      stateVersion: outputStateVersion ?? envelope.inputStateVersion,
    }).activeFacts().map((fact) => [fact.id, fact]),
  );

  return snapshots
    .filter((snapshot) => snapshot.factValues.every((before) => {
      const after = finalFactById.get(before.id);
      return after !== undefined
        && isDeepStrictEqual(after.value, before.value);
    }))
    .map(({ action }) => action);
}

function selectDownstreamEventCandidates(wave: ShadowCandidateWave): {
  eventCandidates: CommitEventCandidate[];
  rejectedEventIds: string[];
  rejectionDecisions: HighRiskDecision[];
} {
  const selectedProposalIds = new Set(wave.arbitration?.selectedProposalIds ?? []);
  const proposals: Array<Proposal | SpecialistCandidate> = [
    ...wave.mainProposals,
    ...wave.specialistCandidates,
  ];
  const eventCandidates: CommitEventCandidate[] = [];
  const rejectedEventIds: string[] = [];
  const rejectionDecisions: HighRiskDecision[] = [];
  const selected = proposals
    .filter((proposal) => (
      selectedProposalIds.has(proposal.id)
      && ['killer', 'npc', 'environment', 'world'].includes(proposal.domain)
    ));
  for (const proposal of selected) {
    for (const event of proposal.proposedEvents) {
      if (proposalCanAuthorEvent(proposal, event)) {
        eventCandidates.push({ event, sourceProposalId: proposal.id });
        continue;
      }
      rejectedEventIds.push(event.id);
      if (event.riskClass !== 'reversible') {
        rejectionDecisions.push({
          eventId: event.id,
          riskClass: event.riskClass,
          evidenceRefs: [...event.evidenceRefs],
          decision: 'reject',
          reasonCodes: ['proposal_actor_not_authorized'],
        });
      }
    }
  }
  return { eventCandidates, rejectedEventIds, rejectionDecisions };
}

const DOMAIN_EVENT_KIND_POLICY: Partial<Record<
  Proposal['domain'],
  Set<Proposal['proposedEvents'][number]['kind']>
>> = {
  killer: new Set(['action', 'state_transition', 'information_transfer', 'ending']),
  npc: new Set(['action', 'state_transition', 'information_transfer', 'observation', 'ending']),
  environment: new Set(['state_transition', 'observation', 'timer', 'ending']),
  world: new Set([
    'action',
    'state_transition',
    'information_transfer',
    'observation',
    'timer',
    'ending',
  ]),
};

function proposalCanAuthorEvent(
  proposal: Proposal | SpecialistCandidate,
  event: Proposal['proposedEvents'][number],
): boolean {
  const allowedKinds = DOMAIN_EVENT_KIND_POLICY[proposal.domain];
  return Boolean(
    allowedKinds?.has(event.kind)
    && event.actorId === proposal.actorId,
  );
}

function arbitrationCanPublishCreativeOutputs(wave: ShadowCandidateWave): boolean {
  const arbitration = wave.arbitration;
  if (!arbitration) return false;
  const rejectedProposalIds = new Set(
    arbitration.rejectedProposals.map((proposal) => proposal.proposalId),
  );
  const hasUnattributedTransitionViolation = arbitration.transition.violations.some(
    (violation) => !rejectedProposalIds.has(violation.subjectId),
  );
  return !arbitration.transition.requiresRepair
    && !arbitration.transition.requiresPlayerClarification
    && !hasUnattributedTransitionViolation;
}

function validateDeterministicTurnBriefGate(
  session: ShadowRunSession,
  wave: ShadowCandidateWave,
): { status: 'eligible'; brief: NonNullable<ShadowCandidateWave['turnBrief']> } | {
  status: 'bypassed';
  reason: LowRiskTakeoverBypassReason;
  fallbackMode: 'ai_unavailable' | 'clarification_required' | 'formal_rejection';
} {
  if (wave.status !== 'completed' || wave.semantic.status !== 'compiled' || !wave.turnBrief) {
    return {
      status: 'bypassed',
      reason: 'shadow_incomplete',
      fallbackMode: classifyIncompleteWave(wave),
    };
  }
  if (
    wave.envelope.loopId !== session.envelope.loopId
    || wave.envelope.turnId !== session.envelope.turnId
    || wave.envelope.inputStateVersion !== session.envelope.inputStateVersion
    || wave.envelope.deadlineAt !== session.envelope.deadlineAt
    || wave.turnBrief.loopId !== session.envelope.loopId
    || wave.turnBrief.turnId !== session.envelope.turnId
    || wave.turnBrief.inputStateVersion !== session.envelope.inputStateVersion
    || wave.turnBrief.deadlineAt !== session.envelope.deadlineAt
  ) {
    return bypass('envelope_mismatch');
  }
  return { status: 'eligible', brief: wave.turnBrief };
}

function bypass(reason: LowRiskTakeoverBypassReason): Extract<
  LowRiskTakeoverPrepareResult,
  { status: 'bypassed' }
> {
  return { status: 'bypassed', reason, fallbackMode: 'formal_rejection' };
}

function classifyIncompleteWave(
  wave: ShadowCandidateWave,
): Extract<LowRiskTakeoverPrepareResult, { status: 'bypassed' }>['fallbackMode'] {
  if (wave.semantic.status === 'clarification_required') return 'clarification_required';
  const semanticUnavailable = ['failed', 'timed_out', 'schema_invalid']
    .includes(wave.semantic.status);
  const candidatesUnavailable = wave.callRecords.length === 0
    || wave.callRecords.every((record) => (
      record.schemaValidCount === 0
      && ['failed', 'timed_out', 'schema_invalid'].includes(record.status)
    ));
  return semanticUnavailable && candidatesUnavailable
    ? 'ai_unavailable'
    : 'formal_rejection';
}
