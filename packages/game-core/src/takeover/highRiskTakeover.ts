import type {
  DisplayFragment,
  HighRiskDecision,
  ProposedEvent,
} from '@murder-loop-ai/ai-contracts';
import {
  DEADLINE_MINUTE,
  type CharacterId,
  type EndingId,
  type EndingReason,
  type GameState,
  type LocationId,
  type PlayerCondition,
} from '@murder-loop-ai/shared';
import type { CommitEventCandidate } from '../commit/atomicTurnCommit';
import { hasConvictingEvidence } from '../rules/endingRules';
import { scoreRun } from '../scoring/scoreRun';
import { evaluateShadowHighRiskGate } from '../shadow/shadowArbiter';
import { ensureWorldState } from '../world/syncGameWorld';

const HIGH_RISK_INVARIANT_REFS = [
  'invariant.arrest.requires_police_presence',
  'invariant.attack.requires_same_location',
  'invariant.death.requires_lethal_injury',
  'invariant.ending.requires_terminal_cause',
  'invariant.entry.requires_clear_barrier',
  'invariant.evidence_destroy.requires_access',
  'invariant.flight.requires_confirmed_route',
  'invariant.incapacitation.requires_injury',
  'invariant.injury.requires_landed_attack',
] as const;

const SUPPORTED_EVENT_TYPES = new Set([
  'actor_entered',
  'actor_moved',
  'attack_attempted',
  'attack_blocked',
  'attack_landed',
  'character_arrested',
  'character_fled',
  'character_incapacitated',
  'character_injured',
  'character_killed',
  'deadline_reached',
  'ending_reached',
  'entry_attempted',
  'entry_blocked',
  'evidence_destroyed',
  'evidence_destruction_attempted',
  'killer_action_attempted',
  'npc_action_attempted',
  'police_intervention_confirmed',
]);

const CHARACTER_IDS = new Set<CharacterId>([
  'player',
  'chen_huaimin',
  'lin_yue',
  'real_police',
  'fake_police',
]);

const LOCATION_IDS = new Set<LocationId>([
  'room_503',
  'room_501',
  'corridor_5f',
  'stairwell',
  'lobby',
  'parking_lot',
]);

const ENDING_IDS = new Set<EndingId>([
  'death',
  'escaped_no_evidence',
  'escaped_with_evidence',
]);

const ENDING_REASONS = new Set<EndingReason>([
  'deadline_murder',
  'forced_entry',
  'window_route',
  'ambient_pressure',
  'killer_dead_with_evidence',
  'killer_dead_no_evidence',
  'deadline_survived_with_evidence',
  'police_arrived_with_evidence',
  'police_arrived_without_evidence',
  'escaped_without_evidence',
  'phone_battery_depleted',
  'unknown',
]);

export interface HighRiskTakeoverProjection {
  state: GameState;
  acceptedEventCandidates: CommitEventCandidate[];
  displayFragments: DisplayFragment[];
  highRiskDecisions: HighRiskDecision[];
  acceptedEventIds: string[];
  correctedEventIds: string[];
  deferredEventIds: string[];
  rejectedEventIds: string[];
}

export function buildHighRiskEvidenceRefs(state: GameState): string[] {
  const refs = new Set<string>(HIGH_RISK_INVARIANT_REFS);
  refs.add('fact.game.minute');
  refs.add('fact.game.phase');
  refs.add('fact.game.police_phase');
  refs.add('fact.game.evidence_phase');
  refs.add('fact.game.killer_status');
  refs.add('fact.player.injury');

  for (const roomObject of Object.values(state.room)) {
    refs.add(`fact.object.${roomObject.id}.location`);
    for (const key of Object.keys(roomObject.state)) {
      refs.add(`fact.object.${roomObject.id}.${key}`);
    }
  }

  const evidenceState = structuredClone(state) as GameState;
  const world = ensureWorldState(evidenceState);
  const killerCanAct = !['incapacitated', 'dead', 'arrested', 'fled'].includes(state.killerStatus);
  if (killerCanAct) {
    refs.add('capability.killer.attack');
    refs.add('capability.killer.window_route');
    if (world.objects.keys.location === 'chen_huaimin') refs.add('capability.killer.spare_key');
  }
  for (const character of Object.values(world.characters)) {
    refs.add(`fact.world.character.${character.id}.location`);
    refs.add(`fact.world.character.${character.id}.status`);
  }
  for (const object of Object.values(world.objects)) {
    refs.add(`fact.world.object.${object.id}.location`);
    for (const key of Object.keys(object.flags)) {
      refs.add(`fact.world.object.${object.id}.${key}`);
    }
  }
  return [...refs];
}

