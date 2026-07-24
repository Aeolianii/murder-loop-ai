import assert from 'node:assert/strict';
import type {
  Proposal,
  ProposalDomain,
  ProposedEvent,
  SpecialistCandidate,
  TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import {
  compareShadowWithLegacy,
  buildShadowArbitrationMetrics,
  evaluateShadowHighRiskGate,
  runShadowArbiter,
  simulateShadowCommit,
} from './shadowArbiter';

const envelope: TurnEnvelope = {
  loopId: 'loop-1',
  turnId: 'turn-2',
  inputStateVersion: 1,
  deadlineAt: '2026-07-20T12:00:02.000Z',
};

function proposedEvent(
  id: string,
  operation: string,
  riskClass: ProposedEvent['riskClass'] = 'reversible',
  evidenceRefs: string[] = [],
  causalParentIds: string[] = [],
  actorId = 'player',
  sourceActionIds = ['action-1'],
): ProposedEvent {
  const targetId = id.split('.').at(-1) ?? id;
  return {
    id,
    kind: operation === 'resolve_ending' ? 'ending' : 'action',
    sourceActionIds,
    actorId,
    operation,
    targetIds: [targetId],
    status: 'completed',
    summary: `${operation} proposed`,
    assertions: [{
      id: `assertion.${id}`,
      subject: targetId,
      predicate: 'result',
      value: operation,
      visibleTo: ['player'],
    }],
    visibility: ['player'],
    riskClass,
    evidenceRefs,
    causalParentIds,
  };
}

function proposal(input: {
  id: string;
  sourceAgent: string;
  domain: ProposalDomain;
  basedOnFactIds?: string[];
  events: ProposedEvent[];
  rank?: number;
}): Proposal {
  const actorId = input.domain === 'killer' ? 'killer' : 'player';
  const events = input.events.map((event) => ({ ...event, actorId }));
  return {
    ...envelope,
    id: input.id,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent: input.sourceAgent,
    domain: input.domain,
    candidateRank: input.rank ?? 0,
    turnBriefActionIds: ['action-1'],
    replacementFor: [],
    actorId,
    operation: events[0]?.operation ?? 'wait',
    targetIds: ['package'],
    basedOnFactIds: input.basedOnFactIds ?? [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [],
    visibility: ['player'],
    confidence: 0.9,
    riskClass: input.events.some((event) => event.riskClass === 'irreversible') ? 'irreversible' : 'reversible',
    evidenceRefs: input.events.flatMap((event) => event.evidenceRefs),
    causalParentIds: [],
    proposedEvents: events,
    clueCandidates: [],
    recommendations: [],
    displayFragments: events.map((event) => ({
      id: `display.${event.id}`,
      text: event.summary,
      eventRefs: [event.id],
      claimRefs: event.assertions.map((assertion) => assertion.id),
    })),
  };
}

function specialist(base: Proposal, specialistId: string): SpecialistCandidate {
  return {
    ...base,
    candidateType: 'specialist',
    specialistId,
  };
}

const mainPlayer = proposal({
  id: 'proposal.main.player',
  sourceAgent: 'main-world-model',
  domain: 'player',
  basedOnFactIds: ['fact.player.has_phone'],
  events: [proposedEvent('event.shadow.photo', 'photograph', 'reversible', ['fact.player.has_phone'])],
});
const validPlayerSpecialist = specialist(proposal({
  id: 'proposal.specialist.player',
  sourceAgent: 'player-specialist',
  domain: 'player',
  basedOnFactIds: ['fact.player.has_phone'],
  events: [proposedEvent('event.shadow.player_waited', 'wait')],
  rank: 1,
}), 'player-specialist');
const leakingMainKiller = proposal({
  id: 'proposal.main.killer',
  sourceAgent: 'main-world-model',
  domain: 'killer',
  basedOnFactIds: ['fact.player.private_memory'],
  events: [proposedEvent('event.shadow.killer_probe', 'probe')],
});
const killerSpecialist = specialist(proposal({
  id: 'proposal.specialist.killer',
  sourceAgent: 'killer-specialist',
  domain: 'killer',
  basedOnFactIds: ['fact.killer.in_corridor'],
  events: [proposedEvent(
    'event.shadow.killer_death_claim',
    'resolve_ending',
    'irreversible',
    [],
  )],
  rank: 1,
}), 'killer-specialist');
const invalidClue = proposal({
  id: 'proposal.main.clue',
  sourceAgent: 'main-world-model',
  domain: 'clue',
  events: [proposedEvent('event.shadow.clue', 'discover')],
});
invalidClue.clueCandidates = [{
  id: 'clue-internal-note',
  claimAssertionIds: ['assertion.package_contains_note'],
  basedOnObservationIds: ['observation.package.interior.missing'],
  visibleAssertionIds: [],
  confidence: 0.8,
}];

const report = runShadowArbiter({
  envelope,
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: 'world-model-v1',
  mainProposals: [mainPlayer, leakingMainKiller, invalidClue],
  specialistCandidates: [validPlayerSpecialist, killerSpecialist],
  requiredDomains: ['player', 'killer', 'clue'],
  sourcePolicies: {
    'main-world-model': {
      allowedDomains: ['player', 'killer', 'clue'],
      authorizedFactIds: ['fact.player.has_phone', 'fact.killer.in_corridor'],
    },
    'player-specialist': {
      allowedDomains: ['player'],
      authorizedFactIds: ['fact.player.has_phone'],
    },
    'killer-specialist': {
      allowedDomains: ['killer'],
      authorizedFactIds: ['fact.killer.in_corridor'],
    },
  },
  availableEvidenceRefs: ['fact.player.has_phone', 'fact.killer.in_corridor'],
  availableObservationIds: [],
  visibleConfirmedEventIds: ['legacy.package_seen'],
});

assert.equal(report.transition.selectedSourceByDomain.player, 'main-world-model');
assert.equal(report.selectedProposalIds.includes(validPlayerSpecialist.id), false);
assert.equal(report.transition.selectedSourceByDomain.killer, 'killer-specialist');
assert.deepEqual(report.transition.fallbackDomains, ['clue']);
assert(report.rejectedProposals.some((item) => (
  item.proposalId === leakingMainKiller.id && item.reasonCodes.includes('unauthorized_fact_reference')
)));
assert(report.rejectedProposals.some((item) => (
  item.proposalId === invalidClue.id && item.reasonCodes.includes('observation_source_missing')
)));
assert.equal(report.transition.acceptedEvents.some((event) => event.id === 'event.shadow.photo'), true);

{
  const advisoryMain = proposal({
    id: 'proposal.main.player.advisory-fact',
    sourceAgent: 'main-world-model',
    domain: 'player',
    basedOnFactIds: ['fact.player.has_phone', 'fact.npc.private_location'],
    events: [proposedEvent(
      'event.shadow.advisory-photo',
      'photograph',
      'reversible',
      ['fact.player.has_phone'],
    )],
  });
  const advisoryReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [advisoryMain],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: { player: ['action-1'] },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: ['fact.player.has_phone'],
        factAuthorizationMode: 'advisory_for_reversible_player',
      },
    },
    availableEvidenceRefs: ['fact.player.has_phone'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  assert.deepEqual(advisoryReport.selectedProposalIds, [advisoryMain.id]);
  assert.equal(advisoryReport.rejectedProposals.length, 0);
  assert.deepEqual(advisoryReport.advisories, [{
    proposalId: advisoryMain.id,
    sourceAgent: advisoryMain.sourceAgent,
    domain: advisoryMain.domain,
    reasonCodes: ['unauthorized_fact_reference'],
  }]);

  const strictReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [advisoryMain],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: { player: ['action-1'] },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: ['fact.player.has_phone'],
        factAuthorizationMode: 'strict',
      },
    },
    availableEvidenceRefs: ['fact.player.has_phone'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(strictReport.rejectedProposals.some((item) => (
    item.proposalId === advisoryMain.id
    && item.reasonCodes.includes('unauthorized_fact_reference')
  )));

  const unauthorizedPreconditionMain = structuredClone(advisoryMain);
  unauthorizedPreconditionMain.id = 'proposal.main.player.unauthorized-precondition';
  unauthorizedPreconditionMain.basedOnFactIds = ['fact.player.has_phone'];
  unauthorizedPreconditionMain.preconditions = [{
    id: 'precondition.private-location',
    kind: 'fact',
    ref: 'fact.npc.private_location',
  }];
  const preconditionReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [unauthorizedPreconditionMain],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: { player: ['action-1'] },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: ['fact.player.has_phone'],
        factAuthorizationMode: 'advisory_for_reversible_player',
      },
    },
    availableEvidenceRefs: ['fact.player.has_phone'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(preconditionReport.rejectedProposals.some((item) => (
    item.proposalId === unauthorizedPreconditionMain.id
    && item.reasonCodes.includes('precondition_unauthorized')
  )));

  const unsafeMain = proposal({
    id: 'proposal.main.player.unsafe-advisory-fact',
    sourceAgent: 'main-world-model',
    domain: 'player',
    basedOnFactIds: ['fact.npc.private_location'],
    events: [proposedEvent(
      'event.shadow.unsafe-ending',
      'resolve_ending',
      'irreversible',
      ['fact.player.has_phone'],
    )],
  });
  const unsafeReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [unsafeMain],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: { player: ['action-1'] },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: ['fact.player.has_phone'],
        factAuthorizationMode: 'advisory_for_reversible_player',
      },
    },
    availableEvidenceRefs: ['fact.player.has_phone'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(unsafeReport.rejectedProposals.some((item) => (
    item.proposalId === unsafeMain.id
    && item.reasonCodes.includes('unauthorized_fact_reference')
  )));
}

