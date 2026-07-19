import assert from 'node:assert/strict';
import type { Proposal, TurnBrief, TurnEnvelope } from '@murder-loop-ai/ai-contracts';
import {
  InMemoryAtomicTurnStore,
  createInitialWorldState,
  createInitialGameState,
  type ShadowCandidateWave,
} from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';
import type { ShadowRunSession } from '../shadow/shadowCoordinator';
import { createLowRiskTakeoverService } from './lowRiskTakeoverService';

const state = createInitialGameState();
const envelope: TurnEnvelope = {
  loopId: 'legacy-run-1',
  turnId: 'takeover-service-turn',
  inputStateVersion: state.log.length,
  deadlineAt: new Date(Date.now() + 10_000).toISOString(),
};

function brief(operation = 'secure_entry', targetIds = ['front_door', 'chair']): TurnBrief {
  return {
    ...envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [{
      actionId: 'action-low-risk',
      actorId: 'player',
      operation,
      targetIds,
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: operation.length, text: operation },
    }],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

function playerProposal(riskClass: Proposal['riskClass'] = 'reversible'): Proposal {
  return {
    ...envelope,
    id: 'proposal.player.selected',
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent: 'player-specialist',
    domain: 'player',
    candidateRank: 0,
    turnBriefActionIds: ['action-low-risk'],
    replacementFor: [],
    actorId: 'player',
    operation: 'secure_entry',
    targetIds: ['front_door', 'chair'],
    basedOnFactIds: [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [],
    visibility: ['player'],
    confidence: 1,
    riskClass,
    evidenceRefs: [],
    causalParentIds: [],
    proposedEvents: [{
      id: 'event.proposal.secure-door',
      eventType: 'front_door_secured',
      subject: 'front_door',
      summary: 'Secure the front door.',
      facts: ['front_door:locked'],
      visibility: ['player'],
      riskClass,
      evidenceRefs: [],
      causalParentIds: [],
    }],
    clueCandidates: [],
    recommendations: [],
    displayFragments: [],
  };
}

function wave(turnBrief = brief(), proposal = playerProposal()): ShadowCandidateWave {
  return {
    status: 'completed',
    envelope,
    semantic: { status: 'compiled', durationMs: 1, issues: [] },
    turnBrief,
    mainProposals: [],
    specialistCandidates: [{ ...proposal, candidateType: 'specialist', specialistId: 'player-specialist' }],
    callRecords: [],
    arbitration: {
      selectedProposalIds: [proposal.id],
      rejectedProposals: [],
      highRiskDecisions: [],
      transition: {
        ...envelope,
        acceptedEvents: proposal.proposedEvents,
        correctedEvents: [],
        rejectedEffects: [],
        violations: [],
        selectedSourceByDomain: { player: proposal.sourceAgent },
        specialistCandidatesTried: [proposal.id],
        fallbackDomains: [],
        requiresRepair: false,
        requiresPlayerClarification: false,
        expectedOutputStateVersion: envelope.inputStateVersion + 1,
      },
    },
    completedAt: new Date(),
  };
}

function session(candidateWave = wave()): ShadowRunSession {
  return { envelope, wave: Promise.resolve(candidateWave) };
}

const service = createLowRiskTakeoverService();
const prepared = await service.prepare(session(), state);
assert.equal(prepared.status, 'prepared');
if (prepared.status !== 'prepared') throw new Error('expected takeover preparation');
assert.equal(prepared.prepared.sourceProposalId, 'proposal.player.selected');
assert.equal(prepared.prepared.playerResult.state.room.front_door.state.chainLocked, true);

const committed = await service.commit(envelope.turnId, {
  ...prepared.prepared.playerResult.state,
  threat: 41,
});
assert.equal(committed.outcome.result.commitStatus, 'committed');
assert.equal(committed.state?.threat, 41);
assert(committed.outcome.displayFragments.length > 0);

const unsupported = await service.prepare(session(wave(brief('attack', ['chen_huaimin']))), state);
assert.equal(unsupported.status, 'bypassed');
if (unsupported.status === 'bypassed') assert.equal(unsupported.reason, 'unsupported_operation');

const unsafeProposal = await service.prepare(session(wave(brief(), playerProposal('high_impact'))), state);
assert.equal(unsafeProposal.status, 'bypassed');
if (unsafeProposal.status === 'bypassed') assert.equal(unsafeProposal.reason, 'selected_proposal_not_reversible');

const mismatchedDeadlineBrief: TurnBrief = {
  ...brief(),
  deadlineAt: new Date(Date.now() + 20_000).toISOString(),
};
const mismatchedDeadline = await service.prepare(session(wave(mismatchedDeadlineBrief)), state);
assert.equal(mismatchedDeadline.status, 'bypassed');
if (mismatchedDeadline.status === 'bypassed') assert.equal(mismatchedDeadline.reason, 'envelope_mismatch');

const conflictService = createLowRiskTakeoverService({
  createStore: (initial) => new InMemoryAtomicTurnStore<GameState>({
    ...initial,
    stateVersion: initial.stateVersion + 1,
  }),
});
const conflictPrepared = await conflictService.prepare(session(), state);
assert.equal(conflictPrepared.status, 'prepared');
if (conflictPrepared.status !== 'prepared') throw new Error('expected conflict preparation');
const conflicted = await conflictService.commit(envelope.turnId, conflictPrepared.prepared.playerResult.state);
assert.equal(conflicted.outcome.result.commitStatus, 'conflict');
assert.equal(conflicted.state, undefined);
assert.deepEqual(conflicted.outcome.displayFragments, []);

const discardedService = createLowRiskTakeoverService();
const discardPrepared = await discardedService.prepare(session(), state);
assert.equal(discardPrepared.status, 'prepared');
discardedService.discard(envelope.turnId);
await assert.rejects(
  () => discardedService.commit(envelope.turnId, state),
  /No prepared low-risk takeover/,
);

const phaseFourService = createLowRiskTakeoverService({ knowledgeClueTakeoverEnabled: true });
const inspectBrief = brief('inspect', ['package']);
inspectBrief.orderedActions[0].scope = 'exterior.label';
const phaseFourPrepared = await phaseFourService.prepare(session(wave(inspectBrief)), state);
assert.equal(phaseFourPrepared.status, 'prepared');
if (phaseFourPrepared.status !== 'prepared') throw new Error('expected phase-four preparation');
const phaseFourCandidateState = structuredClone(phaseFourPrepared.prepared.playerResult.state);
phaseFourCandidateState.world = createInitialWorldState();
phaseFourCandidateState.clues.push({
  id: 'narrator_invented_note',
  title: 'Narrator invented note',
  detail: 'This has no Observation source.',
  source: 'ai_generated',
  weight: 99,
  discoveredAt: { run: state.run, minute: state.minute },
  isPersistent: true,
});
const phaseFourCommitted = await phaseFourService.commit(envelope.turnId, phaseFourCandidateState);
assert.equal(phaseFourCommitted.outcome.result.commitStatus, 'committed');
assert.equal(phaseFourCommitted.state?.clues.some((clue) => clue.id === 'narrator_invented_note'), false);
const phaseFourClue = phaseFourCommitted.state?.clues.find((clue) => clue.id === 'wrong_package');
assert.deepEqual(phaseFourClue?.basedOnObservationIds, [
  `observation.event.low-risk.${envelope.turnId}.action-low-risk.exterior-label`,
]);
assert.deepEqual(phaseFourClue?.sourceEventIds, [
  `event.low-risk.${envelope.turnId}.action-low-risk`,
]);
assert.equal(
  phaseFourCommitted.state?.world?.knowledge.player.facts.package_exterior_label_ambiguous.sourceEventId,
  `event.low-risk.${envelope.turnId}.action-low-risk`,
);
assert.equal(phaseFourCommitted.knowledgeClueProjection?.addedClueIds.includes('wrong_package'), true);

const offlineState = createInitialGameState();
offlineState.phoneFunctional = false;
offlineState.world = createInitialWorldState();
const failedMessageService = createLowRiskTakeoverService({ knowledgeClueTakeoverEnabled: true });
const messageBrief = brief('communicate', ['lin_yue']);
const failedMessagePrepared = await failedMessageService.prepare(session(wave(messageBrief)), offlineState);
assert.equal(failedMessagePrepared.status, 'prepared');
if (failedMessagePrepared.status !== 'prepared') throw new Error('expected failed-message preparation');
const failedMessageCommitted = await failedMessageService.commit(
  envelope.turnId,
  failedMessagePrepared.prepared.playerResult.state,
);
assert.equal(failedMessageCommitted.outcome.result.commitStatus, 'committed');
assert.deepEqual(
  failedMessageCommitted.state?.world?.knowledge,
  offlineState.world.knowledge,
  'undelivered messages must not update official Knowledge',
);

const phaseFourConflictService = createLowRiskTakeoverService({
  knowledgeClueTakeoverEnabled: true,
  createStore: (initial) => new InMemoryAtomicTurnStore<GameState>({
    ...initial,
    stateVersion: initial.stateVersion + 1,
  }),
});
const phaseFourConflictPrepared = await phaseFourConflictService.prepare(
  session(wave(inspectBrief)),
  state,
);
assert.equal(phaseFourConflictPrepared.status, 'prepared');
if (phaseFourConflictPrepared.status !== 'prepared') throw new Error('expected phase-four conflict preparation');
const phaseFourConflict = await phaseFourConflictService.commit(
  envelope.turnId,
  phaseFourConflictPrepared.prepared.playerResult.state,
);
assert.equal(phaseFourConflict.outcome.result.commitStatus, 'conflict');
assert.equal(phaseFourConflict.state, undefined);
assert.equal(phaseFourConflict.knowledgeClueProjection, undefined);