export function projectConfirmedHighRiskResults(input: {
  baselineState: GameState;
  candidateState?: GameState;
  eventCandidates: CommitEventCandidate[];
}): HighRiskTakeoverProjection {
  // Phase five deliberately starts from the already-confirmed phase-three state.
  // candidateState may contain legacy Killer/NPC/Narrator mutations and has no authority here.
  const state = structuredClone(input.baselineState) as GameState;
  state.world = ensureWorldState(state);

  const events = input.eventCandidates.map(({ event }) => event);
  const initialDecisions = evaluateShadowHighRiskGate(
    events,
    new Set(buildHighRiskEvidenceRefs(state)),
  );
  const decisionsById = new Map(initialDecisions.map((decision) => [decision.eventId, decision]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const duplicateEventIds = new Set(events
    .filter((event, index) => events.findIndex((candidate) => candidate.id === event.id) !== index)
    .map((event) => event.id));
  const processedEventIds = new Set<string>();
  const acceptedEventCandidates: CommitEventCandidate[] = [];
  const displayFragments: DisplayFragment[] = [];
  const acceptedEventIds = new Set<string>();
  const correctedEventIds = new Set<string>();
  const deferredEventIds = new Set<string>();
  const rejectedEventIds = new Set<string>();

  for (const candidate of topologicalCandidates(input.eventCandidates)) {
    const { event } = candidate;
    if (duplicateEventIds.has(event.id) || processedEventIds.has(event.id)) {
      rejectEvent(event, decisionsById, 'duplicate_event_id');
      rejectedEventIds.add(event.id);
      continue;
    }
    processedEventIds.add(event.id);
    const gateDecision = decisionsById.get(event.id);
    if (event.riskClass !== 'reversible' && gateDecision?.decision !== 'pass') {
      if (gateDecision?.decision === 'defer') deferredEventIds.add(event.id);
      else rejectedEventIds.add(event.id);
      continue;
    }
    if (!SUPPORTED_EVENT_TYPES.has(event.eventType)) {
      rejectEvent(event, decisionsById, 'high_risk_event_type_unsupported');
      rejectedEventIds.add(event.id);
      continue;
    }
    if (event.causalParentIds.some((parentId) => !acceptedEventIds.has(parentId))) {
      rejectEvent(event, decisionsById, 'causal_parent_not_applied');
      rejectedEventIds.add(event.id);
      continue;
    }

    const result = applyConfirmedEvent(state, event, eventsById);
    if (result.status === 'rejected') {
      rejectEvent(event, decisionsById, result.reason);
      rejectedEventIds.add(event.id);
      if (result.correctedEvent) {
        const correctedCandidate = {
          event: result.correctedEvent,
          sourceProposalId: candidate.sourceProposalId,
        };
        acceptCandidate(state, correctedCandidate, acceptedEventCandidates, displayFragments);
        acceptedEventIds.add(result.correctedEvent.id);
        correctedEventIds.add(result.correctedEvent.id);
      }
      continue;
    }

    const safeCandidate = {
      event: {
        ...event,
        summary: deterministicSummary(event),
      },
      sourceProposalId: candidate.sourceProposalId,
    };
    acceptCandidate(state, safeCandidate, acceptedEventCandidates, displayFragments);
    acceptedEventIds.add(event.id);
  }

  const highRiskDecisions = events
    .filter((event) => event.riskClass !== 'reversible')
    .map((event) => decisionsById.get(event.id)!)
    .filter(Boolean);

  return {
    state,
    acceptedEventCandidates,
    displayFragments,
    highRiskDecisions,
    acceptedEventIds: [...acceptedEventIds],
    correctedEventIds: [...correctedEventIds],
    deferredEventIds: [...deferredEventIds],
    rejectedEventIds: [...rejectedEventIds],
  };
}

type ApplyResult = {
  status: 'applied';
} | {
  status: 'rejected';
  reason: string;
  correctedEvent?: ProposedEvent;
};

function applyConfirmedEvent(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  switch (event.eventType) {
    case 'killer_action_attempted':
      return event.subject === 'chen_huaimin'
        ? { status: 'applied' }
        : { status: 'rejected', reason: 'killer_action_actor_invalid' };
    case 'npc_action_attempted':
    case 'attack_blocked':
      return { status: 'applied' };
    case 'actor_moved':
      return applyActorMoved(state, event);
    case 'entry_attempted':
      if (event.subject !== 'chen_huaimin') {
        return { status: 'rejected', reason: 'entry_actor_invalid' };
      }
      state.killerPhase = 'forced_entry';
      state.phase = state.phase === 'death' || state.phase === 'survived' ? state.phase : 'killer_pressure';
      state.threat = Math.min(100, state.threat + 2);
      state.world!.threat = state.threat;
      return { status: 'applied' };
    case 'entry_blocked':
      if (event.subject !== 'chen_huaimin') {
        return { status: 'rejected', reason: 'entry_actor_invalid' };
      }
      state.threat = Math.min(100, state.threat + 3);
      state.world!.threat = state.threat;
      return { status: 'applied' };
    case 'actor_entered':
      return applyActorEntered(state, event, eventsById);
    case 'attack_attempted':
      return applyAttackAttempted(state, event);
    case 'attack_landed':
      return applyAttackLanded(state, event, eventsById);
    case 'character_injured':
      return applyCharacterInjured(state, event, eventsById);
    case 'character_incapacitated':
      return applyCharacterIncapacitated(state, event, eventsById);
    case 'character_killed':
      return applyCharacterKilled(state, event, eventsById);
    case 'police_intervention_confirmed':
      return validatePoliceIntervention(state, event);
    case 'character_arrested':
      return applyCharacterArrested(state, event, eventsById);
    case 'character_fled':
      return applyCharacterFled(state, event, eventsById);
    case 'evidence_destruction_attempted':
      return factValue(event, 'actor') === 'chen_huaimin'
        ? { status: 'applied' }
        : { status: 'rejected', reason: 'evidence_destruction_actor_invalid' };
    case 'evidence_destroyed':
      return applyEvidenceDestroyed(state, event, eventsById);
    case 'deadline_reached':
      return applyDeadlineReached(state, event);
    case 'ending_reached':
      return applyEnding(state, event, eventsById);
    default:
      return { status: 'rejected', reason: 'high_risk_event_type_unsupported' };
  }
}

function applyActorMoved(state: GameState, event: ProposedEvent): ApplyResult {
  const actorId = characterId(event.subject);
  const destination = locationId(factValue(event, 'location'));
  if (!actorId || actorId === 'player' || !destination) {
    return { status: 'rejected', reason: 'actor_or_destination_invalid' };
  }
  if (destination === 'room_503') {
    return { status: 'rejected', reason: 'entry_requires_actor_entered_event' };
  }
  const actor = state.world!.characters[actorId];
  if (!state.world!.locations[actor.location].neighbors.includes(destination)) {
    return { status: 'rejected', reason: 'movement_route_invalid' };
  }
  actor.location = destination;
  actor.destination = undefined;
  actor.status = 'active';
  return { status: 'applied' };
}

function applyActorEntered(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (!hasDirectParentType(event, eventsById, 'entry_attempted')) {
    return { status: 'rejected', reason: 'entry_attempt_missing' };
  }
  const actorId = characterId(event.subject);
  const route = factValue(event, 'entry_route');
  if (
    actorId !== 'chen_huaimin'
    || factValue(event, 'location') !== 'room_503'
    || ['incapacitated', 'dead', 'arrested', 'fled'].includes(state.killerStatus)
  ) {
    return { status: 'rejected', reason: 'entry_target_invalid' };
  }
  if (route === 'front_door') {
    if (!hasEvidence(event, [
      'fact.object.front_door.chainLocked',
      'fact.object.front_door.barricaded',
      'capability.killer.spare_key',
      'invariant.entry.requires_clear_barrier',
    ])) {
      return { status: 'rejected', reason: 'required_deterministic_evidence_missing' };
    }
    const blockedBy = state.room.front_door.state.barricaded === true
      ? 'barricade'
      : state.room.front_door.state.chainLocked === true
        ? 'door_chain'
        : undefined;
    if (blockedBy) {
      return {
        status: 'rejected',
        reason: 'capability_precondition_failed',
        correctedEvent: correctedBlockedEntry(event, blockedBy),
      };
    }
    if (state.world!.characters[actorId].location !== 'corridor_5f') {
      return { status: 'rejected', reason: 'entry_route_not_reached' };
    }
  } else if (route === 'window') {
    if (!hasEvidence(event, [
      'fact.object.window.locked',
      'capability.killer.window_route',
      'invariant.entry.requires_clear_barrier',
    ])) {
      return { status: 'rejected', reason: 'required_deterministic_evidence_missing' };
    }
    if (state.room.window.state.locked === true) {
      return {
        status: 'rejected',
        reason: 'capability_precondition_failed',
        correctedEvent: correctedBlockedEntry(event, 'window_lock'),
      };
    }
  } else {
    return { status: 'rejected', reason: 'entry_route_invalid' };
  }

  state.world!.characters[actorId].location = 'room_503';
  state.world!.characters[actorId].status = 'active';
  if (actorId === 'chen_huaimin') {
    state.killerStatus = 'confronting';
    state.killerPhase = 'forced_entry';
  }
  state.phase = 'confrontation';
  state.threat = Math.min(100, state.threat + 10);
  state.world!.threat = state.threat;
  return { status: 'applied' };
}

function applyAttackAttempted(state: GameState, event: ProposedEvent): ApplyResult {
  const attackerId = characterId(factValue(event, 'attacker'));
  const targetId = characterId(factValue(event, 'target') ?? event.subject);
  if (!attackerId || !targetId || attackerId === targetId) {
    return { status: 'rejected', reason: 'attack_participant_invalid' };
  }
  if (
    state.world!.characters[attackerId].status === 'dead'
    || state.world!.characters[attackerId].status === 'arrested'
    || state.world!.characters[attackerId].status === 'fled'
    || (attackerId === 'chen_huaimin' && state.killerStatus === 'incapacitated')
  ) {
    return { status: 'rejected', reason: 'attacker_not_capable' };
  }
  if (!hasEvidence(event, [
    attackerId === 'chen_huaimin' ? 'capability.killer.attack' : `capability.${attackerId}.attack`,
    'invariant.attack.requires_same_location',
  ])) {
    return { status: 'rejected', reason: 'required_deterministic_evidence_missing' };
  }
  if (state.world!.characters[attackerId].location !== state.world!.characters[targetId].location) {
    return { status: 'rejected', reason: 'attack_reach_invalid' };
  }
  state.combatTriggered = true;
  state.killerPhase = attackerId === 'chen_huaimin' ? 'violence' : state.killerPhase;
  state.phase = 'confrontation';
  return { status: 'applied' };
}

function applyAttackLanded(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (!hasDirectParentType(event, eventsById, 'attack_attempted')) {
    return { status: 'rejected', reason: 'attack_attempt_missing' };
  }
  return applyAttackAttempted(state, event);
}

function applyCharacterInjured(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    !hasDirectParentType(event, eventsById, 'attack_landed')
    || !hasEvidence(event, ['invariant.injury.requires_landed_attack'])
  ) {
    return { status: 'rejected', reason: 'injury_cause_or_evidence_missing' };
  }
  const attackParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent?.eventType === 'attack_landed');
  if (factValue(attackParent, 'target') !== event.subject) {
    return { status: 'rejected', reason: 'injury_target_mismatch' };
  }
  const injury = factValue(event, 'injury') as PlayerCondition['injury'] | undefined;
  if (event.subject === 'player') {
    if (!injury || !['minor', 'bleeding', 'leg_injured', 'critical'].includes(injury)) {
      return { status: 'rejected', reason: 'injury_value_invalid' };
    }
    state.player.injury = injury;
    state.world!.characters.player.status = 'injured';
  } else if (event.subject === 'chen_huaimin') {
    state.killerStatus = 'injured';
    state.world!.characters.chen_huaimin.status = 'injured';
  } else if (event.subject === 'lin_yue') {
    state.linYuePhase = 'injured';
    state.world!.characters.lin_yue.status = 'injured';
  } else {
    return { status: 'rejected', reason: 'injury_subject_invalid' };
  }
  return { status: 'applied' };
}