{
  const incompletePlayerProposal = proposal({
    id: 'proposal.main.player.incomplete',
    sourceAgent: 'main-world-model',
    domain: 'player',
    basedOnFactIds: ['fact.player.has_phone'],
    events: [proposedEvent(
      'event.shadow.only-photo',
      'photograph',
      'reversible',
      ['fact.player.has_phone'],
      [],
      'player',
      ['action-1'],
    )],
  });
  incompletePlayerProposal.turnBriefActionIds = ['action-1', 'action-2'];

  const incompleteReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [incompletePlayerProposal],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: {
      player: ['action-1', 'action-2'],
    },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: ['fact.player.has_phone'],
      },
    },
    availableEvidenceRefs: ['fact.player.has_phone'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  assert.deepEqual(incompleteReport.transition.fallbackDomains, ['player']);
  assert(incompleteReport.rejectedProposals.some((item) => (
    item.proposalId === incompletePlayerProposal.id
    && item.reasonCodes.includes('turn_action_unresolved')
  )));
}

{
  const terminallyInterruptedProposal = proposal({
    id: 'proposal.main.player.terminal-interruption',
    sourceAgent: 'main-world-model',
    domain: 'player',
    events: [
      proposedEvent(
        'event.shadow.terminal-action',
        'act',
        'reversible',
        [],
        [],
        'player',
        ['action-1'],
      ),
      proposedEvent(
        'event.shadow.terminal-ending',
        'resolve_ending',
        'reversible',
        [],
        ['event.shadow.terminal-action'],
        'player',
        ['action-1'],
      ),
    ],
  });
  terminallyInterruptedProposal.turnBriefActionIds = ['action-1', 'action-2'];

  const terminalReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [terminallyInterruptedProposal],
    specialistCandidates: [],
    requiredDomains: ['player'],
    requiredActionIdsByDomain: {
      player: ['action-1', 'action-2'],
    },
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: [],
      },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  assert.deepEqual(
    terminalReport.transition.fallbackDomains,
    [],
    'a confirmed ending must causally stop later ordered actions instead of invalidating the whole proposal',
  );
  assert(terminalReport.selectedProposalIds.includes(terminallyInterruptedProposal.id));
}

