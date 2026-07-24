import assert from 'node:assert/strict';
import type {
  Proposal,
  ProposedEvent,
  SpecialistCandidate,
  TurnBrief,
  TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
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
      kind: 'action',
      sourceActionIds: ['action-low-risk'],
      actorId: 'player',
      operation: 'secure_entry',
      targetIds: ['front_door'],
      status: 'completed',
      summary: 'Secure the front door.',
      assertions: [{
        id: 'assertion.proposal.secure-door.locked',
        subject: 'front_door',
        predicate: 'locked',
        value: true,
        visibleTo: ['player'],
      }],
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

function killerProposal(events: ProposedEvent[]): Proposal {
  return {
    ...envelope,
    id: 'proposal.killer.selected',
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent: 'main-world-model',
    domain: 'killer',
    candidateRank: 0,
    turnBriefActionIds: [],
    replacementFor: [],
    actorId: 'chen_huaimin',
    operation: 'spare_key_entry',
    targetIds: ['front_door'],
    basedOnFactIds: [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [],
    visibility: ['player'],
    confidence: 1,
    riskClass: events.some((item) => item.riskClass === 'irreversible')
      ? 'irreversible'
      : 'high_impact',
    evidenceRefs: [],
    causalParentIds: [],
    proposedEvents: events,
    clueCandidates: [],
    recommendations: [],
    displayFragments: events.map((item) => ({
      id: `display.untrusted.${item.id}`,
      text: `Untrusted display for ${item.id}.`,
      eventRefs: [item.id],
      claimRefs: item.assertions.map((assertion) => assertion.id),
    })),
  };
}

function recommendationProposal(
  id: string,
  recommendationId: string,
  label: string,
): SpecialistCandidate {
  return {
    ...envelope,
    id,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent: 'recommendation-specialist',
    domain: 'recommendation',
    candidateRank: 0,
    turnBriefActionIds: [],
    replacementFor: [],
    actorId: 'player',
    operation: 'recommend',
    targetIds: [],
    basedOnFactIds: [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [],
    visibility: ['player'],
    confidence: 1,
    riskClass: 'reversible',
    evidenceRefs: [],
    causalParentIds: [],
    proposedEvents: [],
    clueCandidates: [],
    recommendations: [{
      id: recommendationId,
      label,
      rationale: 'Grounded in a player-visible fact.',
      basedOnFactIds: ['fact.player.phone_functional'],
      basedOnEventIds: [],
    }],
    displayFragments: [],
    candidateType: 'specialist',
    specialistId: 'recommendation-specialist',
  };
}

function phaseFiveWave(
  turnBrief: TurnBrief,
  events: ProposedEvent[],
): ShadowCandidateWave {
  const player = playerProposal();
  const killer = killerProposal(events);
  const candidateWave = wave(turnBrief, player);
  candidateWave.mainProposals = [killer];
  candidateWave.arbitration!.selectedProposalIds = [player.id, killer.id];
  candidateWave.arbitration!.transition.acceptedEvents = [
    ...player.proposedEvents,
    ...killer.proposedEvents,
  ];
  candidateWave.arbitration!.transition.selectedSourceByDomain.killer = killer.sourceAgent;
  return candidateWave;
}

function session(candidateWave = wave()): ShadowRunSession {
  return { envelope, wave: Promise.resolve(candidateWave) };
}

const service = createLowRiskTakeoverService();
const prepared = await service.prepare(session(), state);
assert.equal(prepared.status, 'prepared');
if (prepared.status !== 'prepared') throw new Error('expected takeover preparation');
assert.equal(prepared.prepared.playerResult.state.room.front_door.state.chainLocked, true);

const deterministicOnlyWave = wave();
deterministicOnlyWave.specialistCandidates = [];
deterministicOnlyWave.arbitration = undefined;
const deterministicOnlyService = createLowRiskTakeoverService();
const deterministicOnly = await deterministicOnlyService.prepare(
  session(deterministicOnlyWave),
  state,
);
assert.equal(
  deterministicOnly.status,
  'prepared',
  'a valid TurnBrief must drive the deterministic reducer without a Player Proposal or Arbiter',
);
if (deterministicOnly.status !== 'prepared') {
  throw new Error('expected deterministic TurnBrief preparation');
}

const openActionBrief = brief('act', ['phone']);
openActionBrief.orderedActions[0].originalSpan = {
  start: 0,
  end: 10,
  text: '打开手机浏览社区动态',
};
const openActionProposal = playerProposal();
openActionProposal.operation = 'act';
openActionProposal.targetIds = ['phone'];
openActionProposal.proposedEvents = [{
  ...openActionProposal.proposedEvents[0],
  id: 'event.proposal.open-action',
  operation: 'act',
  targetIds: ['phone'],
  status: 'completed',
  summary: '你打开手机浏览了一会社区动态，没有看到与当前危险直接相关的新消息。',
}];
const openActionWave = wave(openActionBrief, openActionProposal);
const openActionService = createLowRiskTakeoverService();
const openActionPrepared = await openActionService.prepare(session(openActionWave), state);
assert.equal(openActionPrepared.status, 'prepared');
if (openActionPrepared.status !== 'prepared') throw new Error('expected AI-judged open action');
assert.match(openActionPrepared.prepared.playerResult.text, /浏览.*社区动态/);

const unavailableResourceProposal = structuredClone(openActionProposal);
unavailableResourceProposal.riskClass = 'high_impact';
unavailableResourceProposal.proposedEvents[0].riskClass = 'high_impact';
unavailableResourceProposal.proposedEvents[0].status = 'failed';
unavailableResourceProposal.proposedEvents[0].summary = '你无法完成这个动作，因为所需物品并不存在。';
const unavailableResourceService = createLowRiskTakeoverService({
  highRiskTakeoverEnabled: true,
});
const unavailableResourcePrepared = await unavailableResourceService.prepare(
  session(wave(openActionBrief, unavailableResourceProposal)),
  state,
);
assert.equal(unavailableResourcePrepared.status, 'prepared');
if (unavailableResourcePrepared.status !== 'prepared') {
  throw new Error('expected a high-risk-classified failed action to stay playable');
}
assert.match(unavailableResourcePrepared.prepared.playerResult.text, /无法.*不存在/);

const fatalActionBrief = brief('act', ['player', 'window']);
fatalActionBrief.orderedActions[0].originalSpan = {
  start: 0,
  end: 8,
  text: '执行一个致命行动',
};
const fatalAttempt: ProposedEvent = {
  id: 'event.player.fatal.attempted',
  kind: 'action',
  sourceActionIds: ['action-low-risk'],
  actorId: 'player',
  operation: 'act',
  targetIds: ['player', 'window'],
  status: 'attempted',
  summary: '你开始执行这个行动。',
  assertions: [],
  visibility: ['player'],
  riskClass: 'reversible',
  evidenceRefs: [],
  causalParentIds: [],
};
const fatalAction: ProposedEvent = {
  id: 'event.player.fatal.completed',
  kind: 'action',
  sourceActionIds: ['action-low-risk'],
  actorId: 'player',
  operation: 'act',
  targetIds: ['player', 'window'],
  status: 'completed',
  summary: '这个行动成立，并直接造成了致命后果。',
  assertions: [{
    id: 'assertion.player.fatal.lethality',
    subject: 'player',
    predicate: 'lethality',
    value: 'lethal',
    visibleTo: ['player'],
  }],
  visibility: ['player'],
  riskClass: 'irreversible',
  evidenceRefs: [
    fatalAttempt.id,
    'fact.object.window.location',
    'invariant.death.requires_feasible_lethal_action',
  ],
  causalParentIds: [fatalAttempt.id],
};
const fatalStatus: ProposedEvent = {
  id: 'event.player.fatal.status',
  kind: 'state_transition',
  sourceActionIds: ['action-low-risk'],
  actorId: 'player',
  operation: 'change_status',
  targetIds: ['player'],
  status: 'completed',
  summary: '你死亡了。',
  assertions: [{
    id: 'assertion.player.fatal.status',
    subject: 'player',
    predicate: 'status',
    value: 'dead',
    visibleTo: ['player'],
  }],
  visibility: ['player'],
  riskClass: 'irreversible',
  evidenceRefs: [
    fatalAction.id,
    'invariant.death.requires_feasible_lethal_action',
  ],
  causalParentIds: [fatalAction.id],
};
const fatalEnding: ProposedEvent = {
  id: 'event.player.fatal.ending',
  kind: 'ending',
  sourceActionIds: ['action-low-risk'],
  actorId: 'player',
  operation: 'resolve_ending',
  targetIds: ['death'],
  status: 'completed',
  summary: '这一轮结束了。',
  assertions: [{
    id: 'assertion.player.fatal.ending',
    subject: 'game',
    predicate: 'ending',
    value: 'death',
    visibleTo: ['player'],
  }, {
    id: 'assertion.player.fatal.reason',
    subject: 'game',
    predicate: 'reason',
    value: 'self_inflicted',
    visibleTo: ['player'],
  }],
  visibility: ['player'],
  riskClass: 'irreversible',
  evidenceRefs: [
    fatalStatus.id,
    'invariant.ending.requires_terminal_cause',
  ],
  causalParentIds: [fatalStatus.id],
};
const fatalProposal = playerProposal('irreversible');
fatalProposal.operation = 'act';
fatalProposal.targetIds = ['player', 'window'];
fatalProposal.proposedEvents = [fatalAttempt, fatalAction, fatalStatus, fatalEnding];
const fatalState = createInitialGameState();
fatalState.world = createInitialWorldState();
const fatalService = createLowRiskTakeoverService({ highRiskTakeoverEnabled: true });
const fatalPrepared = await fatalService.prepare(
  session(wave(fatalActionBrief, fatalProposal)),
  fatalState,
);
assert.equal(fatalPrepared.status, 'prepared');
if (fatalPrepared.status !== 'prepared') throw new Error('expected fatal action preparation');
const fatalCommitted = await fatalService.commit(
  envelope.turnId,
  fatalPrepared.prepared.playerResult.state,
);
assert.equal(fatalCommitted.outcome.result.commitStatus, 'committed');
assert.equal(fatalCommitted.state?.world?.characters.player.status, 'dead');
assert.equal(fatalCommitted.state?.ending, 'death');
assert.equal(fatalCommitted.state?.endingReason, 'self_inflicted');
assert.equal(fatalCommitted.state?.phase, 'death');
const fatalEndingEntry = fatalCommitted.state?.log.find((entry) => entry.id.includes(fatalEnding.id));
assert.equal(fatalEndingEntry?.tone, 'death');
assert.doesNotMatch(`${fatalEndingEntry?.title}${fatalEndingEntry?.text}`, /[A-Za-z]/);

const missingOpenActionWave = wave(openActionBrief, openActionProposal);
missingOpenActionWave.arbitration!.selectedProposalIds = [];
const missingOpenActionService = createLowRiskTakeoverService();
const missingOpenAction = await missingOpenActionService.prepare(
  session(missingOpenActionWave),
  state,
);
assert.equal(missingOpenAction.status, 'bypassed');
if (missingOpenAction.status === 'bypassed') {
  assert.equal(missingOpenAction.reason, 'ai_outcome_required');
  assert.equal(
    missingOpenAction.fallbackMode,
    'formal_rejection',
    'an unusable AI outcome is a visible adjudication failure, not an offline-service fallback',
  );
}

function clueProposal(
  proposalId: string,
  clueId: 'package_photo' | 'wrong_package',
): SpecialistCandidate {
  const eventId = `event.${proposalId}`;
  const assertionId = `assertion.${proposalId}`;
  const observationId = `observation.${proposalId}`;
  const packagePhoto = clueId === 'package_photo';
  return {
    ...envelope,
    id: proposalId,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent: 'clue-specialist',
    domain: 'clue',
    candidateRank: 0,
    turnBriefActionIds: [],
    replacementFor: [],
    actorId: 'player',
    operation: 'observe',
    targetIds: ['package'],
    basedOnFactIds: [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [{
      id: observationId,
      subject: 'package',
      predicate: packagePhoto ? 'exterior_photo' : 'exterior_label',
      value: packagePhoto ? 'captured' : 'ambiguous',
      scope: packagePhoto ? 'exterior' : 'exterior.label',
      basedOnEffectIds: [],
      basedOnEventIds: [eventId],
      visibleAssertionIds: [assertionId],
    }],
    visibility: ['player'],
    confidence: 1,
    riskClass: 'reversible',
    evidenceRefs: [],
    causalParentIds: [],
    proposedEvents: [{
      id: eventId,
      kind: 'observation',
      sourceActionIds: [],
      actorId: 'player',
      operation: 'observe',
      targetIds: ['package'],
      status: 'completed',
      summary: packagePhoto
        ? 'The already captured package exterior photo is visible.'
        : 'The package exterior label is visibly ambiguous.',
      assertions: [{
        id: assertionId,
        subject: 'package',
        predicate: packagePhoto ? 'exterior.photo_captured' : 'exterior.label_ambiguous',
        value: true,
        visibleTo: ['player'],
      }],
      visibility: ['player'],
      riskClass: 'reversible',
      evidenceRefs: [],
      causalParentIds: [],
    }],
    clueCandidates: [{
      id: clueId,
      claimAssertionIds: [assertionId],
      basedOnObservationIds: [observationId],
      visibleAssertionIds: [assertionId],
      confidence: 1,
    }],
    recommendations: [],
    displayFragments: [],
    candidateType: 'specialist',
    specialistId: 'clue-specialist',
  };
}
assert.equal(
  deterministicOnly.prepared.executionAuthorityId,
  `deterministic.turn-brief-reducer.${envelope.turnId}`,
);
const deterministicOnlyCommit = await deterministicOnlyService.commit(
  envelope.turnId,
  deterministicOnly.prepared.playerResult.state,
);
assert.equal(deterministicOnlyCommit.outcome.result.commitStatus, 'committed');
assert.ok(deterministicOnlyCommit.outcome.confirmedEvents.length > 0);
assert.ok(
  deterministicOnlyCommit.outcome.confirmedEvents.every((event) => (
    event.sourceProposalId === `deterministic.turn-brief-reducer.${envelope.turnId}`
  )),
  'deterministic events must not be attributed to an AI proposal',
);

const recommendationWave = wave();
const acceptedRecommendation = recommendationProposal(
  'proposal.recommendation.accepted',
  'recommendation.accepted',
  'Photograph the package label.',
);
acceptedRecommendation.recommendations.push({
  id: 'recommendation.stale-after-turn',
  label: 'Secure the already secured door.',
  rationale: 'This is valid only while the door remains unlocked.',
  basedOnFactIds: ['fact.object.front_door.locked'],
  basedOnEventIds: [],
});
const unselectedRecommendation = recommendationProposal(
  'proposal.recommendation.unselected',
  'recommendation.unselected',
  'This recommendation must stay hidden.',
);
const rejectedRecommendation = recommendationProposal(
  'proposal.recommendation.rejected',
  'recommendation.rejected',
  'This rejected recommendation must stay hidden.',
);
recommendationWave.specialistCandidates.push(
  acceptedRecommendation,
  unselectedRecommendation,
  rejectedRecommendation,
);
recommendationWave.arbitration!.selectedProposalIds.push(
  acceptedRecommendation.id,
  rejectedRecommendation.id,
);
recommendationWave.arbitration!.rejectedProposals.push({
  proposalId: rejectedRecommendation.id,
  sourceAgent: rejectedRecommendation.sourceAgent,
  domain: rejectedRecommendation.domain,
  reasonCodes: ['recommendation_fact_unauthorized'],
});
const recommendationService = createLowRiskTakeoverService();
const recommendationPreparation = await recommendationService.prepare(
  session(recommendationWave),
  state,
);
assert.equal(recommendationPreparation.status, 'prepared');
if (recommendationPreparation.status !== 'prepared') {
  throw new Error('expected recommendation preparation');
}
assert.deepEqual(
  recommendationPreparation.recommendedActions,
  [{
    id: 'recommendation.accepted',
    label: 'Photograph the package label.',
    rationale: 'Grounded in a player-visible fact.',
  }, {
    id: 'recommendation.stale-after-turn',
    label: 'Secure the already secured door.',
    rationale: 'This is valid only while the door remains unlocked.',
  }],
  'only recommendations from Arbiter-selected proposals may reach the turn response',
);
const recommendationCommit = await recommendationService.commit(
  envelope.turnId,
  recommendationPreparation.prepared.playerResult.state,
);
assert.deepEqual(
  (recommendationCommit as {
    recommendedActions?: Array<{ id: string; label: string; rationale: string }>;
  }).recommendedActions,
  [{
    id: 'recommendation.accepted',
    label: 'Photograph the package label.',
    rationale: 'Grounded in a player-visible fact.',
  }],
  'recommendations whose cited fact values changed during the turn must not be published',
);

const specialistReplacementWave = wave();
const rejectedMainProposal = {
  ...playerProposal(),
  id: 'proposal.player.main-rejected',
  sourceAgent: 'main-world-model',
};
specialistReplacementWave.mainProposals = [rejectedMainProposal];
specialistReplacementWave.arbitration!.rejectedProposals = [{
  proposalId: rejectedMainProposal.id,
  sourceAgent: rejectedMainProposal.sourceAgent,
  domain: rejectedMainProposal.domain,
  reasonCodes: ['unauthorized_fact_reference'],
}];
specialistReplacementWave.arbitration!.transition.violations = [{
  code: 'unauthorized_fact_reference',
  subjectId: rejectedMainProposal.id,
  detail: 'Rejected main proposal cited a fact outside its authority projection.',
}];
const specialistReplacementService = createLowRiskTakeoverService();
const specialistReplacement = await specialistReplacementService.prepare(
  session(specialistReplacementWave),
  state,
);
assert.equal(
  specialistReplacement.status,
  'prepared',
  'an audited rejected candidate must not block a valid same-domain Specialist replacement',
);
specialistReplacementService.discard(envelope.turnId);

const unsafeTransitionWave = wave();
const unsafeTransitionRecommendation = recommendationProposal(
  'proposal.recommendation.unsafe-transition',
  'recommendation.unsafe-transition',
  'This recommendation must be suppressed with the invalid arbitration.',
);
unsafeTransitionWave.specialistCandidates.push(unsafeTransitionRecommendation);
unsafeTransitionWave.arbitration!.selectedProposalIds.push(unsafeTransitionRecommendation.id);
unsafeTransitionWave.arbitration!.transition.violations = [{
  code: 'unattributed_transition_violation',
  subjectId: 'transition',
  detail: 'A transition-level violation is not explained by an unselected rejected proposal.',
}];
const unsafeTransition = await createLowRiskTakeoverService().prepare(
  session(unsafeTransitionWave),
  state,
);
assert.equal(
  unsafeTransition.status,
  'prepared',
  'an Arbiter violation must not block a deterministic low-risk TurnBrief',
);
if (unsafeTransition.status === 'prepared') {
  assert.deepEqual(
    unsafeTransition.recommendedActions,
    [],
    'an invalid arbitration must still suppress AI-authored creative outputs',
  );
}

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
assert.equal(
  unsafeProposal.status,
  'prepared',
  'Player Proposal risk metadata must not control the deterministic low-risk reducer',
);
service.discard(envelope.turnId);

const mismatchedDeadlineBrief: TurnBrief = {
  ...brief(),
  deadlineAt: new Date(Date.now() + 20_000).toISOString(),
};
const mismatchedDeadline = await service.prepare(session(wave(mismatchedDeadlineBrief)), state);
assert.equal(mismatchedDeadline.status, 'bypassed');
if (mismatchedDeadline.status === 'bypassed') assert.equal(mismatchedDeadline.reason, 'envelope_mismatch');

const unavailableWave = wave();
unavailableWave.semantic = {
  status: 'failed',
  durationMs: 1,
  issues: ['semantic compiler unavailable'],
};
unavailableWave.callRecords = [{
  sourceAgent: 'main-world-model',
  domain: 'world_model',
  status: 'failed',
  durationMs: 1,
  receivedCount: 0,
  schemaValidCount: 0,
  errors: ['provider unavailable'],
}];
const unavailable = await service.prepare(session(unavailableWave), state);
assert.equal(unavailable.status, 'bypassed');
if (unavailable.status === 'bypassed') {
  assert.equal(unavailable.reason, 'shadow_incomplete');
  assert.equal(unavailable.fallbackMode, 'ai_unavailable');
}

const clarificationWave = wave();
clarificationWave.status = 'compiler_unavailable';
clarificationWave.semantic = {
  status: 'clarification_required',
  durationMs: 1,
  issues: ['Which door?'],
};
clarificationWave.turnBrief = undefined;
clarificationWave.arbitration = undefined;
const clarification = await service.prepare(session(clarificationWave), state);
assert.equal(clarification.status, 'bypassed');
if (clarification.status === 'bypassed') {
  assert.equal(clarification.fallbackMode, 'clarification_required');
}

const nonActionBrief: TurnBrief = {
  ...brief(),
  utteranceMode: 'non_action',
  orderedActions: [],
};
const nonActionWave = wave(nonActionBrief);
nonActionWave.status = 'non_action';
nonActionWave.mainProposals = [];
nonActionWave.specialistCandidates = [];
nonActionWave.callRecords = [];
nonActionWave.arbitration = undefined;
const nonAction = await service.prepare(session(nonActionWave), state);
assert.equal(nonAction.status, 'non_action');
if (nonAction.status === 'non_action') {
  assert.equal(nonAction.brief.utteranceMode, 'non_action');
}

const phaseSixService = createLowRiskTakeoverService({ legacyMainPathExitEnabled: true });
assert.equal(phaseSixService.legacyMainPathExitEnabled, true);
assert.equal(phaseSixService.highRiskTakeoverEnabled, true);

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

const recursiveKnowledgeService = createLowRiskTakeoverService();
const recursiveKnowledgePrepared = await recursiveKnowledgeService.prepare(session(), state);
assert.equal(recursiveKnowledgePrepared.status, 'prepared');
if (recursiveKnowledgePrepared.status !== 'prepared') {
  throw new Error('expected recursive-knowledge preparation');
}
const recursiveKnowledgeState = structuredClone(
  recursiveKnowledgePrepared.prepared.playerResult.state,
);
for (const id of ['package_label_fragment', 'no_matching_order']) {
  recursiveKnowledgeState.clues.push({
    id,
    title: id,
    detail: id,
    source: 'player_discovered',
    weight: 1,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });
}
const recursiveKnowledgeCommitted = await recursiveKnowledgeService.commit(
  envelope.turnId,
  recursiveKnowledgeState,
);
assert.equal(
  recursiveKnowledgeCommitted.state?.activatedKnowledge.some(
    (knowledge) => knowledge.id === 'package_not_players_order',
  ),
  true,
  'recursive conclusions must be present in the atomically committed state',
);

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

{
  const clueState = createInitialGameState();
  clueState.room.package.state.photographed = true;
  clueState.world = createInitialWorldState();
  const selectedClue = clueProposal('proposal.clue.selected-photo', 'package_photo');
  const unselectedClue = clueProposal('proposal.clue.unselected-label', 'wrong_package');
  const clueWave = wave(brief('wait', ['player']));
  clueWave.specialistCandidates.push(selectedClue, unselectedClue);
  clueWave.arbitration!.selectedProposalIds.push(selectedClue.id);
  clueWave.arbitration!.transition.acceptedEvents.push(...selectedClue.proposedEvents);
  clueWave.arbitration!.transition.selectedSourceByDomain.clue = selectedClue.sourceAgent;

  const clueService = createLowRiskTakeoverService({ knowledgeClueTakeoverEnabled: true });
  const cluePrepared = await clueService.prepare(session(clueWave), clueState);
  assert.equal(cluePrepared.status, 'prepared');
  if (cluePrepared.status !== 'prepared') throw new Error('expected clue-specialist preparation');
  const clueCommitted = await clueService.commit(
    envelope.turnId,
    cluePrepared.prepared.playerResult.state,
  );
  assert.equal(clueCommitted.outcome.result.commitStatus, 'committed');
  assert.equal(
    clueCommitted.state?.clues.some((clue) => clue.id === 'package_photo'),
    true,
    'an Arbiter-selected and deterministically validated Clue Specialist candidate must be formalized',
  );
  assert.equal(
    clueCommitted.state?.clues.some((clue) => clue.id === 'wrong_package'),
    false,
    'an unselected Clue Specialist candidate must not enter formal state',
  );
  assert.equal(
    clueCommitted.outcome.confirmedEvents.some((event) => event.id === selectedClue.proposedEvents[0].id),
    true,
    'the observation event supporting a formal clue must be committed atomically',
  );
  assert.deepEqual(
    clueCommitted.knowledgeClueProjection?.acceptedSpecialistClueIds,
    ['package_photo'],
  );

  const unsafeClue = clueProposal('proposal.clue.unsafe-photo', 'package_photo');
  unsafeClue.riskClass = 'high_impact';
  unsafeClue.proposedEvents[0].riskClass = 'high_impact';
  const unsafeClueWave = wave(brief('wait', ['player']));
  unsafeClueWave.specialistCandidates.push(unsafeClue);
  unsafeClueWave.arbitration!.selectedProposalIds.push(unsafeClue.id);
  unsafeClueWave.arbitration!.transition.acceptedEvents.push(...unsafeClue.proposedEvents);
  const unsafeClueService = createLowRiskTakeoverService({ knowledgeClueTakeoverEnabled: true });
  const unsafeCluePrepared = await unsafeClueService.prepare(session(unsafeClueWave), clueState);
  assert.equal(unsafeCluePrepared.status, 'prepared');
  if (unsafeCluePrepared.status !== 'prepared') throw new Error('expected safe low-risk preparation');
  const unsafeClueCommitted = await unsafeClueService.commit(
    envelope.turnId,
    unsafeCluePrepared.prepared.playerResult.state,
  );
  assert.equal(unsafeClueCommitted.outcome.result.commitStatus, 'committed');
  assert.equal(
    unsafeClueCommitted.state?.clues.some((clue) => clue.id === 'package_photo'),
    false,
    'an unsafe Clue Specialist candidate must not enter formal state',
  );
  assert.equal(
    unsafeClueCommitted.outcome.confirmedEvents.some((event) => event.id === unsafeClue.proposedEvents[0].id),
    false,
    'an unsafe clue observation event must not be committed',
  );
  assert.deepEqual(
    unsafeClueCommitted.knowledgeClueProjection?.rejectedSpecialistClueIds,
    ['package_photo'],
  );
}

{
  const phaseFiveState = createInitialGameState();
  phaseFiveState.world = createInitialWorldState();
  phaseFiveState.world.characters.chen_huaimin.location = 'corridor_5f';
  const attempted: ProposedEvent = {
    id: 'event.phase5.entry-attempted',
    kind: 'action',
    sourceActionIds: [],
    actorId: 'chen_huaimin',
    operation: 'enter',
    targetIds: ['room_503'],
    status: 'attempted',
    summary: 'Untrusted entry attempt.',
    assertions: [{
      id: 'assertion.phase5.entry-attempted.route',
      subject: 'room_503',
      predicate: 'entry_route',
      value: 'front_door',
      visibleTo: ['player'],
    }],
    visibility: ['player'],
    riskClass: 'reversible',
    evidenceRefs: [],
    causalParentIds: [],
  };
  const entered: ProposedEvent = {
    id: 'event.phase5.actor-entered',
    kind: 'action',
    sourceActionIds: [],
    actorId: 'chen_huaimin',
    operation: 'enter',
    targetIds: ['room_503'],
    status: 'completed',
    summary: 'Untrusted forced entry.',
    assertions: [{
      id: 'assertion.phase5.actor-entered.route',
      subject: 'room_503',
      predicate: 'entry_route',
      value: 'front_door',
      visibleTo: ['player'],
    }, {
      id: 'assertion.phase5.actor-entered.location',
      subject: 'chen_huaimin',
      predicate: 'location',
      value: 'room_503',
      visibleTo: ['player'],
    }],
    visibility: ['player'],
    riskClass: 'high_impact',
    evidenceRefs: [
      attempted.id,
      'fact.object.front_door.chainLocked',
      'fact.object.front_door.barricaded',
      'capability.killer.spare_key',
      'invariant.entry.requires_clear_barrier',
    ],
    causalParentIds: [attempted.id],
  };
  const phaseFiveService = createLowRiskTakeoverService({
    highRiskTakeoverEnabled: true,
  });
  const phaseFivePrepared = await phaseFiveService.prepare(
    session(phaseFiveWave(brief(), [attempted, entered])),
    phaseFiveState,
  );
  assert.equal(phaseFivePrepared.status, 'prepared');
  if (phaseFivePrepared.status !== 'prepared') throw new Error('expected phase-five preparation');

  const untrustedLegacyState = structuredClone(phaseFivePrepared.prepared.playerResult.state);
  untrustedLegacyState.ending = 'death';
  untrustedLegacyState.endingReason = 'forced_entry';
  untrustedLegacyState.phase = 'death';
  untrustedLegacyState.player.injury = 'critical';
  untrustedLegacyState.log.push({
    id: 'legacy-untrusted-death',
    run: untrustedLegacyState.run,
    minute: untrustedLegacyState.minute,
    title: 'Untrusted death',
    text: 'This legacy death must not be committed.',
    tone: 'death',
  });

  const phaseFiveCommitted = await phaseFiveService.commit(
    envelope.turnId,
    untrustedLegacyState,
  );
  assert.equal(phaseFiveCommitted.outcome.result.commitStatus, 'committed');
  assert.equal(phaseFiveCommitted.state?.ending, null);
  assert.equal(phaseFiveCommitted.state?.player.injury, 'none');
  assert.equal(
    phaseFiveCommitted.state?.log.some((entry) => entry.id === 'legacy-untrusted-death'),
    false,
  );
  assert.equal(
    phaseFiveCommitted.outcome.confirmedEvents.some((item) => item.id === entered.id),
    false,
  );
  assert.equal(
    phaseFiveCommitted.outcome.confirmedEvents.some((item) => item.id === `${entered.id}.blocked`),
    true,
  );
  assert.equal(phaseFiveCommitted.highRiskProjection?.rejectedEventIds.includes(entered.id), true);
  assert.equal(
    phaseFiveCommitted.outcome.displayFragments.some((fragment) => fragment.text.includes('Untrusted')),
    false,
  );
}

{
  const authorityState = createInitialGameState();
  authorityState.world = createInitialWorldState();
  const unauthorizedMove: ProposedEvent = {
    id: 'event.phase5.unauthorized-killer-move',
    kind: 'state_transition',
    sourceActionIds: [],
    actorId: 'chen_huaimin',
    operation: 'move',
    targetIds: ['corridor_5f'],
    status: 'completed',
    summary: 'Lin Yue must not control the killer.',
    assertions: [{
      id: 'assertion.phase5.unauthorized-killer-move.location',
      subject: 'chen_huaimin',
      predicate: 'location',
      value: 'corridor_5f',
      visibleTo: ['player'],
    }],
    visibility: ['player'],
    riskClass: 'high_impact',
    evidenceRefs: ['fact.world.character.chen_huaimin.location'],
    causalParentIds: [],
  };
  const player = playerProposal();
  const npc = {
    ...killerProposal([unauthorizedMove]),
    id: 'proposal.npc.unauthorized',
    domain: 'npc' as const,
    actorId: 'lin_yue',
    operation: 'move',
  };
  const authorityWave = wave(brief('inspect', ['package']), player);
  authorityWave.mainProposals = [npc];
  authorityWave.arbitration!.selectedProposalIds = [player.id, npc.id];
  authorityWave.arbitration!.transition.acceptedEvents = [
    ...player.proposedEvents,
    unauthorizedMove,
  ];
  authorityWave.arbitration!.transition.selectedSourceByDomain.npc = npc.sourceAgent;

  const authorityService = createLowRiskTakeoverService({
    highRiskTakeoverEnabled: true,
  });
  const authorityPrepared = await authorityService.prepare(
    session(authorityWave),
    authorityState,
  );
  assert.equal(authorityPrepared.status, 'prepared');
  if (authorityPrepared.status !== 'prepared') throw new Error('expected authority preparation');
  const authorityCommitted = await authorityService.commit(
    envelope.turnId,
    authorityPrepared.prepared.playerResult.state,
  );
  assert.equal(
    authorityCommitted.state?.world?.characters.chen_huaimin.location,
    'room_501',
  );
  assert.equal(
    authorityCommitted.highRiskProjection?.rejectedEventIds.includes(unauthorizedMove.id),
    true,
  );
  assert.equal(
    authorityCommitted.highRiskProjection?.highRiskDecisions
      .find((decision) => decision.eventId === unauthorizedMove.id)
      ?.reasonCodes.includes('proposal_actor_not_authorized'),
    true,
  );
}