function applyCharacterIncapacitated(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    !hasDirectParentType(event, eventsById, 'character_injured')
    || !hasEvidence(event, ['invariant.incapacitation.requires_injury'])
  ) {
    return { status: 'rejected', reason: 'incapacitation_cause_missing' };
  }
  const injuryParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent?.eventType === 'character_injured');
  if (injuryParent?.subject !== event.subject) {
    return { status: 'rejected', reason: 'incapacitation_subject_mismatch' };
  }
  if (event.subject === 'chen_huaimin') {
    state.killerStatus = 'incapacitated';
    state.world!.characters.chen_huaimin.status = 'injured';
  } else if (event.subject === 'lin_yue') {
    state.linYuePhase = 'injured';
    state.world!.characters.lin_yue.status = 'injured';
  } else {
    return { status: 'rejected', reason: 'incapacitation_subject_invalid' };
  }
  return { status: 'applied' };
}

function applyCharacterKilled(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    !hasDirectParentType(event, eventsById, 'character_injured')
    || !hasEvidence(event, ['invariant.death.requires_lethal_injury'])
  ) {
    return { status: 'rejected', reason: 'lethal_cause_or_evidence_missing' };
  }
  const injuryParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent?.eventType === 'character_injured');
  if (
    injuryParent?.subject !== event.subject
    || factValue(injuryParent, 'injury') !== 'critical'
  ) {
    return { status: 'rejected', reason: 'lethal_injury_not_confirmed' };
  }
  if (event.subject === 'player') {
    state.player.injury = 'critical';
    state.world!.characters.player.status = 'dead';
  } else if (event.subject === 'chen_huaimin') {
    state.killerStatus = 'dead';
    state.world!.characters.chen_huaimin.status = 'dead';
  } else if (event.subject === 'lin_yue') {
    state.linYuePhase = 'dead';
    state.world!.characters.lin_yue.status = 'dead';
  } else {
    return { status: 'rejected', reason: 'death_subject_invalid' };
  }
  return { status: 'applied' };
}