{
  const factGroundedRecommendation = specialist(proposal({
    id: 'proposal.specialist.recommendation.fact-grounded',
    sourceAgent: 'recommendation-specialist',
    domain: 'recommendation',
    basedOnFactIds: ['fact.player.phone_battery'],
    events: [],
  }), 'recommendation-specialist');
  factGroundedRecommendation.turnBriefActionIds = [];
  factGroundedRecommendation.recommendations = [{
    id: 'recommendation.charge-phone',
    label: 'Charge the phone',
    rationale: 'The visible battery fact supports keeping the phone available.',
    basedOnFactIds: ['fact.player.phone_battery'],
    basedOnEventIds: [],
  }];

  const recommendationReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [],
    specialistCandidates: [factGroundedRecommendation],
    requiredDomains: ['recommendation'],
    sourcePolicies: {
      'recommendation-specialist': {
        allowedDomains: ['recommendation'],
        authorizedFactIds: ['fact.player.phone_battery'],
      },
    },
    availableEvidenceRefs: ['fact.player.phone_battery'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert.deepEqual(recommendationReport.selectedProposalIds, [factGroundedRecommendation.id]);

  const unauthorizedRecommendation = structuredClone(factGroundedRecommendation);
  unauthorizedRecommendation.id = 'proposal.specialist.recommendation.unauthorized-fact';
  unauthorizedRecommendation.recommendations[0].basedOnFactIds = ['fact.killer.private_plan'];
  const unauthorizedRecommendationReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [],
    specialistCandidates: [unauthorizedRecommendation],
    requiredDomains: ['recommendation'],
    sourcePolicies: {
      'recommendation-specialist': {
        allowedDomains: ['recommendation'],
        authorizedFactIds: ['fact.player.phone_battery'],
      },
    },
    availableEvidenceRefs: ['fact.player.phone_battery'],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(unauthorizedRecommendationReport.rejectedProposals.some((item) => (
    item.proposalId === unauthorizedRecommendation.id
    && item.reasonCodes.includes('recommendation_fact_unauthorized')
  )));
}

{
  const photoAssertionId = 'assertion.package.exterior.photo_captured';
  const photoEvent = proposedEvent('event.shadow.photo-observed', 'photograph');
  photoEvent.assertions = [{
    id: photoAssertionId,
    subject: 'package',
    predicate: 'photo_captured',
    value: true,
    visibleTo: ['player'],
  }];
  const provenanceClue = proposal({
    id: 'proposal.provenance-clue',
    sourceAgent: 'main-world-model',
    domain: 'clue',
    events: [photoEvent],
  });
  provenanceClue.observations = [{
    id: 'observation.package.photo',
    subject: 'package',
    predicate: 'photographed',
    value: true,
    scope: 'exterior',
    basedOnEffectIds: [],
    basedOnEventIds: [photoEvent.id],
    visibleAssertionIds: [photoAssertionId],
  }];
  provenanceClue.clueCandidates = [{
    id: 'clue.package-photo',
    claimAssertionIds: [photoAssertionId],
    basedOnObservationIds: ['observation.package.photo'],
    visibleAssertionIds: [photoAssertionId],
    confidence: 1,
  }];

  const provenanceReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [provenanceClue],
    specialistCandidates: [],
    requiredDomains: ['clue'],
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['clue'],
        authorizedFactIds: [],
      },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  assert.deepEqual(
    provenanceReport.selectedProposalIds,
    [provenanceClue.id],
    'a clue must cite canonical facts exposed by its source observation, not repeat its predicate text',
  );
}

