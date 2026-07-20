import type { Fact, ProposedEvent } from '@murder-loop-ai/ai-contracts';
import type {
  CharacterId,
  ClueRecord,
  GameState,
  KnowledgeSource,
  ObservationRecord,
} from '@murder-loop-ai/shared';
import type { CommitEventCandidate } from '../commit/atomicTurnCommit';
import {
  canonicalFactIdForAssertion,
  materializeEventFacts,
} from '../facts/eventAssertions';
import { createInitialWorldState } from '../world/worldSimulator';

export interface KnowledgeUpdateCandidate {
  characterId: CharacterId;
  factId: string;
  confidence: number;
  source: KnowledgeSource;
  sourceEventId: string;
  basedOnFactIds: string[];
}

export interface ClueProjectionCandidate {
  id: string;
  /** Canonical Fact IDs exposed by basedOnObservationIds. */
  claims: string[];
  basedOnObservationIds: string[];
}

export interface KnowledgeClueProjectionCandidates {
  observations: ObservationRecord[];
  knowledgeUpdates: KnowledgeUpdateCandidate[];
  clues: ClueProjectionCandidate[];
}

export function buildLowRiskKnowledgeClueCandidates(
  events: ProposedEvent[],
  observedAt: { run: number; minute: number },
): KnowledgeClueProjectionCandidates {
  const candidates: KnowledgeClueProjectionCandidates = {
    observations: [],
    knowledgeUpdates: [],
    clues: [],
  };

  for (const event of events) {
    if (
      event.kind === 'information_transfer'
      && event.operation === 'communicate'
      && event.status === 'completed'
    ) {
      const recipientId = event.targetIds[0];
      const characterId = canonicalCharacterId(recipientId);
      if (characterId) {
        candidates.knowledgeUpdates.push({
          characterId,
          factId: 'player_message_received',
          confidence: 1,
          source: 'message',
          sourceEventId: event.id,
          basedOnFactIds: event.assertions.map((assertion) => (
            canonicalFactIdForAssertion(event.id, assertion.id)
          )),
        });
      }
      continue;
    }

    if (event.operation === 'inspect' && event.status === 'completed') {
      const visibleAssertions = playerVisibleAssertions(event);
      const visibleFactIds = visibleAssertions.map((assertion) => (
        canonicalFactIdForAssertion(event.id, assertion.id)
      ));
      if (visibleFactIds.length === 0) continue;
      const subject = event.targetIds[0] ?? visibleAssertions[0].subject;
      const observationId = `observation.${event.id}.exterior-label`;
      candidates.observations.push({
        id: observationId,
        subject,
        predicate: subject === 'package' ? 'exterior_label' : 'visible_exterior',
        value: subject === 'package' ? 'ambiguous' : 'observed',
        scope: subject === 'package' ? 'exterior.label' : 'exterior',
        visibleFactIds,
        sourceEventIds: [event.id],
        observedAt,
      });
      const packageLabelAssertion = visibleAssertions.find((assertion) => (
        assertion.subject === 'package' && assertion.predicate === 'exterior.label_ambiguous'
      ));
      if (packageLabelAssertion) {
        const packageLabelFact = canonicalFactIdForAssertion(event.id, packageLabelAssertion.id);
        candidates.knowledgeUpdates.push({
          characterId: 'player',
          factId: 'package_exterior_label_ambiguous',
          confidence: 1,
          source: 'seen',
          sourceEventId: event.id,
          basedOnFactIds: [packageLabelFact],
        });
        candidates.clues.push({
          id: 'wrong_package',
          claims: [packageLabelFact],
          basedOnObservationIds: [observationId],
        });
      }
      continue;
    }

    if (event.operation === 'preserve_evidence' && event.status === 'completed') {
      const visibleAssertions = playerVisibleAssertions(event);
      const visibleFactIds = visibleAssertions.map((assertion) => (
        canonicalFactIdForAssertion(event.id, assertion.id)
      ));
      if (visibleFactIds.length === 0) continue;
      const subject = event.targetIds[0] ?? visibleAssertions[0].subject;
      const observationId = `observation.${event.id}.exterior-photo`;
      candidates.observations.push({
        id: observationId,
        subject,
        predicate: 'exterior_photo',
        value: 'captured',
        scope: 'exterior',
        visibleFactIds,
        sourceEventIds: [event.id],
        observedAt,
      });
      candidates.knowledgeUpdates.push({
        characterId: 'player',
        factId: `${subject}_exterior_photo`,
        confidence: 1,
        source: 'seen',
        sourceEventId: event.id,
        basedOnFactIds: visibleAssertions
          .filter((assertion) => assertion.predicate === 'exterior.photo_captured')
          .map((assertion) => canonicalFactIdForAssertion(event.id, assertion.id)),
      });
      if (subject === 'package') {
        const photoAssertion = visibleAssertions.find((assertion) => (
          assertion.subject === 'package' && assertion.predicate === 'exterior.photo_captured'
        ));
        if (!photoAssertion) continue;
        const photoFact = canonicalFactIdForAssertion(event.id, photoAssertion.id);
        candidates.clues.push({
          id: 'package_photo',
          claims: [photoFact],
          basedOnObservationIds: [observationId],
        });
      }
    }
  }

  return candidates;
}

