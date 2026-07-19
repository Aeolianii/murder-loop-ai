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
  eventType: string,
  riskClass: ProposedEvent['riskClass'] = 'reversible',
  evidenceRefs: string[] = [],
  causalParentIds: string[] = [],
): ProposedEvent {
  return {
    id,
    eventType,
    subject: id.split('.').at(-1) ?? id,
    summary: `${eventType} proposed`,
    facts: [`fact.result.${id}`],
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
    actorId: input.domain === 'killer' ? 'killer' : 'player',
    operation: input.events[0]?.eventType ?? 'wait',
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
    proposedEvents: input.events,
    clueCandidates: [],
    recommendations: [],
    displayFragments: input.events.map((event) => ({
      id: `display.${event.id}`,
      text: event.summary,
      eventRefs: [event.id],
      claimRefs: event.facts,
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
  events: [proposedEvent('event.shadow.photo', 'package_photographed', 'reversible', ['fact.player.has_phone'])],
});
const validPlayerSpecialist = specialist(proposal({
  id: 'proposal.specialist.player',
  sourceAgent: 'player-specialist',
  domain: 'player',
  basedOnFactIds: ['fact.player.has_phone'],
  events: [proposedEvent('event.shadow.player_waited', 'player_waited')],
  rank: 1,
}), 'player-specialist');
const leakingMainKiller = proposal({
  id: 'proposal.main.killer',
  sourceAgent: 'main-world-model',
  domain: 'killer',
  basedOnFactIds: ['fact.player.private_memory'],
  events: [proposedEvent('event.shadow.killer_probe', 'killer_phone_probe')],
});
const killerSpecialist = specialist(proposal({
  id: 'proposal.specialist.killer',
  sourceAgent: 'killer-specialist',
  domain: 'killer',
  basedOnFactIds: ['fact.killer.in_corridor'],
  events: [proposedEvent(
    'event.shadow.killer_death_claim',
    'ending_reached',
    'irreversible',
    [],
  )],
  rank: 1,
}), 'killer-specialist');
const invalidClue = proposal({
  id: 'proposal.main.clue',
  sourceAgent: 'main-world-model',
  domain: 'clue',
  events: [proposedEvent('event.shadow.clue', 'clue_discovered')],
});
invalidClue.clueCandidates = [{
  id: 'clue-internal-note',
  claims: ['package_contains_note'],
  basedOnObservationIds: ['observation.package.interior.missing'],
  visibleFactIds: [],
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
assert.equal(report.transition.acceptedEvents.some((event) => event.id === 'event.shadow.killer_death_claim'), true);

const arbitrationMetrics = buildShadowArbitrationMetrics(report, 5, 4);
assert.equal(arbitrationMetrics.schemaSuccessRate, 0.8);
assert.equal(arbitrationMetrics.permissionLeakCount, 1);
assert.equal(arbitrationMetrics.specialistReplacementRate, 1 / 3);
assert.equal(arbitrationMetrics.fallbackRate, 1 / 3);
assert.equal(arbitrationMetrics.highRiskDecisions.defer, 1);

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

{
  const attack = proposedEvent(
    'event.shadow.attack',
    'attack_confirmed',
    'high_impact',
    ['invariant.attack_requires_reach'],
  );
  const death = proposedEvent(
    'event.shadow.death',
    'ending_reached',
    'irreversible',
    ['event.shadow.attack'],
    ['event.shadow.attack'],
  );
  const decisions = evaluateShadowHighRiskGate(
    [attack, death],
    new Set(['invariant.attack_requires_reach']),
  );
  assert.equal(decisions.find((item) => item.eventId === attack.id)?.decision, 'pass');
  assert.equal(decisions.find((item) => item.eventId === death.id)?.decision, 'pass');
}