{
  const harmlessAssertionId = 'assertion.package.contains_harmless_item';
  const harmlessEvent = proposedEvent('event.shadow.harmless-observed', 'inspect');
  harmlessEvent.assertions = [{
    id: harmlessAssertionId,
    subject: 'package',
    predicate: 'contains',
    value: 'harmless_item',
    visibleTo: ['player'],
  }];
  const ambiguousPredicateClue = proposal({
    id: 'proposal.ambiguous-predicate-clue',
    sourceAgent: 'main-world-model',
    domain: 'clue',
    events: [harmlessEvent],
  });
  ambiguousPredicateClue.observations = [{
    id: 'observation.package.contents',
    subject: 'package',
    predicate: 'contains',
    value: 'harmless_item',
    scope: 'interior',
    basedOnEffectIds: [],
    basedOnEventIds: [harmlessEvent.id],
    visibleAssertionIds: [harmlessAssertionId],
  }];
  ambiguousPredicateClue.clueCandidates = [{
    id: 'clue.ambiguous-contains',
    claimAssertionIds: ['contains'],
    basedOnObservationIds: ['observation.package.contents'],
    visibleAssertionIds: [harmlessAssertionId],
    confidence: 1,
  }];

  const ambiguousPredicateReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [ambiguousPredicateClue],
    specialistCandidates: [],
    requiredDomains: ['clue'],
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['clue'],
        authorizedFactIds: [],
      },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });

  const rejection = ambiguousPredicateReport.rejectedProposals.find(
    (item) => item.proposalId === ambiguousPredicateClue.id,
  );
  assert(
    rejection?.reasonCodes.includes('clue_assertion_not_observed'),
    'matching only predicate text must not authorize a clue that ignores the observed subject and value',
  );
}

