import { describe, expect, it } from 'vitest';
import {
  ConfirmedEventSchema,
  EventKindValues,
  FactSchema,
  HighRiskDecisionSchema,
  ProposedAssertionSchema,
  ProposedEventSchema,
  ProposedObservationSchema,
  ProposalSchema,
  SemanticCompilerRequestSchema,
  SemanticCompilerResultSchema,
  SpecialistCandidateSchema,
  StateTransitionResultSchema,
  TurnBriefSchema,
  TurnCommitResultSchema,
  TurnEnvelopeSchema,
  WORLD_MODEL_SCHEMA_VERSION,
} from './world-model-contracts';

const envelope = {
  loopId: 'loop-1',
  turnId: 'turn-7',
  inputStateVersion: 6,
  deadlineAt: '2026-07-20T12:00:01.000Z',
};

const proposedEvent = {
  id: 'event.photo.created',
  kind: 'action' as const,
  actorId: 'player',
  operation: 'photograph',
  targetIds: ['package'],
  status: 'completed' as const,
  summary: 'A photograph of the package exterior is created.',
  assertions: [{
    id: 'assertion.photo.created',
    subject: 'candidate.photo.action-1',
    predicate: 'exists',
    value: true,
    visibleTo: ['player'],
  }],
  visibility: ['player'],
  riskClass: 'reversible' as const,
  evidenceRefs: ['fact.player.has_phone'],
  causalParentIds: [],
};

const proposal = {
  ...envelope,
  id: 'proposal-main-player',
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
  sourceAgent: 'main-world-model',
  domain: 'player',
  candidateRank: 0,
  turnBriefActionIds: ['action-1'],
  replacementFor: [],
  actorId: 'player',
  operation: 'photograph',
  targetIds: ['package'],
  basedOnFactIds: ['fact.player.has_phone'],
  preconditions: [{ id: 'precondition-phone', kind: 'fact', ref: 'fact.player.has_phone' }],
  forbiddenScopes: ['package.interior'],
  proposedEffects: [{
    id: 'effect-photo',
    targetType: 'entity',
    targetId: 'candidate.photo.action-1',
    operation: 'create',
    path: 'existence',
    value: true,
    causalParentIds: [],
  }],
  observations: [],
  visibility: ['player'],
  confidence: 0.96,
  riskClass: 'reversible' as const,
  evidenceRefs: ['fact.player.has_phone'],
  causalParentIds: [],
  proposedEvents: [proposedEvent],
  clueCandidates: [],
  recommendations: [],
  displayFragments: [{
    id: 'display-photo',
    text: 'You photograph only the exterior label.',
    eventRefs: ['event.photo.created'],
    claimRefs: ['assertion.photo.created'],
  }],
};

