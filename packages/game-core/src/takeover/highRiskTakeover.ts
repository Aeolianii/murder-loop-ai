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
import { assertionValue } from '../facts/eventAssertions';
import { reconcileGamePhase, transitionGamePhase } from '../machines/gamePhaseMachine';

const HIGH_RISK_INVARIANT_REFS = [
  'invariant.arrest.requires_police_presence',
  'invariant.attack.requires_same_location',
  'invariant.death.requires_lethal_injury',
  'invariant.death.requires_feasible_lethal_action',
  'invariant.ending.requires_terminal_cause',
  'invariant.entry.requires_clear_barrier',
  'invariant.evidence_destroy.requires_access',
  'invariant.flight.requires_confirmed_route',
  'invariant.incapacitation.requires_injury',
  'invariant.injury.requires_landed_attack',
] as const;

const SUPPORTED_EVENT_SEMANTICS = new Set([
  'act:attempted',
  'act:completed',
  'attack:attempted',
  'attack:blocked',
  'attack:completed',
  'change_status:completed',
  'destroy:attempted',
  'destroy:completed',
  'enter:attempted',
  'enter:blocked',
  'enter:completed',
  'intervene:completed',
  'move:completed',
  'reach_deadline:completed',
  'resolve_ending:completed',
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
  'self_inflicted',
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
    for (const capability of character.capabilities) {
      refs.add(`capability.${character.id}.${capability}`);
    }
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
  reservedEventIds?: string[];
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
  for (const reservedEventId of input.reservedEventIds ?? []) {
    if (eventsById.has(reservedEventId)) duplicateEventIds.add(reservedEventId);
  }
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
    if (!SUPPORTED_EVENT_SEMANTICS.has(eventSemantic(event))) {
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
        const correctedResult = applyConfirmedEvent(state, result.correctedEvent, eventsById);
        if (correctedResult.status === 'applied') {
          acceptCandidate(state, correctedCandidate, acceptedEventCandidates, displayFragments);
          acceptedEventIds.add(result.correctedEvent.id);
          correctedEventIds.add(result.correctedEvent.id);
        }
      }
      continue;
    }

    const safeCandidate = {
      event: sanitizeConfirmedEvent(event),
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
  switch (eventSemantic(event)) {
    case 'act:attempted':
      return event.actorId === 'chen_huaimin'
        || (event.actorId === 'player' && event.targetIds.includes('player'))
        ? { status: 'applied' }
        : { status: 'rejected', reason: 'action_actor_invalid' };
    case 'act:completed':
      return applyPlayerLethalAction(event, eventsById);
    case 'attack:blocked':
      return { status: 'rejected', reason: 'attack_block_capability_unmodeled' };
    case 'move:completed':
      return applyActorMoved(state, event);
    case 'enter:attempted':
      if (
        event.actorId !== 'chen_huaimin'
        || !actorHasCapability(state, event.actorId, 'enter')
        || !['front_door', 'window'].includes(factValue(event, 'entry_route') ?? '')
      ) {
        return { status: 'rejected', reason: 'entry_actor_invalid' };
      }
      state.killerPhase = 'forced_entry';
      state.phase = transitionGamePhase(state.phase, 'PRESSURE');
      state.threat = Math.min(100, state.threat + 2);
      state.world!.threat = state.threat;
      return { status: 'applied' };
    case 'enter:blocked':
      if (!entryBlockIsConfirmed(state, event)) {
        return { status: 'rejected', reason: 'entry_block_not_confirmed' };
      }
      state.threat = Math.min(100, state.threat + 3);
      state.world!.threat = state.threat;
      return { status: 'applied' };
    case 'enter:completed':
      return applyActorEntered(state, event, eventsById);
    case 'attack:attempted':
      return applyAttackAttempted(state, event);
    case 'attack:completed':
      return applyAttackLanded(state, event, eventsById);
    case 'change_status:completed':
      return applyCharacterStatusChanged(state, event, eventsById);
    case 'intervene:completed':
      return validatePoliceIntervention(state, event);
    case 'destroy:attempted':
      return event.targetIds.includes('package')
        && event.actorId === 'chen_huaimin'
        && actorHasCapability(state, event.actorId, 'destroy')
        ? { status: 'applied' }
        : { status: 'rejected', reason: 'evidence_destruction_actor_invalid' };
    case 'destroy:completed':
      return applyEvidenceDestroyed(state, event, eventsById);
    case 'reach_deadline:completed':
      return applyDeadlineReached(state, event);
    case 'resolve_ending:completed':
      return applyEnding(state, event, eventsById);
    default:
      return { status: 'rejected', reason: 'high_risk_event_type_unsupported' };
  }
}

function applyPlayerLethalAction(
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  const attempt = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && eventSemantic(parent) === 'act:attempted');
  if (
    event.actorId !== 'player'
    || !event.targetIds.includes('player')
    || attempt?.actorId !== 'player'
    || !attempt.targetIds.includes('player')
    || factValue(event, 'lethality') !== 'lethal'
    || !hasEvidence(event, ['invariant.death.requires_feasible_lethal_action'])
  ) {
    return { status: 'rejected', reason: 'player_lethal_action_not_grounded' };
  }
  return { status: 'applied' };
}