{
  const malformedObservationProposal = proposal({
    id: 'proposal.malformed-observation',
    sourceAgent: 'main-world-model',
    domain: 'clue',
    events: [proposedEvent('event.shadow.malformed-observation', 'inspect')],
  });
  malformedObservationProposal.observations = [{
    id: 'observation.missing-provenance',
    subject: 'package',
    predicate: 'contains',
    value: 'unknown',
    scope: 'interior',
    basedOnEffectIds: [],
  }] as unknown as typeof malformedObservationProposal.observations;

  assert.doesNotThrow(() => {
    const malformedReport = runShadowArbiter({
      envelope,
      compilerVersion: 'semantic-compiler-v1',
      schemaVersion: 'world-model-v1',
      mainProposals: [malformedObservationProposal],
      specialistCandidates: [],
      requiredDomains: ['clue'],
      sourcePolicies: {
        'main-world-model': {
          allowedDomains: ['clue'],
          authorizedFactIds: [],
        },
      },
      availableEvidenceRefs: [],
      availableObservationIds: [],
      visibleConfirmedEventIds: [],
    });
    const rejection = malformedReport.rejectedProposals.find(
      (item) => item.proposalId === malformedObservationProposal.id,
    );
    assert.deepEqual(rejection?.reasonCodes, ['schema_invalid']);
  }, 'schema-invalid observations must be rejected without dereferencing missing provenance fields');
}
assert.equal(report.transition.acceptedEvents.some((event) => event.id === 'event.shadow.killer_death_claim'), true);

const arbitrationMetrics = buildShadowArbitrationMetrics(report, 5, 4);
assert.equal(arbitrationMetrics.schemaSuccessRate, 0.8);
assert.equal(arbitrationMetrics.permissionLeakCount, 1);
assert.equal(arbitrationMetrics.specialistReplacementRate, 1 / 3);
assert.equal(arbitrationMetrics.fallbackRate, 1 / 3);
assert.equal(arbitrationMetrics.highRiskDecisions.defer, 1);
assert.equal(arbitrationMetrics.highRiskDecisions.pass, 0, 'reversible events are not high-risk metrics');

const deathDecision = report.highRiskDecisions.find((item) => item.eventId === 'event.shadow.killer_death_claim');
assert.equal(deathDecision?.decision, 'defer');
assert(deathDecision?.reasonCodes.includes('deterministic_evidence_missing'));

const simulated = simulateShadowCommit({
  envelope,
  transition: report.transition,
  highRiskDecisions: report.highRiskDecisions,
  current: { loopId: 'loop-1', stateVersion: 1, committedTurnIds: [] },
  completedAt: new Date('2026-07-20T12:00:01.500Z'),
});
assert.equal(simulated.simulated, true);
assert.equal(simulated.result.commitStatus, 'committed');
assert.deepEqual(simulated.result.confirmedEventIds, ['event.shadow.photo']);

const oldLoop = simulateShadowCommit({
  envelope,
  transition: report.transition,
  highRiskDecisions: report.highRiskDecisions,
  current: { loopId: 'loop-2', stateVersion: 0, committedTurnIds: [] },
  completedAt: new Date('2026-07-20T12:00:01.500Z'),
});
assert.equal(oldLoop.result.commitStatus, 'conflict');
assert.equal(oldLoop.discardReason, 'loop_invalidated');
assert.deepEqual(oldLoop.result.confirmedEventIds, []);