describe('AI-first phase-one contracts', () => {
  it('uses a small mechanism-level event vocabulary with structured assertions', () => {
    expect(EventKindValues).toEqual([
      'action',
      'state_transition',
      'information_transfer',
      'observation',
      'timer',
      'ending',
    ]);

    const assertion = {
      id: 'assertion-photo-created',
      subject: 'candidate.photo.action-1',
      predicate: 'exists',
      value: true,
      visibleTo: ['player'],
    };
    expect(ProposedAssertionSchema.parse(assertion)).toEqual(assertion);

    const event = {
      id: 'event.photo.created',
      kind: 'action',
      actorId: 'player',
      operation: 'photograph',
      targetIds: ['package'],
      status: 'completed',
      summary: 'A photograph of the visible exterior was created.',
      assertions: [assertion],
      visibility: ['player'],
      riskClass: 'reversible' as const,
      evidenceRefs: ['fact.player.has_phone'],
      causalParentIds: [],
    };
    expect(ProposedEventSchema.parse(event)).toEqual(event);
    expect(ProposedEventSchema.safeParse({
      ...event,
      eventType: 'package_photographed',
      facts: ['fact.package.photo'],
    }).success).toBe(false);
  });

  it('requires a versioned, deadline-aware turn envelope', () => {
    expect(TurnEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(TurnEnvelopeSchema.safeParse({ ...envelope, deadlineAt: 'tomorrow' }).success).toBe(false);
    expect(TurnEnvelopeSchema.safeParse({ ...envelope, inputStateVersion: -1 }).success).toBe(false);
  });

  it('validates facts with provenance and visibility metadata', () => {
    const fact = {
      id: 'fact.front_door.chain_locked',
      subject: 'front_door',
      predicate: 'chain_locked',
      value: true,
      sourceEventId: 'event.player.secured_door',
      visibleTo: ['player'],
      knownBy: ['player'],
      validFromTurn: 'turn-7',
      invalidatedBy: null,
    };

    expect(FactSchema.parse(fact)).toEqual(fact);
    expect(FactSchema.safeParse({ ...fact, sourceEventId: '' }).success).toBe(false);
  });

  it('preserves ordered actions, restrictions, references, and candidate dependencies', () => {
    const brief = {
      ...envelope,
      compilerVersion: 'semantic-compiler-v1',
      schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
      utteranceMode: 'command',
      resolvedReferences: [{
        referenceId: 'reference-package',
        originalSpan: { start: 4, end: 6, text: '包裹' },
        entityIds: ['package'],
        confidence: 1,
      }],
      orderedActions: [{
        actionId: 'action-1',
        actorId: 'player',
        operation: 'photograph',
        targetIds: ['package'],
        scope: 'exterior.label',
        method: 'phone_camera',
        dependsOnActionIds: [],
        inputHandleIds: [],
        outputHandleIds: ['candidate.photo.action-1'],
        originalSpan: { start: 0, end: 6, text: '只拍包裹' },
      }],
      globalConstraints: [{
        id: 'constraint-no-open',
        type: 'must_not',
        actionIds: [],
        value: 'open_package',
        originalSpan: { start: 7, end: 12, text: '不要拆开' },
      }],
      scopedConstraints: [],
      communications: [],
      candidateHandles: [{
        id: 'candidate.photo.action-1',
        kind: 'photo',
        producedByActionId: 'action-1',
        dependsOnActionIds: ['action-1'],
      }],
      ambiguities: [],
    };

    expect(TurnBriefSchema.parse(brief)).toEqual(brief);
    expect(TurnBriefSchema.safeParse({
      ...brief,
      orderedActions: [{ ...brief.orderedActions[0], actionId: '' }],
    }).success).toBe(false);

    const compilerRequest = {
      ...envelope,
      rawInput: '只拍包裹，不要拆开',
      playerContext: {
        facts: [],
        accessibleEntityIds: ['player', 'package', 'phone'],
        capabilities: ['photograph'],
        activeCommunicationActorIds: ['lin_yue'],
        recentConfirmedEventIds: [],
        entityAliasIndex: { 包裹: ['package'] },
        recentReferenceCandidates: [],
        phaseSummary: 'The player has just found the package.',
      },
    };
    expect(SemanticCompilerRequestSchema.parse(compilerRequest)).toEqual(compilerRequest);
    expect(SemanticCompilerRequestSchema.safeParse({
      ...compilerRequest,
      state: { killerKnowledge: { knowsEverything: true } },
    }).success).toBe(false);
    expect(SemanticCompilerResultSchema.parse({ status: 'compiled', brief }).status).toBe('compiled');
  });

  it('requires proposal provenance, ranking, evidence, risk, and version fields', () => {
    expect(ProposalSchema.parse(proposal)).toEqual(proposal);
    const { evidenceRefs: _evidenceRefs, ...withoutEvidence } = proposal;
    expect(ProposalSchema.safeParse(withoutEvidence).success).toBe(false);

    expect(SpecialistCandidateSchema.parse({
      ...proposal,
      id: 'proposal-player-specialist-1',
      candidateType: 'specialist',
      specialistId: 'player-specialist',
      candidateRank: 1,
    }).candidateType).toBe('specialist');
  });

  it('requires observations to expose structured assertions from explicit source events', () => {
    const observation = {
      id: 'observation.package.photo',
      subject: 'package',
      predicate: 'photographed',
      value: true,
      scope: 'exterior',
      basedOnEffectIds: ['effect-photo'],
      basedOnEventIds: ['event.photo.created'],
      visibleAssertionIds: ['assertion.photo.created'],
    };

    expect(ProposedObservationSchema.parse(observation)).toEqual(observation);
    const { basedOnEventIds: _basedOnEventIds, ...withoutSourceEvents } = observation;
    expect(ProposedObservationSchema.safeParse(withoutSourceEvents).success).toBe(false);
    const { visibleAssertionIds: _visibleAssertionIds, ...withoutVisibleAssertions } = observation;
    expect(ProposedObservationSchema.safeParse(withoutVisibleAssertions).success).toBe(false);
  });

  it('separates adjudication, high-risk gating, commit, and confirmation', () => {
    const transition = {
      ...envelope,
      acceptedEvents: [proposedEvent],
      correctedEvents: [],
      rejectedEffects: [],
      violations: [],
      selectedSourceByDomain: { player: 'main-world-model' },
      specialistCandidatesTried: [],
      fallbackDomains: [],
      requiresRepair: false,
      requiresPlayerClarification: false,
      expectedOutputStateVersion: 7,
    };
    expect(StateTransitionResultSchema.parse(transition)).toEqual(transition);
    expect(StateTransitionResultSchema.safeParse({
      ...transition,
      expectedOutputStateVersion: transition.inputStateVersion,
    }).success).toBe(false);

    const highRiskDecision = {
      eventId: 'event.ending.death',
      riskClass: 'irreversible',
      evidenceRefs: ['event.attack.confirmed', 'invariant.death_requires_damage'],
      decision: 'pass',
      reasonCodes: ['causal_chain_complete', 'deterministic_evidence_present'],
    };
    expect(HighRiskDecisionSchema.parse(highRiskDecision)).toEqual(highRiskDecision);
    expect(HighRiskDecisionSchema.safeParse({
      ...highRiskDecision,
      evidenceRefs: [],
    }).success).toBe(false);

    const commit = {
      loopId: 'loop-1',
      turnId: 'turn-7',
      inputStateVersion: 6,
      outputStateVersion: 7,
      commitStatus: 'committed',
      confirmedEventIds: ['event.photo.created'],
    };
    expect(TurnCommitResultSchema.parse(commit)).toEqual(commit);
    expect(TurnCommitResultSchema.safeParse({
      ...commit,
      outputStateVersion: commit.inputStateVersion,
    }).success).toBe(false);
    expect(TurnCommitResultSchema.safeParse({
      ...commit,
      outputStateVersion: 7,
      commitStatus: 'conflict',
      confirmedEventIds: [],
    }).success).toBe(false);

    const confirmedEvent = {
      ...proposedEvent,
      loopId: 'loop-1',
      turnId: 'turn-7',
      inputStateVersion: 6,
      outputStateVersion: 7,
      sourceProposalId: proposal.id,
      confirmedAt: '2026-07-20T12:00:00.500Z',
    };
    expect(ConfirmedEventSchema.parse(confirmedEvent)).toEqual(confirmedEvent);
    expect(ConfirmedEventSchema.safeParse({
      ...confirmedEvent,
      outputStateVersion: confirmedEvent.inputStateVersion,
    }).success).toBe(false);
  });
});
