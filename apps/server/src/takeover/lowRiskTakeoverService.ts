import type {
  DisplayFragment,
  HighRiskDecision,
  Proposal,
  SpecialistCandidate,
} from '@murder-loop-ai/ai-contracts';
import {
  InMemoryAtomicTurnStore,
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
import type { GameState } from '@murder-loop-ai/shared';
import type { ShadowRunSession } from '../shadow/shadowCoordinator';

export type LowRiskTakeoverBypassReason =
  | Exclude<LowRiskTakeoverPreparation, { status: 'prepared' }>['reason']
  | 'shadow_incomplete'
  | 'envelope_mismatch'
  | 'arbitration_unavailable'
  | 'arbitration_not_clean'
  | 'selected_player_proposal_missing'
  | 'selected_proposal_not_reversible'
  | 'selected_proposal_does_not_cover_turn';

export type LowRiskTakeoverPrepareResult = {
  status: 'prepared';
  prepared: PreparedLowRiskTurn;
} | {
  status: 'bypassed';
  reason: LowRiskTakeoverBypassReason;
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
  knowledgeClueProjection?: KnowledgeClueProjectionSummary;
  highRiskProjection?: HighRiskProjectionSummary;
};

export interface LowRiskTakeoverService {
  readonly highRiskTakeoverEnabled?: boolean;
  prepare(session: ShadowRunSession, state: GameState): Promise<LowRiskTakeoverPrepareResult>;
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
}

export function createLowRiskTakeoverService(
  options: LowRiskTakeoverServiceOptions = {},
): LowRiskTakeoverService {
  const createStore = options.createStore ?? ((initial) => new InMemoryAtomicTurnStore(initial));
  const now = options.now ?? (() => new Date());
  const highRiskTakeoverEnabled = options.highRiskTakeoverEnabled ?? false;
  const knowledgeClueTakeoverEnabled = (options.knowledgeClueTakeoverEnabled ?? false)
    || highRiskTakeoverEnabled;
  const pending = new Map<string, {
    prepared: PreparedLowRiskTurn;
    store: AtomicTurnStore<GameState>;
    baselineState: GameState;
    highRiskEventCandidates: CommitEventCandidate[];
  }>();

  return {
    highRiskTakeoverEnabled,
    async prepare(session, state) {
      let wave: ShadowCandidateWave;
      try {
        wave = await session.wave;
      } catch {
        return { status: 'bypassed', reason: 'shadow_incomplete' };
      }
      const gate = validateShadowTakeoverGate(session, wave);
      if (gate.status === 'bypassed') return gate;

      const preparation = prepareLowRiskTurn({
        state,
        brief: wave.turnBrief!,
        sourceProposalId: gate.proposal.id,
        allowHighRiskContinuation: highRiskTakeoverEnabled,
      });
      if (preparation.status === 'not_eligible') {
        return { status: 'bypassed', reason: preparation.reason };
      }

      pending.set(session.envelope.turnId, {
        prepared: preparation,
        store: createStore({
          loopId: preparation.envelope.loopId,
          stateVersion: preparation.envelope.inputStateVersion,
          state,
        }),
        baselineState: structuredClone(state) as GameState,
        highRiskEventCandidates: selectedDownstreamEventCandidates(wave),
      });
      return { status: 'prepared', prepared: preparation };
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
        highRiskDecisions = projection.highRiskDecisions;
        highRiskProjection = {
          acceptedEventIds: projection.acceptedEventIds,
          correctedEventIds: projection.correctedEventIds,
          deferredEventIds: projection.deferredEventIds,
          rejectedEventIds: projection.rejectedEventIds,
          highRiskDecisions: projection.highRiskDecisions,
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
      return committed.outcome.result.commitStatus === 'committed'
        ? { ...committed, knowledgeClueProjection, highRiskProjection }
        : committed;
    },

    discard(turnId) {
      pending.delete(turnId);
    },
  };
}

function selectedDownstreamEventCandidates(wave: ShadowCandidateWave): CommitEventCandidate[] {
  const selectedProposalIds = new Set(wave.arbitration?.selectedProposalIds ?? []);
  const proposals: Array<Proposal | SpecialistCandidate> = [
    ...wave.mainProposals,
    ...wave.specialistCandidates,
  ];
  return proposals
    .filter((proposal) => (
      selectedProposalIds.has(proposal.id)
      && ['killer', 'npc', 'environment', 'world'].includes(proposal.domain)
    ))
    .flatMap((proposal) => proposal.proposedEvents.map((event) => ({
      event,
      sourceProposalId: proposal.id,
    })));
}

function validateShadowTakeoverGate(
  session: ShadowRunSession,
  wave: ShadowCandidateWave,
): { status: 'eligible'; proposal: Proposal | SpecialistCandidate } | {
  status: 'bypassed';
  reason: LowRiskTakeoverBypassReason;
} {
  if (wave.status !== 'completed' || wave.semantic.status !== 'compiled' || !wave.turnBrief) {
    return { status: 'bypassed', reason: 'shadow_incomplete' };
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
    return { status: 'bypassed', reason: 'envelope_mismatch' };
  }
  const arbitration = wave.arbitration;
  if (!arbitration) return { status: 'bypassed', reason: 'arbitration_unavailable' };
  if (
    arbitration.transition.requiresRepair
    || arbitration.transition.requiresPlayerClarification
    || arbitration.transition.violations.length > 0
    || arbitration.transition.fallbackDomains.includes('player')
  ) {
    return { status: 'bypassed', reason: 'arbitration_not_clean' };
  }

  const proposals: Array<Proposal | SpecialistCandidate> = [
    ...wave.mainProposals,
    ...wave.specialistCandidates,
  ];
  const proposal = proposals.find((candidate) => (
    candidate.domain === 'player'
    && arbitration.selectedProposalIds.includes(candidate.id)
  ));
  if (!proposal) return { status: 'bypassed', reason: 'selected_player_proposal_missing' };
  if (
    proposal.riskClass !== 'reversible'
    || proposal.proposedEvents.some((event) => event.riskClass !== 'reversible')
  ) {
    return { status: 'bypassed', reason: 'selected_proposal_not_reversible' };
  }
  if (!wave.turnBrief.orderedActions.every((action) => proposal.turnBriefActionIds.includes(action.actionId))) {
    return { status: 'bypassed', reason: 'selected_proposal_does_not_cover_turn' };
  }
  return { status: 'eligible', proposal };
}