function validatePoliceIntervention(state: GameState, event: ProposedEvent): ApplyResult {
  if (
    state.policePhase !== 'arrived'
    || !hasEvidence(event, ['invariant.arrest.requires_police_presence'])
  ) {
    return { status: 'rejected', reason: 'police_authority_or_evidence_missing' };
  }
  const targetId = characterId(factValue(event, 'target') ?? event.subject);
  if (
    !targetId
    || state.world!.characters.real_police.location !== state.world!.characters[targetId].location
  ) {
    return { status: 'rejected', reason: 'police_presence_invalid' };
  }
  return { status: 'applied' };
}

function applyCharacterArrested(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    event.subject !== 'chen_huaimin'
    || !hasDirectParentType(event, eventsById, 'police_intervention_confirmed')
    || !hasEvidence(event, ['invariant.arrest.requires_police_presence'])
  ) {
    return { status: 'rejected', reason: 'arrest_cause_or_evidence_missing' };
  }
  const intervention = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent?.eventType === 'police_intervention_confirmed');
  if ((factValue(intervention, 'target') ?? intervention?.subject) !== event.subject) {
    return { status: 'rejected', reason: 'arrest_target_mismatch' };
  }
  state.killerStatus = 'arrested';
  state.killerPhase = 'exposed';
  state.world!.characters.chen_huaimin.status = 'arrested';
  return { status: 'applied' };
}

