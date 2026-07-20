import {
  ProposalSchema,
  SpecialistCandidateSchema,
  StateTransitionResultSchema,
  type HighRiskDecision,
  type Proposal,
  type ProposalDomain,
  type ProposedEvent,
  type SpecialistCandidate,
  type StateTransitionResult,
  type TurnCommitResult,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import { evaluateTurnWorkFreshness, type TurnDiscardReason, type TurnFreshnessSnapshot } from '../commit/atomicTurnCommit';

export interface ShadowSourcePolicy {
  allowedDomains: ProposalDomain[];
  authorizedFactIds: string[];
  authorizedFactIdsByDomain?: Partial<Record<ProposalDomain, string[]>>;
  authorizedFactIdsByActor?: Record<string, string[]>;
}

export interface ShadowArbiterInput {
  envelope: TurnEnvelope;
  compilerVersion: string;
  schemaVersion: string;
  mainProposals: Proposal[];
  specialistCandidates: SpecialistCandidate[];
  requiredDomains: ProposalDomain[];
  sourcePolicies: Record<string, ShadowSourcePolicy>;
  availableEvidenceRefs: string[];
  availableObservationIds: string[];
  availableObservationClaims?: Record<string, string[]>;
  visibleConfirmedEventIds: string[];
}

export interface RejectedShadowProposal {
  proposalId: string;
  sourceAgent: string;
  domain: ProposalDomain;
  reasonCodes: string[];
}

export interface ShadowArbiterReport {
  transition: StateTransitionResult;
  selectedProposalIds: string[];
  rejectedProposals: RejectedShadowProposal[];
  highRiskDecisions: HighRiskDecision[];
}

export interface SimulateShadowCommitInput {
  envelope: TurnEnvelope;
  transition: StateTransitionResult;
  highRiskDecisions: HighRiskDecision[];
  current: TurnFreshnessSnapshot;
  completedAt: Date;
}

export interface SimulatedShadowCommit {
  simulated: true;
  result: TurnCommitResult;
  discardReason?: TurnDiscardReason;
}

export interface LegacyEventSnapshot {
  id: string;
  eventType: string;
  subject: string;
  facts: string[];
}

export interface ShadowDifferenceItem {
  kind: 'shadow_only' | 'legacy_only';
  eventKey: string;
  sourceId: string;
  explanation: string;
}

export interface ShadowDifferenceReport {
  items: ShadowDifferenceItem[];
  unexplainedCount: number;
}

export interface ShadowArbitrationMetrics {
  schemaSuccessRate: number;
  permissionLeakCount: number;
  specialistReplacementRate: number;
  fallbackRate: number;
  highRiskDecisions: Record<'pass' | 'defer' | 'reject', number>;
}

export function runShadowArbiter(input: ShadowArbiterInput): ShadowArbiterReport {
  const selected: Proposal[] = [];
  const rejectedProposals: RejectedShadowProposal[] = [];
  const specialistCandidatesTried: string[] = [];
  const fallbackDomains: ProposalDomain[] = [];
  const selectedSourceByDomain: Record<string, string> = {};

  for (const domain of input.requiredDomains) {
    const mainCandidates = input.mainProposals
      .filter((proposal) => proposal.domain === domain)
      .sort(byCandidateRank);
    const selectedMain = firstValid(mainCandidates, input, rejectedProposals);
    if (selectedMain) {
      selected.push(selectedMain);
      selectedSourceByDomain[domain] = selectedMain.sourceAgent;
      continue;
    }

    const specialists = input.specialistCandidates
      .filter((candidate) => candidate.domain === domain)
      .sort(byCandidateRank);
    let selectedSpecialist: SpecialistCandidate | undefined;
    for (const candidate of specialists) {
      specialistCandidatesTried.push(candidate.id);
      const reasons = validateProposal(candidate, input, true);
      if (reasons.length === 0) {
        selectedSpecialist = candidate;
        break;
      }
      rejectedProposals.push(rejected(candidate, reasons));
    }

    if (selectedSpecialist) {
      selected.push(selectedSpecialist);
      selectedSourceByDomain[domain] = selectedSpecialist.sourceAgent;
    } else {
      fallbackDomains.push(domain);
    }
  }

  const acceptedEvents = selected.flatMap((proposal) => proposal.proposedEvents);
  const transition = StateTransitionResultSchema.parse({
    ...input.envelope,
    acceptedEvents,
    correctedEvents: [],
    rejectedEffects: rejectedProposals.flatMap((item) => {
      const proposal = [...input.mainProposals, ...input.specialistCandidates]
        .find((candidate) => candidate.id === item.proposalId);
      return (proposal?.proposedEffects ?? []).map((effect) => ({
        effectId: effect.id,
        proposalId: item.proposalId,
        reasonCodes: item.reasonCodes,
      }));
    }),
    violations: rejectedProposals.flatMap((item) => item.reasonCodes.map((code) => ({
      code,
      subjectId: item.proposalId,
      detail: `Shadow proposal ${item.proposalId} was rejected: ${code}.`,
    }))),
    selectedSourceByDomain,
    specialistCandidatesTried,
    fallbackDomains,
    requiresRepair: false,
    requiresPlayerClarification: false,
    expectedOutputStateVersion: input.envelope.inputStateVersion + 1,
  });

  return {
    transition,
    selectedProposalIds: selected.map((proposal) => proposal.id),
    rejectedProposals,
    highRiskDecisions: evaluateShadowHighRiskGate(
      acceptedEvents,
      new Set(input.availableEvidenceRefs),
    ),
  };
}

export function evaluateShadowHighRiskGate(
  events: ProposedEvent[],
  availableEvidenceRefs: Set<string>,
): HighRiskDecision[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const decisions = new Map<string, HighRiskDecision>();
  const evaluating = new Set<string>();
  const collectCausalAncestorIds = (event: ProposedEvent): Set<string> => {
    const ancestors = new Set<string>();
    const pending = [...event.causalParentIds];
    while (pending.length > 0) {
      const parentId = pending.pop()!;
      if (ancestors.has(parentId)) continue;
      ancestors.add(parentId);
      const parent = eventsById.get(parentId);
      if (parent) pending.push(...parent.causalParentIds);
    }
    return ancestors;
  };

  const decide = (event: ProposedEvent): HighRiskDecision => {
    const existing = decisions.get(event.id);
    if (existing) return existing;
    if (evaluating.has(event.id)) {
      return {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'reject',
        reasonCodes: ['causal_chain_cycle'],
      };
    }
    if (event.riskClass === 'reversible') {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'pass',
        reasonCodes: ['reversible_event'],
      };
      decisions.set(event.id, decision);
      return decision;
    }

    evaluating.add(event.id);
    const missingParents = event.causalParentIds.filter((id) => !eventsById.has(id));
    if (missingParents.length > 0) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'reject',
        reasonCodes: ['causal_chain_incomplete'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }

    const parentDecisions = event.causalParentIds.map((id) => decide(eventsById.get(id)!));
    if (parentDecisions.some((decision) => decision.decision === 'reject')) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'reject',
        reasonCodes: ['causal_parent_not_approved'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }
    if (parentDecisions.some((decision) => decision.decision === 'defer')) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'defer',
        reasonCodes: ['causal_parent_deferred'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }

    if (event.evidenceRefs.length === 0) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: [],
        decision: 'defer',
        reasonCodes: ['deterministic_evidence_missing'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }

    const causalAncestorIds = collectCausalAncestorIds(event);
    const invalidEvidence = event.evidenceRefs.filter((ref) => {
      if (availableEvidenceRefs.has(ref)) return false;
      const referencedEvent = eventsById.get(ref);
      return !referencedEvent
        || !causalAncestorIds.has(ref)
        || decide(referencedEvent).decision !== 'pass';
    });
    if (invalidEvidence.length > 0) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'reject',
        reasonCodes: invalidEvidence.some((ref) => (
          eventsById.has(ref) && !causalAncestorIds.has(ref)
        ))
          ? ['evidence_reference_not_causal']
          : ['evidence_reference_invalid'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }

    if (!event.evidenceRefs.some((ref) => availableEvidenceRefs.has(ref))) {
      const decision: HighRiskDecision = {
        eventId: event.id,
        riskClass: event.riskClass,
        evidenceRefs: event.evidenceRefs,
        decision: 'defer',
        reasonCodes: ['independent_deterministic_evidence_missing'],
      };
      evaluating.delete(event.id);
      decisions.set(event.id, decision);
      return decision;
    }

    const decision: HighRiskDecision = {
      eventId: event.id,
      riskClass: event.riskClass,
      evidenceRefs: event.evidenceRefs,
      decision: 'pass',
      reasonCodes: ['causal_chain_complete', 'deterministic_evidence_present'],
    };
    evaluating.delete(event.id);
    decisions.set(event.id, decision);
    return decision;
  };

  return events.map(decide);
}