const differences = compareShadowWithLegacy(report, [
  { id: 'legacy.package_seen', eventType: 'inspection_completed', subject: 'package', facts: ['package_seen'] },
]);
assert(differences.items.some((item) => item.kind === 'shadow_only'));
assert(differences.items.some((item) => item.kind === 'legacy_only'));
assert.equal(differences.items.every((item) => item.explanation.length > 0), true);
assert.equal(differences.unexplainedCount, 0);

const factMismatch = compareShadowWithLegacy(
  runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [proposal({
      id: 'proposal.fact-mismatch',
      sourceAgent: 'main-world-model',
      domain: 'player',
      events: [{
        ...proposedEvent('event.fact-mismatch', 'inspect'),
        targetIds: ['package'],
        assertions: [{
          id: 'assertion.package.exterior_seen',
          subject: 'package',
          predicate: 'exterior_seen',
          value: true,
          visibleTo: ['player'],
        }],
      }],
    })],
    specialistCandidates: [],
    requiredDomains: ['player'],
    sourcePolicies: {
      'main-world-model': { allowedDomains: ['player'], authorizedFactIds: [] },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  }),
  [{
    id: 'legacy.fact-mismatch',
    eventType: 'inspection_completed',
    subject: 'package',
    facts: ['package_interior_seen'],
  }],
);
assert.equal(factMismatch.items.length, 2, 'same event shell with different facts must remain visible in the diff');