function applyCharacterFled(
  state: GameState,
  event: ProposedEvent,
  eventsById?: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    event.subject !== 'chen_huaimin'
    || state.world!.characters.chen_huaimin.location === 'room_503'
    || !hasEvidence(event, ['invariant.flight.requires_confirmed_route'])
    || !eventsById
    || !hasDirectParentType(event, eventsById, 'actor_moved')
  ) {
    return { status: 'rejected', reason: 'flight_route_invalid' };
  }
  state.killerStatus = 'fled';
  state.killerPhase = 'retreat';
  state.world!.characters.chen_huaimin.status = 'fled';
  return { status: 'applied' };
}

function applyEvidenceDestroyed(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    event.subject !== 'package'
    || !hasDirectParentType(event, eventsById, 'evidence_destruction_attempted')
    || !hasEvidence(event, [
      'fact.object.package.location',
      'invariant.evidence_destroy.requires_access',
    ])
  ) {
    return { status: 'rejected', reason: 'evidence_destruction_cause_or_evidence_missing' };
  }
  const actorId = characterId(factValue(event, 'actor'));
  const attemptParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent?.eventType === 'evidence_destruction_attempted');
  if (
    actorId !== 'chen_huaimin'
    || factValue(attemptParent, 'actor') !== actorId
    || state.world!.characters[actorId].location !== 'room_503'
    || ['incapacitated', 'dead', 'arrested', 'fled'].includes(state.killerStatus)
  ) {
    return { status: 'rejected', reason: 'evidence_access_invalid' };
  }
  state.evidencePhase = 'evidence_destroyed';
  state.room.package.state.destroyed = true;
  state.world!.objects.package.flags.destroyed = true;
  return { status: 'applied' };
}

