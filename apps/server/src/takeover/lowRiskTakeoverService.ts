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
    authorityRejectedEventIds: string[];
    authorityRejectionDecisions: HighRiskDecision[];
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

      const downstreamEvents = selectDownstreamEventCandidates(wave);
      pending.set(session.envelope.turnId, {
        prepared: preparation,
        store: createStore({
          loopId: preparation.envelope.loopId,
          stateVersion: preparation.envelope.inputStateVersion,
          state,
        }),
        baselineState: structuredClone(state) as GameState,
        highRiskEventCandidates: downstreamEvents.eventCandidates,
        authorityRejectedEventIds: downstreamEvents.rejectedEventIds,
        authorityRejectionDecisions: downstreamEvents.rejectionDecisions,
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
      return committed.outcome.result.commitStatus === 'committed'
        ? { ...committed, knowledgeClueProjection, highRiskProjection }
        : committed;
    },

    discard(turnId) {
      pending.delete(turnId);
    },
  };
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

const KILLER_AUTHORIZED_EVENT_TYPES = new Set([
  'actor_entered',
  'actor_moved',
  'attack_attempted',
  'attack_blocked',
  'attack_landed',
  'character_fled',
  'character_incapacitated',
  'character_injured',
  'character_killed',
  'ending_reached',
  'entry_attempted',
  'entry_blocked',
  'evidence_destroyed',
  'evidence_destruction_attempted',
  'killer_action_attempted',
]);

function proposalCanAuthorEvent(
  proposal: Proposal | SpecialistCandidate,
  event: Proposal['proposedEvents'][number],
): boolean {
  const actorFact = eventFact(event, 'actor');
  const attackerFact = eventFact(event, 'attacker');
  if (proposal.domain === 'killer') {
    return proposal.actorId === 'chen_huaimin'
      && KILLER_AUTHORIZED_EVENT_TYPES.has(event.eventType)
      && (!actorFact || actorFact === 'chen_huaimin')
      && (!attackerFact || attackerFact === 'chen_huaimin');
  }
  if (proposal.domain === 'environment') {
    return ['deadline_reached', 'ending_reached'].includes(event.eventType);
  }
  if (proposal.domain !== 'npc') return false;

  const actorId = proposal.actorId === 'police_dispatch'
    ? 'real_police'
    : proposal.actorId === 'linyue'
      ? 'lin_yue'
      : proposal.actorId;
  if (actorFact && actorFact !== actorId) return false;
  if (attackerFact && attackerFact !== actorId) return false;
  if (event.eventType === 'actor_moved' || event.eventType === 'npc_action_attempted') {
    return event.subject === actorId;
  }
  if (actorId === 'real_police') {
    return ['police_intervention_confirmed', 'character_arrested', 'ending_reached']
      .includes(event.eventType);
  }
  return actorId === 'lin_yue'
    && event.subject === 'lin_yue'
    && ['character_injured', 'character_incapacitated', 'character_killed']
      .includes(event.eventType);
}

function eventFact(event: Proposal['proposedEvents'][number], key: string): string | undefined {
  const prefix = `${key}:`;
  return event.facts.find((fact) => fact.startsWith(prefix))?.slice(prefix.length);
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