function entryBlockIsConfirmed(state: GameState, event: ProposedEvent): boolean {
  if (event.actorId !== 'chen_huaimin') return false;
  const route = factValue(event, 'entry_route');
  const blockedBy = factValue(event, 'blocked_by');
  if (route === 'front_door') {
    return (blockedBy === 'barricade' && state.room.front_door.state.barricaded === true)
      || (blockedBy === 'door_chain' && state.room.front_door.state.chainLocked === true);
  }
  return route === 'window'
    && blockedBy === 'window_lock'
    && state.room.window.state.locked === true;
}

function applyActorMoved(state: GameState, event: ProposedEvent): ApplyResult {
  const actorId = characterId(event.actorId);
  const destination = locationId(factValue(event, 'location'));
  if (
    !actorId
    || actorId === 'player'
    || !destination
    || !actorHasCapability(state, actorId, 'move')
  ) {
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
  if (!hasDirectParentSemantic(event, eventsById, 'enter', 'attempted')) {
    return { status: 'rejected', reason: 'entry_attempt_missing' };
  }
  const actorId = characterId(event.actorId);
  const route = factValue(event, 'entry_route');
  if (
    actorId !== 'chen_huaimin'
    || !actorHasCapability(state, actorId, 'enter')
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
    if (state.world!.characters[actorId].location !== 'corridor_5f') {
      return { status: 'rejected', reason: 'entry_route_not_reached' };
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
  state.phase = transitionGamePhase(state.phase, 'CONFRONT');
  state.threat = Math.min(100, state.threat + 10);
  state.world!.threat = state.threat;
  return { status: 'applied' };
}

function applyAttackAttempted(state: GameState, event: ProposedEvent): ApplyResult {
  const attackerId = characterId(event.actorId);
  const targetId = characterId(event.targetIds[0]);
  if (!attackerId || !targetId || attackerId === targetId) {
    return { status: 'rejected', reason: 'attack_participant_invalid' };
  }
  if (!actorHasCapability(state, attackerId, 'attack')) {
    return { status: 'rejected', reason: 'attacker_capability_missing' };
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
  state.phase = transitionGamePhase(state.phase, 'CONFRONT');
  return { status: 'applied' };
}

function applyAttackLanded(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (!hasDirectParentSemantic(event, eventsById, 'attack', 'attempted')) {
    return { status: 'rejected', reason: 'attack_attempt_missing' };
  }
  return applyAttackAttempted(state, event);
}

function applyCharacterStatusChanged(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  switch (factValue(event, 'status')) {
    case 'injured':
      return applyCharacterInjured(state, event, eventsById);
    case 'incapacitated':
      return applyCharacterIncapacitated(state, event, eventsById);
    case 'dead':
      return applyCharacterKilled(state, event, eventsById);
    case 'arrested':
      return applyCharacterArrested(state, event, eventsById);
    case 'fled':
      return applyCharacterFled(state, event, eventsById);
    default:
      return { status: 'rejected', reason: 'character_status_invalid' };
  }
}

function applyCharacterInjured(
  state: GameState,
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
): ApplyResult {
  if (
    !hasDirectParentSemantic(event, eventsById, 'attack', 'completed')
    || !hasEvidence(event, ['invariant.injury.requires_landed_attack'])
  ) {
    return { status: 'rejected', reason: 'injury_cause_or_evidence_missing' };
  }
  const attackParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && eventSemantic(parent) === 'attack:completed');
  const subject = event.targetIds[0];
  if (attackParent?.targetIds[0] !== subject) {
    return { status: 'rejected', reason: 'injury_target_mismatch' };
  }
  const injury = factValue(event, 'injury') as PlayerCondition['injury'] | undefined;
  if (subject === 'player') {
    if (!injury || !['minor', 'bleeding', 'leg_injured', 'critical'].includes(injury)) {
      return { status: 'rejected', reason: 'injury_value_invalid' };
    }
    state.player.injury = injury;
    state.world!.characters.player.status = 'injured';
  } else if (subject === 'chen_huaimin') {
    state.killerStatus = 'injured';
    state.world!.characters.chen_huaimin.status = 'injured';
  } else if (subject === 'lin_yue') {
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
    !hasDirectParentStatus(event, eventsById, 'injured')
    || !hasEvidence(event, ['invariant.incapacitation.requires_injury'])
  ) {
    return { status: 'rejected', reason: 'incapacitation_cause_missing' };
  }
  const injuryParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && factValue(parent, 'status') === 'injured');
  const subject = event.targetIds[0];
  if (injuryParent?.targetIds[0] !== subject) {
    return { status: 'rejected', reason: 'incapacitation_subject_mismatch' };
  }
  if (subject === 'chen_huaimin') {
    state.killerStatus = 'incapacitated';
    state.world!.characters.chen_huaimin.status = 'injured';
  } else if (subject === 'lin_yue') {
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
  const lethalPlayerAction = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => (
      parent
      && eventSemantic(parent) === 'act:completed'
      && parent.actorId === 'player'
      && parent.targetIds.includes('player')
      && factValue(parent, 'lethality') === 'lethal'
    ));
  const subject = event.targetIds[0];
  if (
    subject === 'player'
    && lethalPlayerAction
    && hasEvidence(event, ['invariant.death.requires_feasible_lethal_action'])
  ) {
    state.player.injury = 'critical';
    state.world!.characters.player.status = 'dead';
    return { status: 'applied' };
  }
  if (
    !hasDirectParentStatus(event, eventsById, 'injured')
    || !hasEvidence(event, ['invariant.death.requires_lethal_injury'])
  ) {
    return { status: 'rejected', reason: 'lethal_cause_or_evidence_missing' };
  }
  const injuryParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && factValue(parent, 'status') === 'injured');
  if (
    injuryParent?.targetIds[0] !== subject
    || factValue(injuryParent, 'injury') !== 'critical'
  ) {
    return { status: 'rejected', reason: 'lethal_injury_not_confirmed' };
  }
  if (subject === 'player') {
    state.player.injury = 'critical';
    state.world!.characters.player.status = 'dead';
  } else if (subject === 'chen_huaimin') {
    state.killerStatus = 'dead';
    state.world!.characters.chen_huaimin.status = 'dead';
  } else if (subject === 'lin_yue') {
    state.linYuePhase = 'dead';
    state.world!.characters.lin_yue.status = 'dead';
  } else {
    return { status: 'rejected', reason: 'death_subject_invalid' };
  }
  return { status: 'applied' };
}

function validatePoliceIntervention(state: GameState, event: ProposedEvent): ApplyResult {
  const actorId = characterId(event.actorId);
  if (
    !actorId
    || !state.world!.characters[actorId].capabilities.includes('intervene')
    || state.policePhase !== 'arrived'
    || !hasEvidence(event, ['invariant.arrest.requires_police_presence'])
  ) {
    return { status: 'rejected', reason: 'police_authority_or_evidence_missing' };
  }
  const targetId = characterId(event.targetIds[0]);
  if (
    !targetId
    || state.world!.characters[actorId].location !== state.world!.characters[targetId].location
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
    event.targetIds[0] !== 'chen_huaimin'
    || !hasDirectParentSemantic(event, eventsById, 'intervene', 'completed')
    || !hasEvidence(event, ['invariant.arrest.requires_police_presence'])
  ) {
    return { status: 'rejected', reason: 'arrest_cause_or_evidence_missing' };
  }
  const intervention = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && eventSemantic(parent) === 'intervene:completed');
  if (intervention?.targetIds[0] !== event.targetIds[0]) {
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
    event.targetIds[0] !== 'chen_huaimin'
    || state.world!.characters.chen_huaimin.location === 'room_503'
    || !hasEvidence(event, ['invariant.flight.requires_confirmed_route'])
    || !eventsById
    || !hasDirectParentSemantic(event, eventsById, 'move', 'completed')
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
    event.targetIds[0] !== 'package'
    || !hasDirectParentSemantic(event, eventsById, 'destroy', 'attempted')
    || !hasEvidence(event, [
      'fact.object.package.location',
      'invariant.evidence_destroy.requires_access',
    ])
  ) {
    return { status: 'rejected', reason: 'evidence_destruction_cause_or_evidence_missing' };
  }
  const actorId = characterId(event.actorId);
  const attemptParent = event.causalParentIds
    .map((id) => eventsById.get(id))
    .find((parent) => parent && eventSemantic(parent) === 'destroy:attempted');
  if (
    actorId !== 'chen_huaimin'
    || attemptParent?.actorId !== actorId
    || state.world!.characters[actorId].location !== 'room_503'
    || ['incapacitated', 'dead', 'arrested', 'fled'].includes(state.killerStatus)
  ) {
    return { status: 'rejected', reason: 'evidence_access_invalid' };
  }
  const hiddenAt = state.room.package.state.hiddenAt;
  if (
    typeof hiddenAt === 'string'
    && hiddenAt.length > 0
    && state.killerKnowledge.knowsEvidenceLocation !== hiddenAt
  ) {
    return { status: 'rejected', reason: 'hidden_evidence_location_unknown' };
  }
  const hasExternalCopy = state.room.package.state.photographed === true
    || state.room.package.state.backedUp === true
    || state.world!.objects.package_photo.flags.exists === true
    || state.world!.objects.package_photo.flags.backedUp === true;
  if (!hasExternalCopy) state.evidencePhase = 'evidence_destroyed';
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

  const parentSemantics = new Set(event.causalParentIds.map((id) => {
    const parent = eventsById.get(id);
    return parent ? eventSemantic(parent) : undefined;
  }));
  if (ending === 'death') {
    const killedPlayerEvent = event.causalParentIds
      .map((id) => eventsById.get(id))
      .find((parent) => (
        parent
        && eventSemantic(parent) === 'change_status:completed'
        && factValue(parent, 'status') === 'dead'
        && parent.targetIds[0] === 'player'
      ));
    const selfInflictedCause = killedPlayerEvent?.causalParentIds.some((id) => {
      const parent = eventsById.get(id);
      return parent
        && eventSemantic(parent) === 'act:completed'
        && parent.actorId === 'player'
        && parent.targetIds.includes('player')
        && factValue(parent, 'lethality') === 'lethal';
    }) ?? false;
    if (!killedPlayerEvent || state.player.injury !== 'critical') {
      return { status: 'rejected', reason: 'death_terminal_cause_missing' };
    }
    if (
      (reason === 'self_inflicted') !== selfInflictedCause
      || (!selfInflictedCause
        && !['forced_entry', 'window_route', 'ambient_pressure', 'deadline_murder'].includes(reason))
    ) {
      return { status: 'rejected', reason: 'ending_reason_mismatch' };
    }
  } else {
    const parentEvents = event.causalParentIds
      .map((id) => eventsById.get(id))
      .filter((parent): parent is ProposedEvent => Boolean(parent));
    const killerKilled = parentEvents.some((parent) => (
      eventSemantic(parent) === 'change_status:completed'
      && factValue(parent, 'status') === 'dead'
      && parent.targetIds[0] === 'chen_huaimin'
    ));
    const killerArrested = parentEvents.some((parent) => (
      eventSemantic(parent) === 'change_status:completed'
      && factValue(parent, 'status') === 'arrested'
      && parent.targetIds[0] === 'chen_huaimin'
    ));
    const killerFled = parentEvents.some((parent) => (
      eventSemantic(parent) === 'change_status:completed'
      && factValue(parent, 'status') === 'fled'
      && parent.targetIds[0] === 'chen_huaimin'
    ));
    const deadlineReached = parentSemantics.has('reach_deadline:completed');
    if (!killerKilled && !killerArrested && !killerFled && !deadlineReached) {
      return { status: 'rejected', reason: 'survival_terminal_cause_missing' };
    }
    const hasEvidence = hasConvictingEvidence(state);
    if (ending === 'escaped_with_evidence' && !hasEvidence) {
      return { status: 'rejected', reason: 'convicting_evidence_missing' };
    }
    if (ending === 'escaped_no_evidence' && hasEvidence) {
      return { status: 'rejected', reason: 'ending_evidence_classification_invalid' };
    }
    const validReason = ending === 'escaped_with_evidence'
      ? (reason === 'killer_dead_with_evidence' && killerKilled)
        || (reason === 'deadline_survived_with_evidence' && deadlineReached)
        || (reason === 'police_arrived_with_evidence' && killerArrested)
      : (reason === 'killer_dead_no_evidence' && killerKilled)
        || (reason === 'police_arrived_without_evidence' && killerArrested)
        || (reason === 'escaped_without_evidence' && killerFled);
    if (!validReason) return { status: 'rejected', reason: 'ending_reason_mismatch' };
  }

  const previousPhase = state.phase;
  state.ending = ending;
  state.endingReason = reason;
  state.phase = reconcileGamePhase(previousPhase, state);
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
    claimRefs: candidate.event.assertions.map((assertion) => assertion.id),
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
    tone: event.kind === 'ending' && factValue(event, 'ending') === 'death'
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
  const entryRoute = factValue(event, 'entry_route') ?? 'unknown';
  return {
    id: `${event.id}.blocked`,
    kind: 'action',
    sourceActionIds: [...event.sourceActionIds],
    actorId: event.actorId,
    operation: 'enter',
    targetIds: [...event.targetIds],
    status: 'blocked',
    summary: 'The attempted entry was blocked by a confirmed barrier.',
    assertions: [
      {
        id: `assertion.${event.id}.blocked.route`,
        subject: event.targetIds[0] ?? event.actorId,
        predicate: 'entry_route',
        value: entryRoute,
        visibleTo: [...event.visibility],
      },
      {
        id: `assertion.${event.id}.blocked.barrier`,
        subject: event.targetIds[0] ?? event.actorId,
        predicate: 'blocked_by',
        value: blockedBy,
        visibleTo: [...event.visibility],
      },
    ],
    visibility: [...event.visibility],
    riskClass: 'reversible',
    evidenceRefs: event.evidenceRefs.filter((ref) => !ref.startsWith('event.')),
    causalParentIds: [...event.causalParentIds],
  };
}