function applyDeadlineReached(state: GameState, event: ProposedEvent): ApplyResult {
  if (
    state.minute < DEADLINE_MINUTE
    || !hasEvidence(event, ['fact.game.minute', 'invariant.ending.requires_terminal_cause'])
  ) {
    return { status: 'rejected', reason: 'deadline_not_reached' };
  }
  return { status: 'applied' };
}

function applyEnding(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  const ending = factValue(event, 'ending') as EndingId | undefined;
  const reason = factValue(event, 'reason') as EndingReason | undefined;
  if (
    !ending
    || !reason
    || !ENDING_IDS.has(ending)
    || !ENDING_REASONS.has(reason)
    || !hasEvidence(event, ['invariant.ending.requires_terminal_cause'])
  ) {
    return { status: 'rejected', reason: 'ending_value_or_evidence_invalid' };
  }

  const parentTypes = new Set(event.causalParentIds.map((id) => eventsById.get(id)?.eventType));
  if (ending === 'death') {
    const killedPlayer = event.causalParentIds.some((id) => {
      const parent = eventsById.get(id);
      return parent?.eventType === 'character_killed' && parent.subject === 'player';
    });
    if (!killedPlayer || state.player.injury !== 'critical') {
      return { status: 'rejected', reason: 'death_terminal_cause_missing' };
    }
    if (!['forced_entry', 'window_route', 'ambient_pressure', 'deadline_murder'].includes(reason)) {
      return { status: 'rejected', reason: 'ending_reason_mismatch' };
    }
  } else {
    const terminalCause = parentTypes.has('character_arrested')
      || parentTypes.has('character_killed')
      || parentTypes.has('deadline_reached');
    if (!terminalCause) return { status: 'rejected', reason: 'survival_terminal_cause_missing' };
    const hasEvidence = hasConvictingEvidence(state);
    if (ending === 'escaped_with_evidence' && !hasEvidence) {
      return { status: 'rejected', reason: 'convicting_evidence_missing' };
    }
    if (ending === 'escaped_no_evidence' && hasEvidence) {
      return { status: 'rejected', reason: 'ending_evidence_classification_invalid' };
    }
    const validReason = ending === 'escaped_with_evidence'
      ? [
          'killer_dead_with_evidence',
          'deadline_survived_with_evidence',
          'police_arrived_with_evidence',
        ].includes(reason)
      : [
          'killer_dead_no_evidence',
          'police_arrived_without_evidence',
          'escaped_without_evidence',
        ].includes(reason);
    if (!validReason) return { status: 'rejected', reason: 'ending_reason_mismatch' };
  }

  state.ending = ending;
  state.endingReason = reason;
  state.phase = ending === 'death' ? 'death' : 'survived';
  state.score = scoreRun(state);
  return { status: 'applied' };
}

