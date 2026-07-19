import type {
  ConfirmedEvent,
  DisplayFragment,
  HighRiskDecision,
  ProposedEvent,
  TurnCommitResult,
  TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';

export interface VersionedTurnState<TState> {
  loopId: string;
  stateVersion: number;
  state: TState;
  committedTurnIds: string[];
}

export interface CommitEventCandidate {
  event: ProposedEvent;
  sourceProposalId: string;
}

export interface AtomicTurnCommitRequest<TState> {
  envelope: TurnEnvelope;
  expectedOutputStateVersion: number;
  candidateState: TState;
  events: CommitEventCandidate[];
  highRiskDecisions: HighRiskDecision[];
  displayFragments: DisplayFragment[];
}

export interface AtomicTurnStoreCommit<TState> {
  expectedLoopId: string;
  turnId: string;
  expectedInputStateVersion: number;
  outputStateVersion: number;
  candidateState: TState;
  confirmedEvents: ConfirmedEvent[];
}

export interface AtomicLoopStoreReset<TState> {
  expectedLoopId: string;
  expectedStateVersion: number;
  nextLoopId: string;
  startingStateVersion: number;
  candidateState: TState;
}

export type AtomicStoreCommitResult =
  | { status: 'committed' }
  | { status: 'conflict'; reason: 'loop_invalidated' | 'state_version_conflict' | 'turn_already_committed' }
  | { status: 'failed' };
export type AtomicResetStoreStatus = 'reset' | 'conflict' | 'failed';

export interface AtomicTurnStore<TState> {
  commitTurn(request: AtomicTurnStoreCommit<TState>): Promise<AtomicStoreCommitResult>;
  resetLoop(request: AtomicLoopStoreReset<TState>): Promise<AtomicResetStoreStatus>;
}

export type TurnDiscardReason =
  | 'deadline_expired'
  | 'loop_invalidated'
  | 'state_version_conflict'
  | 'turn_already_committed'
  | 'persistence_failed'
  | 'high_risk_event_not_approved';

export interface AtomicTurnCommitOutcome {
  result: TurnCommitResult;
  confirmedEvents: ConfirmedEvent[];
  displayFragments: DisplayFragment[];
  discardReason?: TurnDiscardReason;
}

export interface TurnFreshnessSnapshot {
  loopId: string;
  stateVersion: number;
  committedTurnIds: string[];
}

export type TurnFreshnessDecision =
  | { accept: true }
  | { accept: false; reason: Extract<TurnDiscardReason, 'deadline_expired' | 'loop_invalidated' | 'state_version_conflict' | 'turn_already_committed'> };

export function evaluateTurnWorkFreshness(
  envelope: TurnEnvelope,
  current: TurnFreshnessSnapshot,
  now: Date,
): TurnFreshnessDecision {
  if (current.loopId !== envelope.loopId) {
    return { accept: false, reason: 'loop_invalidated' };
  }
  if (current.committedTurnIds.includes(envelope.turnId)) {
    return { accept: false, reason: 'turn_already_committed' };
  }
  if (current.stateVersion !== envelope.inputStateVersion) {
    return { accept: false, reason: 'state_version_conflict' };
  }
  if (now.getTime() > Date.parse(envelope.deadlineAt)) {
    return { accept: false, reason: 'deadline_expired' };
  }
  return { accept: true };
}

export async function atomicTurnCommit<TState>(
  request: AtomicTurnCommitRequest<TState>,
  store: AtomicTurnStore<TState>,
  now = new Date(),
): Promise<AtomicTurnCommitOutcome> {
  if (now.getTime() > Date.parse(request.envelope.deadlineAt)) {
    return discardedOutcome(request.envelope, 'failed', 'deadline_expired');
  }

  if (!highRiskEventsAreApproved(request.events, request.highRiskDecisions)) {
    return discardedOutcome(request.envelope, 'failed', 'high_risk_event_not_approved');
  }

  const confirmedEvents = request.events.map(({ event, sourceProposalId }) => ({
    ...event,
    loopId: request.envelope.loopId,
    turnId: request.envelope.turnId,
    inputStateVersion: request.envelope.inputStateVersion,
    outputStateVersion: request.expectedOutputStateVersion,
    sourceProposalId,
    confirmedAt: now.toISOString(),
  }));

  let storeResult: AtomicStoreCommitResult;
  try {
    storeResult = await store.commitTurn({
      expectedLoopId: request.envelope.loopId,
      turnId: request.envelope.turnId,
      expectedInputStateVersion: request.envelope.inputStateVersion,
      outputStateVersion: request.expectedOutputStateVersion,
      candidateState: request.candidateState,
      confirmedEvents,
    });
  } catch {
    storeResult = { status: 'failed' };
  }

  if (storeResult.status === 'conflict') {
    return discardedOutcome(request.envelope, storeResult.status, storeResult.reason);
  }
  if (storeResult.status === 'failed') {
    return discardedOutcome(request.envelope, storeResult.status, 'persistence_failed');
  }

  const confirmedEventIds = confirmedEvents.map((event) => event.id);
  return {
    result: {
      loopId: request.envelope.loopId,
      turnId: request.envelope.turnId,
      inputStateVersion: request.envelope.inputStateVersion,
      outputStateVersion: request.expectedOutputStateVersion,
      commitStatus: 'committed',
      confirmedEventIds,
    },
    confirmedEvents,
    displayFragments: request.displayFragments.filter((fragment) => (
      fragment.eventRefs.length > 0
      && fragment.eventRefs.every((eventId) => confirmedEventIds.includes(eventId))
    )),
  };
}

export class InMemoryAtomicTurnStore<TState> implements AtomicTurnStore<TState> {
  #snapshot: VersionedTurnState<TState>;
  #confirmedEvents: ConfirmedEvent[] = [];
  #failNext = false;

  constructor(initial: Omit<VersionedTurnState<TState>, 'committedTurnIds'> & { committedTurnIds?: string[] }) {
    this.#snapshot = {
      ...structuredClone(initial),
      committedTurnIds: [...(initial.committedTurnIds ?? [])],
    };
  }

  failNextCommit(): void {
    this.#failNext = true;
  }

  snapshot(): VersionedTurnState<TState> {
    return structuredClone(this.#snapshot) as VersionedTurnState<TState>;
  }

  confirmedEvents(): ConfirmedEvent[] {
    return structuredClone(this.#confirmedEvents) as ConfirmedEvent[];
  }

  async commitTurn(request: AtomicTurnStoreCommit<TState>): Promise<AtomicStoreCommitResult> {
    if (this.#failNext) {
      this.#failNext = false;
      return { status: 'failed' };
    }
    if (this.#snapshot.loopId !== request.expectedLoopId) {
      return { status: 'conflict', reason: 'loop_invalidated' };
    }
    if (this.#snapshot.committedTurnIds.includes(request.turnId)) {
      return { status: 'conflict', reason: 'turn_already_committed' };
    }
    if (
      this.#snapshot.stateVersion !== request.expectedInputStateVersion
      || request.outputStateVersion <= request.expectedInputStateVersion
    ) {
      return { status: 'conflict', reason: 'state_version_conflict' };
    }

    this.#snapshot = {
      loopId: request.expectedLoopId,
      stateVersion: request.outputStateVersion,
      state: structuredClone(request.candidateState) as TState,
      committedTurnIds: [...this.#snapshot.committedTurnIds, request.turnId],
    };
    this.#confirmedEvents = [
      ...this.#confirmedEvents,
      ...(structuredClone(request.confirmedEvents) as ConfirmedEvent[]),
    ];
    return { status: 'committed' };
  }

  async resetLoop(request: AtomicLoopStoreReset<TState>): Promise<AtomicResetStoreStatus> {
    if (this.#failNext) {
      this.#failNext = false;
      return 'failed';
    }
    if (
      this.#snapshot.loopId !== request.expectedLoopId
      || this.#snapshot.stateVersion !== request.expectedStateVersion
      || request.nextLoopId === request.expectedLoopId
    ) {
      return 'conflict';
    }

    this.#snapshot = {
      loopId: request.nextLoopId,
      stateVersion: request.startingStateVersion,
      state: structuredClone(request.candidateState) as TState,
      committedTurnIds: [],
    };
    this.#confirmedEvents = [];
    return 'reset';
  }
}

function highRiskEventsAreApproved(
  events: CommitEventCandidate[],
  decisions: HighRiskDecision[],
): boolean {
  return events.every(({ event }) => {
    if (event.riskClass === 'reversible') return true;
    const decision = decisions.find((item) => item.eventId === event.id);
    return decision?.decision === 'pass'
      && decision.riskClass === event.riskClass
      && decision.evidenceRefs.length > 0;
  });
}

function discardedOutcome(
  envelope: TurnEnvelope,
  status: 'conflict' | 'failed',
  discardReason: TurnDiscardReason,
): AtomicTurnCommitOutcome {
  return {
    result: {
      loopId: envelope.loopId,
      turnId: envelope.turnId,
      inputStateVersion: envelope.inputStateVersion,
      outputStateVersion: null,
      commitStatus: status,
      confirmedEventIds: [],
    },
    confirmedEvents: [],
    displayFragments: [],
    discardReason,
  };
}