function sanitizeConfirmedEvent(event: ProposedEvent): ProposedEvent {
  const predicatesBySemantic: Record<string, string[]> = {
    'act:completed': ['lethality'],
    'move:completed': ['location'],
    'enter:attempted': ['entry_route'],
    'enter:blocked': ['entry_route', 'blocked_by'],
    'enter:completed': ['entry_route', 'location'],
    'attack:attempted': ['weapon'],
    'attack:completed': ['weapon'],
    'attack:blocked': ['blocked_by'],
    'change_status:completed': ['status', 'injury'],
    'intervene:completed': ['authority'],
    'destroy:attempted': ['method'],
    'destroy:completed': ['evidence'],
    'reach_deadline:completed': ['minute'],
    'resolve_ending:completed': ['ending', 'reason'],
  };
  const allowedPredicates = new Set(predicatesBySemantic[eventSemantic(event)] ?? []);
  return {
    ...event,
    summary: deterministicSummary(event),
    assertions: event.assertions
      .filter((assertion) => allowedPredicates.has(assertion.predicate))
      .map((assertion) => ({
        ...assertion,
        visibleTo: [...new Set(assertion.visibleTo.filter((value) => (
          ['player', 'public', 'killer', 'system', 'hidden'].includes(value)
        )))],
      })),
    visibility: [...new Set(event.visibility.filter((value) => (
      ['player', 'public', 'killer', 'system', 'hidden'].includes(value)
    )))],
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

function hasDirectParentSemantic(
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
  operation: string,
  status: ProposedEvent['status'],
): boolean {
  return event.causalParentIds.some((id) => {
    const parent = eventsById.get(id);
    return parent?.operation === operation && parent.status === status;
  });
}

function hasDirectParentStatus(
  event: ProposedEvent,
  eventsById: Map<string, ProposedEvent>,
  status: string,
): boolean {
  return event.causalParentIds.some((id) => {
    const parent = eventsById.get(id);
    return parent?.operation === 'change_status' && factValue(parent, 'status') === status;
  });
}

function hasEvidence(event: ProposedEvent, required: string[]): boolean {
  return required.every((ref) => event.evidenceRefs.includes(ref));
}

function factValue(event: ProposedEvent | undefined, key: string): string | undefined {
  const value = assertionValue(event, key);
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function characterId(value: string | undefined): CharacterId | undefined {
  return value && CHARACTER_IDS.has(value as CharacterId) ? value as CharacterId : undefined;
}

function locationId(value: string | undefined): LocationId | undefined {
  return value && LOCATION_IDS.has(value as LocationId) ? value as LocationId : undefined;
}

function actorHasCapability(state: GameState, actorId: string, capability: string): boolean {
  const character = state.world?.characters[actorId as CharacterId];
  return Boolean(character?.capabilities.includes(capability));
}

function isPlayerVisible(event: ProposedEvent): boolean {
  return event.visibility.includes('player') || event.visibility.includes('public');
}

function deterministicTitle(event: ProposedEvent): string {
  switch (eventSemantic(event)) {
    case 'enter:attempted': return '进入尝试';
    case 'enter:blocked': return '进入受阻';
    case 'enter:completed': return '进入已确认';
    case 'attack:attempted': return '攻击尝试';
    case 'attack:completed': return '攻击已确认';
    case 'change_status:completed': return factValue(event, 'status') === 'dead' ? '死亡' : '状态变化';
    case 'destroy:completed': return '证据被毁';
    case 'resolve_ending:completed': return factValue(event, 'ending') === 'death' ? '死亡结局' : '结局已确认';
    default: return '世界事件已确认';
  }
}

function deterministicSummary(event: ProposedEvent): string {
  const actor = displayEntityLabel(event.actorId, '相关人物');
  const target = displayEntityLabel(event.targetIds[0], '相关目标');
  switch (eventSemantic(event)) {
    case 'move:completed':
      return `${actor}移动到了已确认的位置。`;
    case 'enter:attempted':
      return `${actor}尝试进入。`;
    case 'enter:blocked':
      return `进入尝试被已确认的障碍挡住了。`;
    case 'enter:completed':
      return `${actor}已经进入${target}。`;
    case 'attack:attempted':
      return `${actor}试图攻击${target}。`;
    case 'attack:completed':
      return `针对${target}的攻击已经命中。`;
    case 'attack:blocked':
      return `针对${target}的攻击被挡住了。`;
    case 'change_status:completed':
      return target === 'player' && factValue(event, 'status') === 'dead'
        ? '你在这次行动中死亡。'
        : `${target}的状态已经发生变化。`;
    case 'intervene:completed':
      return `针对${target}的介入已经确认。`;
    case 'destroy:attempted':
      return `${actor}试图销毁${target}。`;
    case 'destroy:completed':
      return `${target}已被有权限接触它的人销毁。`;
    case 'reach_deadline:completed':
      return '已到达确认的截止时间。';
    case 'resolve_ending:completed':
      return factValue(event, 'ending') === 'death'
        ? '这一轮在你的死亡中结束。'
        : '这一轮的结局已经确认。';
    case 'act:attempted':
      return `${actor}尝试执行这个行动。`;
    case 'act:completed':
      return factValue(event, 'lethality') === 'lethal'
        ? '你执行了一个已确认会造成致命后果的行动。'
        : '你完成了这个行动。';
    default:
      return '一个世界事件已经确认。';
  }
}

function displayEntityLabel(id: string | undefined, fallback: string): string {
  const labels: Record<string, string> = {
    player: '你',
    chen_huaimin: '陈怀民',
    lin_yue: '林越',
    real_police: '警方',
    fake_police: '门外的人',
    system: '环境',
    room_503: '房间',
    room_501: '隔壁房间',
    corridor_5f: '五楼走廊',
    stairwell: '楼梯间',
    lobby: '大堂',
    parking_lot: '停车场',
    package: '包裹',
    front_door: '入户门',
    window: '窗户',
    death: '死亡结局',
  };
  return id ? labels[id] ?? fallback : fallback;
}

function eventSemantic(event: ProposedEvent): string {
  return `${event.operation}:${event.status}`;
}