function acceptCandidate(
  state: GameState,
  candidate: CommitEventCandidate,
  accepted: CommitEventCandidate[],
  fragments: DisplayFragment[],
): void {
  accepted.push(candidate);
  if (!isPlayerVisible(candidate.event)) return;
  const summary = deterministicSummary(candidate.event);
  fragments.push({
    id: `display.phase5.${candidate.event.id}`,
    text: summary,
    eventRefs: [candidate.event.id],
    claimRefs: [...candidate.event.facts],
  });
  appendEventLog(state, candidate.event, summary);
}

function appendEventLog(state: GameState, event: ProposedEvent, summary: string): void {
  state.log.push({
    id: `log-phase5-${event.id}`,
    run: state.run,
    minute: state.minute,
    title: deterministicTitle(event),
    text: summary,
    tone: event.eventType === 'ending_reached' && event.subject === 'death'
      ? 'death'
      : event.riskClass === 'reversible'
        ? 'neutral'
        : 'threat',
    channel: 'ambient',
  });
}

function rejectEvent(
  event: ProposedEvent,
  decisionsById: Map<string, HighRiskDecision>,
  reason: string,
): void {
  if (event.riskClass === 'reversible') return;
  decisionsById.set(event.id, {
    eventId: event.id,
    riskClass: event.riskClass,
    evidenceRefs: [...event.evidenceRefs],
    decision: 'reject',
    reasonCodes: [reason],
  });
}

function correctedBlockedEntry(event: ProposedEvent, blockedBy: string): ProposedEvent {
  return {
    id: `${event.id}.blocked`,
    eventType: 'entry_blocked',
    subject: event.subject,
    summary: 'The attempted entry was blocked by a confirmed barrier.',
    facts: [
      `entry_route:${factValue(event, 'entry_route') ?? 'unknown'}`,
      `blocked_by:${blockedBy}`,
    ],
    visibility: [...event.visibility],
    riskClass: 'reversible',
    evidenceRefs: event.evidenceRefs.filter((ref) => !ref.startsWith('event.')),
    causalParentIds: [...event.causalParentIds],
  };
}

function topologicalCandidates(candidates: CommitEventCandidate[]): CommitEventCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.event.id, candidate]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: CommitEventCandidate[] = [];
  const visit = (candidate: CommitEventCandidate) => {
    if (visited.has(candidate.event.id) || visiting.has(candidate.event.id)) return;
    visiting.add(candidate.event.id);
    for (const parentId of candidate.event.causalParentIds) {
      const parent = byId.get(parentId);
      if (parent) visit(parent);
    }
    visiting.delete(candidate.event.id);
    visited.add(candidate.event.id);
    ordered.push(candidate);
  };
  candidates.forEach(visit);
  return ordered;
}