export type KnowledgeClueProjectionRejectReason =
  | 'observation_source_missing'
  | 'observation_fact_not_confirmed'
  | 'knowledge_source_missing'
  | 'knowledge_event_not_confirmed'
  | 'knowledge_fact_not_confirmed'
  | 'clue_source_missing'
  | 'clue_claim_not_observed'
  | 'clue_definition_unsupported';

const PHASE_FOUR_CLUE_DEFINITIONS: Record<string, {
  title: string;
  detail: string;
  weight: number;
  isPersistent: boolean;
  allowedAssertions: Array<Pick<Fact, 'subject' | 'predicate' | 'value'>>;
}> = {
  wrong_package: {
    title: '标记模糊的包裹',
    detail: '包裹外部标签上的 5-03 / 503 标记很模糊，收件信息需要进一步核实。',
    weight: 12,
    isPersistent: true,
    allowedAssertions: [{ subject: 'package', predicate: 'exterior.label_ambiguous', value: true }],
  },
  package_photo: {
    title: '包裹外包装照片',
    detail: '照片只记录了包裹尚未开启时的外包装、标签和可见表面，没有包含内部物品。',
    weight: 16,
    isPersistent: true,
    allowedAssertions: [{ subject: 'package', predicate: 'exterior.photo_captured', value: true }],
  },
};

export type KnowledgeClueProjection = {
  status: 'projected';
  state: GameState;
  addedObservationIds: string[];
  addedKnowledgeFactIds: string[];
  addedClueIds: string[];
} | {
  status: 'rejected';
  reason: KnowledgeClueProjectionRejectReason;
};

export function projectConfirmedKnowledgeAndClues(input: {
  baselineState: GameState;
  candidateState: GameState;
  eventCandidates: CommitEventCandidate[];
  candidates: KnowledgeClueProjectionCandidates;
}): KnowledgeClueProjection {
  const events = new Map(input.eventCandidates.map(({ event }) => [event.id, event]));
  const materializedFacts = new Map(input.eventCandidates.flatMap(({ event }) => (
    materializeEventFacts(event, 'projection')
  )).map((fact) => [fact.id, fact]));
  const observationValidation = validateObservations(input.candidates.observations, events);
  if (observationValidation) return { status: 'rejected', reason: observationValidation };

  const knowledgeValidation = validateKnowledgeUpdates(input.candidates.knowledgeUpdates, events);
  if (knowledgeValidation) return { status: 'rejected', reason: knowledgeValidation };

  const observations = new Map(input.baselineState.observations.map((item) => [item.id, item]));
  for (const observation of input.candidates.observations) observations.set(observation.id, observation);
  const clueValidation = validateClues(input.candidates.clues, observations, materializedFacts);
  if (clueValidation) return { status: 'rejected', reason: clueValidation };

  const state = structuredClone(input.candidateState) as GameState;
  state.clues = structuredClone(input.baselineState.clues);
  state.observations = structuredClone(input.baselineState.observations);
  state.killerKnowledge = structuredClone(input.baselineState.killerKnowledge);

  const baselineKnowledge = input.baselineState.world?.knowledge
    ?? createInitialWorldState().knowledge;
  if (state.world) state.world.knowledge = structuredClone(baselineKnowledge);

  const addedObservationIds = new Set<string>();
  for (const observation of input.candidates.observations) {
    const index = state.observations.findIndex((existing) => existing.id === observation.id);
    const record = structuredClone(observation);
    if (index >= 0) state.observations[index] = record;
    else state.observations.push(record);
    addedObservationIds.add(observation.id);
  }

  if (input.candidates.knowledgeUpdates.length > 0 && !state.world) {
    state.world = createInitialWorldState();
    state.world.run = state.run;
    state.world.minute = state.minute;
  }
  const addedKnowledgeFactIds = new Set<string>();
  for (const update of input.candidates.knowledgeUpdates) {
    state.world!.knowledge[update.characterId].facts[update.factId] = {
      confidence: update.confidence,
      source: update.source,
      minuteLearned: state.minute,
      sourceEventId: update.sourceEventId,
    };
    addedKnowledgeFactIds.add(`${update.characterId}:${update.factId}`);
  }

  const addedClueIds = new Set<string>();
  for (const candidate of input.candidates.clues) {
    if (state.clues.some((clue) => clue.id === candidate.id)) continue;
    const definition = PHASE_FOUR_CLUE_DEFINITIONS[candidate.id]!;
    const sourceEventIds = [...new Set(candidate.basedOnObservationIds.flatMap((id) => (
      observations.get(id)?.sourceEventIds ?? []
    )))];
    const clue: ClueRecord = {
      id: candidate.id,
      title: definition.title,
      detail: definition.detail,
      source: 'player_discovered',
      weight: definition.weight,
      discoveredAt: { run: state.run, minute: state.minute },
      isPersistent: definition.isPersistent,
      claims: [...candidate.claims],
      basedOnObservationIds: [...candidate.basedOnObservationIds],
      sourceEventIds,
    };
    state.clues.push(clue);
    addedClueIds.add(candidate.id);
  }

  return {
    status: 'projected',
    state,
    addedObservationIds: [...addedObservationIds],
    addedKnowledgeFactIds: [...addedKnowledgeFactIds],
    addedClueIds: [...addedClueIds],
  };
}