{
  const mismatchedActor = proposal({
    id: 'proposal.actor-mismatch',
    sourceAgent: 'main-world-model',
    domain: 'player',
    events: [proposedEvent('event.actor-mismatch', 'photograph')],
  });
  mismatchedActor.proposedEvents[0].actorId = 'unrelated_actor';
  const mismatchReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [mismatchedActor],
    specialistCandidates: [],
    requiredDomains: ['player'],
    sourcePolicies: {
      'main-world-model': { allowedDomains: ['player'], authorizedFactIds: [] },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(
    mismatchReport.rejectedProposals[0]?.reasonCodes.includes('event_actor_mismatch'),
    'a proposal cannot author an event on behalf of a different actor',
  );
}

{
  const missingCapability = proposal({
    id: 'proposal.missing-capability',
    sourceAgent: 'main-world-model',
    domain: 'player',
    events: [proposedEvent('event.missing-capability', 'attack')],
  });
  const capabilityReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [missingCapability],
    specialistCandidates: [],
    requiredDomains: ['player'],
    sourcePolicies: {
      'main-world-model': {
        allowedDomains: ['player'],
        authorizedFactIds: [],
        authorizedOperations: ['photograph'],
        enforceCapabilityChecks: true,
      },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  assert(
    capabilityReport.rejectedProposals[0]?.reasonCodes
      .includes('event_capability_unauthorized'),
    'actor-controlled operations require a matching capability from policy data',
  );
}

{
  const unsafeClue = proposal({
    id: 'proposal.unsafe-clue',
    sourceAgent: 'main-world-model',
    domain: 'clue',
    events: [proposedEvent('event.unsafe-clue', 'discover')],
  });
  unsafeClue.observations = [{
    id: 'observation.unsafe',
    subject: 'package',
    predicate: 'contains',
    value: 'secret-note',
    scope: 'interior',
    basedOnEffectIds: ['effect.missing'],
    basedOnEventIds: ['event.missing'],
    visibleAssertionIds: ['assertion.killer.private_memory'],
  }];
  unsafeClue.clueCandidates = [{
    id: 'clue.unsafe',
    claimAssertionIds: ['assertion.package_contains_secret_note'],
    basedOnObservationIds: ['observation.unsafe'],
    visibleAssertionIds: ['assertion.killer.private_memory'],
    confidence: 0.9,
  }];
  unsafeClue.displayFragments[0].claimRefs = ['assertion.killer.private_memory'];
  unsafeClue.proposedEvents[0].visibility = ['hidden'];
  unsafeClue.recommendations = [{
    id: 'recommendation.unsafe',
    label: 'Use hidden knowledge',
    rationale: 'A hidden event said so.',
    basedOnFactIds: [],
    basedOnEventIds: [unsafeClue.proposedEvents[0].id],
  }];

  const unsafeReport = runShadowArbiter({
    envelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    mainProposals: [unsafeClue],
    specialistCandidates: [],
    requiredDomains: ['clue'],
    sourcePolicies: {
      'main-world-model': { allowedDomains: ['clue'], authorizedFactIds: [] },
    },
    availableEvidenceRefs: [],
    availableObservationIds: [],
    visibleConfirmedEventIds: [],
  });
  const rejection = unsafeReport.rejectedProposals.find((item) => item.proposalId === unsafeClue.id);
  assert(rejection?.reasonCodes.includes('observation_effect_reference_invalid'));
  assert(rejection?.reasonCodes.includes('clue_assertion_not_observed'));
  assert(rejection?.reasonCodes.includes('observation_event_reference_invalid'));
  assert(rejection?.reasonCodes.includes('recommendation_source_missing'));
  assert(rejection?.reasonCodes.includes('display_claim_reference_invalid'));
  assert.deepEqual(unsafeReport.transition.fallbackDomains, ['clue']);
}

{
  const attack = proposedEvent(
    'event.shadow.attack',
    'attack',
    'high_impact',
    ['invariant.attack_requires_reach'],
  );
  const death = proposedEvent(
    'event.shadow.death',
    'resolve_ending',
    'irreversible',
    ['event.shadow.attack', 'invariant.death_requires_lethal_attack'],
    ['event.shadow.attack'],
  );
  const decisions = evaluateShadowHighRiskGate(
    [attack, death],
    new Set([
      'invariant.attack_requires_reach',
      'invariant.death_requires_lethal_attack',
    ]),
  );
  assert.equal(decisions.find((item) => item.eventId === attack.id)?.decision, 'pass');
  assert.equal(decisions.find((item) => item.eventId === death.id)?.decision, 'pass');
}

{
  const attack = proposedEvent(
    'event.shadow.parent-only-attack',
    'attack',
    'high_impact',
    ['invariant.attack_requires_reach'],
  );
  const death = proposedEvent(
    'event.shadow.parent-only-death',
    'resolve_ending',
    'irreversible',
    [attack.id],
    [attack.id],
  );
  const decisions = evaluateShadowHighRiskGate(
    [attack, death],
    new Set(['invariant.attack_requires_reach']),
  );
  const deathDecision = decisions.find((item) => item.eventId === death.id);
  assert.equal(deathDecision?.decision, 'defer');
  assert(deathDecision?.reasonCodes.includes('independent_deterministic_evidence_missing'));
}

{
  const firstAttack = proposedEvent(
    'event.shadow.first-attack',
    'attack',
    'high_impact',
    ['invariant.attack_requires_reach'],
  );
  const unrelatedAttack = proposedEvent(
    'event.shadow.unrelated-attack',
    'attack',
    'high_impact',
    ['invariant.attack_requires_reach'],
  );
  const death = proposedEvent(
    'event.shadow.sibling-backed-death',
    'resolve_ending',
    'irreversible',
    [unrelatedAttack.id, 'invariant.death_requires_lethal_attack'],
    [firstAttack.id],
  );
  const decisions = evaluateShadowHighRiskGate(
    [firstAttack, unrelatedAttack, death],
    new Set([
      'invariant.attack_requires_reach',
      'invariant.death_requires_lethal_attack',
    ]),
  );
  const deathDecision = decisions.find((item) => item.eventId === death.id);
  assert.equal(deathDecision?.decision, 'reject');
  assert(deathDecision?.reasonCodes.includes('evidence_reference_not_causal'));
}

{
  const rejectedAttack = proposedEvent(
    'event.shadow.rejected-attack',
    'attack',
    'high_impact',
    ['invariant.missing'],
  );
  const dependentDeath = proposedEvent(
    'event.shadow.dependent-death',
    'resolve_ending',
    'irreversible',
    [rejectedAttack.id],
    [rejectedAttack.id],
  );
  const decisions = evaluateShadowHighRiskGate(
    [rejectedAttack, dependentDeath],
    new Set(),
  );
  assert.equal(decisions.find((item) => item.eventId === rejectedAttack.id)?.decision, 'reject');
  assert.equal(decisions.find((item) => item.eventId === dependentDeath.id)?.decision, 'reject');
  assert(
    decisions.find((item) => item.eventId === dependentDeath.id)
      ?.reasonCodes.includes('causal_parent_not_approved'),
  );
}
