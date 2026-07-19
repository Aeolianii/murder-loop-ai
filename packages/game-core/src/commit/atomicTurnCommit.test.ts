import assert from 'node:assert/strict';
import { TurnCommitResultSchema, type HighRiskDecision, type ProposedEvent } from '@murder-loop-ai/ai-contracts';
import { createInitialGameState } from '../state/createInitialState';
import {
  InMemoryAtomicTurnStore,
  atomicTurnCommit,
  evaluateTurnWorkFreshness,
} from './atomicTurnCommit';

const event: ProposedEvent = {
  id: 'event.photo.created',
  eventType: 'package_photographed',
  subject: 'package',
  summary: 'The exterior photograph was created.',
  facts: ['fact.package.exterior_photographed'],
  visibility: ['player'],
  riskClass: 'reversible',
  evidenceRefs: ['fact.player.has_phone'],
  causalParentIds: [],
};

const highRiskEvent: ProposedEvent = {
  ...event,
  id: 'event.ending.death',
  eventType: 'ending_reached',
  riskClass: 'irreversible',
};

const envelope = {
  loopId: 'loop-1',
  turnId: 'turn-7',
  inputStateVersion: 6,
  deadlineAt: '2026-07-20T12:00:01.000Z',
};

function createRequest(candidateState = createInitialGameState()) {
  return {
    envelope,
    expectedOutputStateVersion: 7,
    candidateState,
    events: [{ event, sourceProposalId: 'proposal-player' }],
    highRiskDecisions: [] as HighRiskDecision[],
    displayFragments: [{
      id: 'display-photo',
      text: 'You photograph the exterior label.',
      eventRefs: [event.id],
      claimRefs: event.facts,
    }],
  };
}

{
  const initialState = createInitialGameState();
  const store = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: initialState });
  const candidateState = structuredClone(initialState);
  candidateState.minute += 1;

  const outcome = await atomicTurnCommit(
    createRequest(candidateState),
    store,
    new Date('2026-07-20T12:00:00.500Z'),
  );

  assert.equal(outcome.result.commitStatus, 'committed');
  assert.equal(TurnCommitResultSchema.safeParse(outcome.result).success, true);
  assert.equal(outcome.confirmedEvents.length, 1);
  assert.equal(outcome.confirmedEvents[0].outputStateVersion, 7);
  assert.equal(outcome.displayFragments.length, 1);
  assert.equal(store.snapshot().state.minute, initialState.minute + 1);

  const duplicate = await atomicTurnCommit(
    createRequest(candidateState),
    store,
    new Date('2026-07-20T12:00:00.600Z'),
  );
  assert.equal(duplicate.result.commitStatus, 'conflict');
  assert.deepEqual(duplicate.confirmedEvents, []);
  assert.deepEqual(duplicate.displayFragments, []);
}

{
  const store = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: createInitialGameState() });
  store.failNextCommit();
  const outcome = await atomicTurnCommit(
    createRequest(),
    store,
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.equal(outcome.result.commitStatus, 'failed');
  assert.equal(outcome.discardReason, 'persistence_failed');
  assert.deepEqual(outcome.confirmedEvents, []);
  assert.deepEqual(outcome.displayFragments, []);
}

{
  const store = new InMemoryAtomicTurnStore({ loopId: 'loop-2', stateVersion: 0, state: createInitialGameState() });
  const outcome = await atomicTurnCommit(
    createRequest(),
    store,
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.equal(outcome.result.commitStatus, 'conflict');
  assert.equal(outcome.discardReason, 'loop_invalidated');
  assert.deepEqual(outcome.confirmedEvents, []);
}

{
  const store = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: createInitialGameState() });
  const outcome = await atomicTurnCommit(
    createRequest(),
    store,
    new Date('2026-07-20T12:00:01.001Z'),
  );
  assert.equal(outcome.result.commitStatus, 'failed');
  assert.equal(outcome.discardReason, 'deadline_expired');
  assert.equal(store.snapshot().stateVersion, 6);
}

{
  const store = new InMemoryAtomicTurnStore({ loopId: 'loop-1', stateVersion: 6, state: createInitialGameState() });
  const request = createRequest();
  request.events = [{ event: highRiskEvent, sourceProposalId: 'proposal-ending' }];
  request.displayFragments = [{
    id: 'display-death',
    text: 'This must not be shown.',
    eventRefs: [highRiskEvent.id],
    claimRefs: [],
  }];
  request.highRiskDecisions = [{
    eventId: highRiskEvent.id,
    riskClass: 'irreversible',
    evidenceRefs: [],
    decision: 'defer',
    reasonCodes: ['deterministic_evidence_missing'],
  }];

  const outcome = await atomicTurnCommit(
    request,
    store,
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.equal(outcome.result.commitStatus, 'failed');
  assert.equal(outcome.discardReason, 'high_risk_event_not_approved');
  assert.deepEqual(outcome.displayFragments, []);
}

{
  const fresh = evaluateTurnWorkFreshness(
    envelope,
    { loopId: 'loop-1', stateVersion: 6, committedTurnIds: [] },
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.equal(fresh.accept, true);

  const oldLoop = evaluateTurnWorkFreshness(
    envelope,
    { loopId: 'loop-2', stateVersion: 0, committedTurnIds: [] },
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.deepEqual(oldLoop, { accept: false, reason: 'loop_invalidated' });

  const alreadyCommitted = evaluateTurnWorkFreshness(
    envelope,
    { loopId: 'loop-1', stateVersion: 6, committedTurnIds: ['turn-7'] },
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.deepEqual(alreadyCommitted, { accept: false, reason: 'turn_already_committed' });

  const staleVersion = evaluateTurnWorkFreshness(
    envelope,
    { loopId: 'loop-1', stateVersion: 7, committedTurnIds: [] },
    new Date('2026-07-20T12:00:00.500Z'),
  );
  assert.deepEqual(staleVersion, { accept: false, reason: 'state_version_conflict' });

  const expired = evaluateTurnWorkFreshness(
    envelope,
    { loopId: 'loop-1', stateVersion: 6, committedTurnIds: [] },
    new Date('2026-07-20T12:00:01.001Z'),
  );
  assert.deepEqual(expired, { accept: false, reason: 'deadline_expired' });
}