function validateObservations(
  observations: ObservationRecord[],
  events: Map<string, ProposedEvent>,
): KnowledgeClueProjectionRejectReason | undefined {
  for (const observation of observations) {
    if (observation.sourceEventIds.length === 0) return 'observation_source_missing';
    const sourceEvents = observation.sourceEventIds.map((id) => events.get(id));
    if (sourceEvents.some((event) => !event || !isPlayerVisible(event))) return 'observation_source_missing';
    const confirmedFacts = new Set(sourceEvents.flatMap((event) => (
      event?.assertions.map((assertion) => canonicalFactIdForAssertion(event.id, assertion.id)) ?? []
    )));
    if (observation.visibleFactIds.some((factId) => !confirmedFacts.has(factId))) {
      return 'observation_fact_not_confirmed';
    }
  }
  return undefined;
}

function validateKnowledgeUpdates(
  updates: KnowledgeUpdateCandidate[],
  events: Map<string, ProposedEvent>,
): KnowledgeClueProjectionRejectReason | undefined {
  for (const update of updates) {
    const event = events.get(update.sourceEventId);
    if (!event) return 'knowledge_source_missing';
    if (update.source === 'message') {
      if (
        event.kind !== 'information_transfer'
        || event.operation !== 'communicate'
        || event.status !== 'completed'
        || canonicalCharacterId(event.targetIds[0]) !== update.characterId
      ) {
        return 'knowledge_event_not_confirmed';
      }
    } else if (update.characterId !== 'player' || !isPlayerVisible(event)) {
      return 'knowledge_event_not_confirmed';
    }
    if (
      update.basedOnFactIds.length === 0
      || update.basedOnFactIds.some((factId) => !event.assertions.some((assertion) => (
        canonicalFactIdForAssertion(event.id, assertion.id) === factId
      )))
    ) {
      return 'knowledge_fact_not_confirmed';
    }
  }
  return undefined;
}

function validateClues(
  clues: ClueProjectionCandidate[],
  observations: Map<string, ObservationRecord>,
  facts: Map<string, Fact>,
): KnowledgeClueProjectionRejectReason | undefined {
  for (const clue of clues) {
    const definition = PHASE_FOUR_CLUE_DEFINITIONS[clue.id];
    if (!definition) return 'clue_definition_unsupported';
    if (clue.basedOnObservationIds.length === 0) return 'clue_source_missing';
    const sources = clue.basedOnObservationIds.map((id) => observations.get(id));
    if (sources.some((source) => !source)) return 'clue_source_missing';
    const visibleFacts = new Set(sources.flatMap((source) => source?.visibleFactIds ?? []));
    if (clue.claims.length === 0 || clue.claims.some((claim) => !visibleFacts.has(claim))) {
      return 'clue_claim_not_observed';
    }
    if (clue.claims.some((claim) => {
      const fact = facts.get(claim);
      return !fact || !definition.allowedAssertions.some((allowed) => (
        allowed.subject === fact.subject
        && allowed.predicate === fact.predicate
        && allowed.value === fact.value
      ));
    })) {
      return 'clue_definition_unsupported';
    }
  }
  return undefined;
}

function playerVisibleAssertions(event: ProposedEvent): ProposedEvent['assertions'] {
  if (!isPlayerVisible(event)) return [];
  return event.assertions.filter((assertion) => (
    assertion.visibleTo.includes('player') || assertion.visibleTo.includes('public')
  ));
}

function isPlayerVisible(event: ProposedEvent): boolean {
  return event.visibility.includes('player') || event.visibility.includes('public');
}

function canonicalCharacterId(subject: string): CharacterId | undefined {
  if (subject === 'linyue' || subject === 'lin_yue') return 'lin_yue';
  if (subject === 'police_dispatch' || subject === 'real_police') return 'real_police';
  if (subject === 'chen_huaimin') return 'chen_huaimin';
  if (subject === 'player') return 'player';
  if (subject === 'fake_police') return 'fake_police';
  return undefined;
}