export function simulateShadowCommit(input: SimulateShadowCommitInput): SimulatedShadowCommit {
  const freshness = evaluateTurnWorkFreshness(input.envelope, input.current, input.completedAt);
  if (!freshness.accept) {
    const commitStatus = freshness.reason === 'deadline_expired' ? 'failed' : 'conflict';
    return {
      simulated: true,
      result: {
        loopId: input.envelope.loopId,
        turnId: input.envelope.turnId,
        inputStateVersion: input.envelope.inputStateVersion,
        outputStateVersion: null,
        commitStatus,
        confirmedEventIds: [],
      },
      discardReason: freshness.reason,
    };
  }

  const confirmedEventIds = input.transition.acceptedEvents
    .filter((event) => event.riskClass === 'reversible' || input.highRiskDecisions.some((decision) => (
      decision.eventId === event.id && decision.decision === 'pass'
    )))
    .map((event) => event.id);

  return {
    simulated: true,
    result: {
      loopId: input.envelope.loopId,
      turnId: input.envelope.turnId,
      inputStateVersion: input.envelope.inputStateVersion,
      outputStateVersion: input.transition.expectedOutputStateVersion,
      commitStatus: 'committed',
      confirmedEventIds,
    },
  };
}

export function compareShadowWithLegacy(
  report: ShadowArbiterReport,
  legacyEvents: LegacyEventSnapshot[],
): ShadowDifferenceReport {
  const shadowEvents = report.transition.acceptedEvents;
  const shadowKeys = new Map(shadowEvents.map((event) => [eventKey(event), event]));
  const legacyKeys = new Map(legacyEvents.map((event) => [eventKey(event), event]));
  const items: ShadowDifferenceItem[] = [];

  for (const [key, event] of shadowKeys) {
    if (legacyKeys.has(key)) continue;
    items.push({
      kind: 'shadow_only',
      eventKey: key,
      sourceId: event.id,
      explanation: 'The selected Shadow proposal produced this event, while the legacy rule result did not.',
    });
  }
  for (const [key, event] of legacyKeys) {
    if (shadowKeys.has(key)) continue;
    items.push({
      kind: 'legacy_only',
      eventKey: key,
      sourceId: event.id,
      explanation: 'The legacy rule path confirmed this event, while no accepted Shadow proposal produced an equivalent event.',
    });
  }

  return {
    items,
    unexplainedCount: items.filter((item) => item.explanation.trim().length === 0).length,
  };
}