function hasDirectParentType(
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
  eventType: string,
): boolean {
  return event.causalParentIds.some((id) => eventsById.get(id)?.eventType === eventType);
}

function hasEvidence(event: ProposedEvent, required: string[]): boolean {
  return required.every((ref) => event.evidenceRefs.includes(ref));
}

function factValue(event: ProposedEvent | undefined, key: string): string | undefined {
  const prefix = `${key}:`;
  return event?.facts.find((fact) => fact.startsWith(prefix))?.slice(prefix.length);
}

function characterId(value: string | undefined): CharacterId | undefined {
  return value && CHARACTER_IDS.has(value as CharacterId) ? value as CharacterId : undefined;
}

function locationId(value: string | undefined): LocationId | undefined {
  return value && LOCATION_IDS.has(value as LocationId) ? value as LocationId : undefined;
}

function isPlayerVisible(event: ProposedEvent): boolean {
  return event.visibility.includes('player') || event.visibility.includes('public');
}

function deterministicTitle(event: ProposedEvent): string {
  switch (event.eventType) {
    case 'entry_attempted': return 'Entry attempt';
    case 'entry_blocked': return 'Entry blocked';
    case 'actor_entered': return 'Entry confirmed';
    case 'attack_attempted': return 'Attack attempt';
    case 'attack_landed': return 'Attack confirmed';
    case 'character_injured': return 'Injury confirmed';
    case 'character_killed': return 'Death confirmed';
    case 'character_arrested': return 'Arrest confirmed';
    case 'evidence_destroyed': return 'Evidence destroyed';
    case 'ending_reached': return 'Ending confirmed';
    default: return 'World event confirmed';
  }
}

function deterministicSummary(event: ProposedEvent): string {
  switch (event.eventType) {
    case 'actor_moved':
      return `${event.subject} moved to ${factValue(event, 'location') ?? 'a confirmed location'}.`;
    case 'entry_attempted':
      return `${event.subject} attempted entry via ${factValue(event, 'entry_route') ?? 'a route'}.`;
    case 'entry_blocked':
      return `The entry attempt was blocked by ${factValue(event, 'blocked_by') ?? 'a confirmed barrier'}.`;
    case 'actor_entered':
      return `${event.subject} entered room_503 through ${factValue(event, 'entry_route') ?? 'a confirmed route'}.`;
    case 'attack_attempted':
      return `${factValue(event, 'attacker') ?? 'An actor'} attempted to attack ${factValue(event, 'target') ?? event.subject}.`;
    case 'attack_landed':
      return `The attack against ${factValue(event, 'target') ?? event.subject} landed.`;
    case 'attack_blocked':
      return `The attack against ${event.subject} was blocked.`;
    case 'character_injured':
      return `${event.subject} sustained a confirmed ${factValue(event, 'injury') ?? 'injury'}.`;
    case 'character_incapacitated':
      return `${event.subject} was incapacitated.`;
    case 'character_killed':
      return `${event.subject} died from the confirmed lethal injury.`;
    case 'police_intervention_confirmed':
      return `Police intervention against ${event.subject} was confirmed.`;
    case 'character_arrested':
      return `${event.subject} was arrested.`;
    case 'character_fled':
      return `${event.subject} fled through a confirmed route.`;
    case 'evidence_destruction_attempted':
      return `${factValue(event, 'actor') ?? 'An actor'} attempted to destroy ${event.subject}.`;
    case 'evidence_destroyed':
      return `${event.subject} was destroyed by an actor with confirmed access.`;
    case 'deadline_reached':
      return 'The confirmed deadline was reached.';
    case 'ending_reached':
      return `The ${factValue(event, 'ending') ?? event.subject} ending was confirmed.`;
    case 'killer_action_attempted':
      return 'A killer action was attempted.';
    case 'npc_action_attempted':
      return `${event.subject} attempted an NPC action.`;
    default:
      return 'A deterministic world event was confirmed.';
  }
}