export function buildShadowArbitrationMetrics(
  report: ShadowArbiterReport,
  schemaAttempts: number,
  schemaSuccesses: number,
): ShadowArbitrationMetrics {
  const selectedSources = Object.values(report.transition.selectedSourceByDomain);
  const domainCount = selectedSources.length + report.transition.fallbackDomains.length;
  const specialistSelections = selectedSources.filter((source) => source !== 'main-world-model').length;
  const highRiskDecisions = report.highRiskDecisions.filter((decision) => decision.riskClass !== 'reversible');
  return {
    schemaSuccessRate: schemaAttempts > 0 ? schemaSuccesses / schemaAttempts : 1,
    permissionLeakCount: report.rejectedProposals.filter((proposal) => (
      proposal.reasonCodes.includes('unauthorized_fact_reference')
      || proposal.reasonCodes.includes('precondition_unauthorized')
      || proposal.reasonCodes.includes('source_domain_unauthorized')
    )).length,
    specialistReplacementRate: domainCount > 0 ? specialistSelections / domainCount : 0,
    fallbackRate: domainCount > 0 ? report.transition.fallbackDomains.length / domainCount : 0,
    highRiskDecisions: {
      pass: highRiskDecisions.filter((decision) => decision.decision === 'pass').length,
      defer: highRiskDecisions.filter((decision) => decision.decision === 'defer').length,
      reject: highRiskDecisions.filter((decision) => decision.decision === 'reject').length,
    },
  };
}

function firstValid(
  candidates: Proposal[],
  input: ShadowArbiterInput,
  rejectedProposals: RejectedShadowProposal[],
): Proposal | undefined {
  for (const candidate of candidates) {
    const reasons = validateProposal(candidate, input, false);
    if (reasons.length === 0) return candidate;
    rejectedProposals.push(rejected(candidate, reasons));
  }
  return undefined;
}

function validateProposal(
  proposal: Proposal | SpecialistCandidate,
  input: ShadowArbiterInput,
  specialist: boolean,
): string[] {
  const reasons = new Set<string>();
  const schema = specialist ? SpecialistCandidateSchema : ProposalSchema;
  if (!schema.safeParse(proposal).success) reasons.add('schema_invalid');
  if (
    proposal.loopId !== input.envelope.loopId
    || proposal.turnId !== input.envelope.turnId
    || proposal.inputStateVersion !== input.envelope.inputStateVersion
    || proposal.deadlineAt !== input.envelope.deadlineAt
  ) {
    reasons.add('turn_envelope_mismatch');
  }
  if (
    proposal.compilerVersion !== input.compilerVersion
    || proposal.schemaVersion !== input.schemaVersion
  ) {
    reasons.add('contract_version_mismatch');
  }

  const policy = input.sourcePolicies[proposal.sourceAgent];
  if (!policy || !policy.allowedDomains.includes(proposal.domain)) {
    reasons.add('source_domain_unauthorized');
  }
  const authorizedFacts = new Set(
    policy?.authorizedFactIdsByActor?.[proposal.actorId]
    ?? policy?.authorizedFactIdsByDomain?.[proposal.domain]
    ?? policy?.authorizedFactIds
    ?? [],
  );
  if (proposal.basedOnFactIds.some((factId) => !authorizedFacts.has(factId))) {
    reasons.add('unauthorized_fact_reference');
  }
  if (proposal.preconditions.some((condition) => (
    condition.kind === 'fact' && !authorizedFacts.has(condition.ref)
  ))) {
    reasons.add('precondition_unauthorized');
  }

  const observationIds = new Set([
    ...input.availableObservationIds,
    ...proposal.observations.map((observation) => observation.id),
  ]);
  if (proposal.clueCandidates.some((clue) => (
    clue.basedOnObservationIds.some((id) => !observationIds.has(id))
  ))) {
    reasons.add('observation_source_missing');
  }
  const observationClaims = new Map<string, Set<string>>(
    Object.entries(input.availableObservationClaims ?? {}).map(([id, claims]) => [id, new Set(claims)]),
  );
  for (const observation of proposal.observations) {
    observationClaims.set(observation.id, new Set([observation.predicate]));
  }
  if (proposal.clueCandidates.some((clue) => {
    const observedClaims = new Set(clue.basedOnObservationIds.flatMap((id) => (
      [...(observationClaims.get(id) ?? [])]
    )));
    return clue.claims.some((claim) => !observedClaims.has(claim));
  })) {
    reasons.add('clue_claim_not_observed');
  }

  const proposedEventIds = new Set(proposal.proposedEvents.map((event) => event.id));
  const proposedEffectIds = new Set(proposal.proposedEffects.map((effect) => effect.id));
  if (proposal.observations.some((observation) => (
    observation.basedOnEffectIds.some((id) => !proposedEffectIds.has(id))
  ))) {
    reasons.add('observation_effect_reference_invalid');
  }
  if (proposal.clueCandidates.some((clue) => (
    clue.visibleFactIds.some((id) => !authorizedFacts.has(id))
  ))) {
    reasons.add('clue_visible_fact_unauthorized');
  }
  const visibleProposedEventIds = new Set(proposal.proposedEvents
    .filter((event) => event.visibility.includes('player') || event.visibility.includes('public'))
    .map((event) => event.id));
  if (proposal.recommendations.some((recommendation) => (
    recommendation.basedOnEventIds.some((id) => (
      !input.visibleConfirmedEventIds.includes(id) && !visibleProposedEventIds.has(id)
    ))
  ))) {
    reasons.add('recommendation_source_missing');
  }
  if (proposal.displayFragments.some((fragment) => (
    fragment.eventRefs.length === 0
    || fragment.eventRefs.some((id) => !proposedEventIds.has(id))
  ))) {
    reasons.add('display_event_reference_invalid');
  }
  const displayClaimRefs = new Set([
    ...proposal.proposedEvents.flatMap((event) => event.facts),
    ...proposal.clueCandidates.flatMap((clue) => clue.claims),
  ]);
  if (proposal.displayFragments.some((fragment) => (
    fragment.claimRefs.length === 0
    || fragment.claimRefs.some((id) => !displayClaimRefs.has(id))
  ))) {
    reasons.add('display_claim_reference_invalid');
  }

  return [...reasons];
}

function rejected(
  proposal: Proposal | SpecialistCandidate,
  reasonCodes: string[],
): RejectedShadowProposal {
  return {
    proposalId: proposal.id,
    sourceAgent: proposal.sourceAgent,
    domain: proposal.domain,
    reasonCodes,
  };
}

function byCandidateRank(left: Proposal, right: Proposal): number {
  return left.candidateRank - right.candidateRank;
}

function eventKey(event: { eventType: string; subject: string }): string {
  const facts = 'facts' in event && Array.isArray(event.facts)
    ? [...event.facts].sort().join('|')
    : '';
  return `${event.eventType}:${event.subject}:${facts}`;
}
