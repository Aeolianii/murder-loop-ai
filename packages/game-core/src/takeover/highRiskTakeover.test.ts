import assert from 'node:assert/strict';
import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';
import { createInitialGameState } from '../state/createInitialState';
import { createInitialWorldState } from '../world/worldSimulator';
import {
  projectConfirmedHighRiskResults,
  type HighRiskTakeoverProjection,
} from './highRiskTakeover';

function event(input: {
  id: string;
  eventType: string;
  subject: string;
  riskClass?: ProposedEvent['riskClass'];
  facts?: string[];
  evidenceRefs?: string[];
  causalParentIds?: string[];
}): ProposedEvent {
  const semanticsByLegacyType: Record<string, {
    kind: ProposedEvent['kind'];
    operation: string;
    status: ProposedEvent['status'];
    inferredStatus?: string;
  }> = {
    actor_entered: { kind: 'action', operation: 'enter', status: 'completed' },
    actor_moved: { kind: 'state_transition', operation: 'move', status: 'completed' },
    attack_attempted: { kind: 'action', operation: 'attack', status: 'attempted' },
    attack_blocked: { kind: 'action', operation: 'attack', status: 'blocked' },
    attack_landed: { kind: 'action', operation: 'attack', status: 'completed' },
    character_arrested: { kind: 'state_transition', operation: 'change_status', status: 'completed', inferredStatus: 'arrested' },
    character_fled: { kind: 'state_transition', operation: 'change_status', status: 'completed', inferredStatus: 'fled' },
    character_incapacitated: { kind: 'state_transition', operation: 'change_status', status: 'completed', inferredStatus: 'incapacitated' },
    character_injured: { kind: 'state_transition', operation: 'change_status', status: 'completed', inferredStatus: 'injured' },
    character_killed: { kind: 'state_transition', operation: 'change_status', status: 'completed', inferredStatus: 'dead' },
    deadline_reached: { kind: 'timer', operation: 'reach_deadline', status: 'completed' },
    ending_reached: { kind: 'ending', operation: 'resolve_ending', status: 'completed' },
    entry_attempted: { kind: 'action', operation: 'enter', status: 'attempted' },
    entry_blocked: { kind: 'action', operation: 'enter', status: 'blocked' },
    evidence_destroyed: { kind: 'state_transition', operation: 'destroy', status: 'completed' },
    evidence_destruction_attempted: { kind: 'action', operation: 'destroy', status: 'attempted' },
    killer_action_attempted: { kind: 'action', operation: 'act', status: 'attempted' },
    npc_action_attempted: { kind: 'action', operation: 'act', status: 'attempted' },
    police_intervention_confirmed: { kind: 'action', operation: 'intervene', status: 'completed' },
  };
  const semantics = semanticsByLegacyType[input.eventType];
  if (!semantics) throw new Error(`Missing test semantics for ${input.eventType}`);
  const rawFacts = [...(input.facts ?? [])];
  if (semantics.inferredStatus && !rawFacts.some((fact) => fact.startsWith('status:'))) {
    rawFacts.push(`status:${semantics.inferredStatus}`);
  }
  const factMap = new Map(rawFacts.map((fact) => {
    const separator = fact.indexOf(':');
    return [fact.slice(0, separator), fact.slice(separator + 1)];
  }));
  const subjectIsActor = [
    'actor_entered',
    'actor_moved',
    'entry_attempted',
    'entry_blocked',
    'killer_action_attempted',
    'npc_action_attempted',
  ].includes(input.eventType);
  const actorId = factMap.get('actor')
    ?? factMap.get('attacker')
    ?? (['deadline_reached', 'ending_reached'].includes(input.eventType)
      ? 'system'
      : subjectIsActor
        ? input.subject
        : 'chen_huaimin');
  const targetId = input.eventType === 'actor_entered'
    ? factMap.get('location') ?? input.subject
    : factMap.get('target') ?? input.subject;
  return {
    id: input.id,
    kind: semantics.kind,
    sourceActionIds: [],
    actorId,
    operation: semantics.operation,
    targetIds: [targetId],
    status: semantics.status,
    summary: `Untrusted summary for ${input.eventType}.`,
    assertions: rawFacts.map((fact, index) => {
      const separator = fact.indexOf(':');
      return {
        id: `assertion.${input.id}.${index}`,
        subject: input.subject,
        predicate: fact.slice(0, separator),
        value: fact.slice(separator + 1),
        visibleTo: ['player'],
      };
    }),
    visibility: ['player'],
    riskClass: input.riskClass ?? 'reversible',
    evidenceRefs: input.evidenceRefs ?? [],
    causalParentIds: input.causalParentIds ?? [],
  };
}

function project(events: ProposedEvent[]): HighRiskTakeoverProjection {
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  return projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: events.map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.room.front_door.state.chainLocked = true;
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  const legacyCandidate = structuredClone(state);
  legacyCandidate.ending = 'death';
  legacyCandidate.endingReason = 'forced_entry';
  legacyCandidate.phase = 'death';
  legacyCandidate.player.injury = 'critical';
  legacyCandidate.killerStatus = 'confronting';
  legacyCandidate.evidencePhase = 'evidence_destroyed';
  legacyCandidate.room.package.state.destroyed = true;

  const attempted = event({
    id: 'event.entry.attempted',
    eventType: 'entry_attempted',
    subject: 'chen_huaimin',
    facts: ['entry_route:front_door'],
  });
  const entered = event({
    id: 'event.entry.confirmed',
    eventType: 'actor_entered',
    subject: 'chen_huaimin',
    riskClass: 'high_impact',
    facts: ['entry_route:front_door', 'location:room_503'],
    evidenceRefs: [
      attempted.id,
      'fact.object.front_door.chainLocked',
      'fact.object.front_door.barricaded',
      'capability.killer.spare_key',
      'invariant.entry.requires_clear_barrier',
    ],
    causalParentIds: [attempted.id],
  });
  const killed = event({
    id: 'event.player.killed',
    eventType: 'character_killed',
    subject: 'player',
    riskClass: 'irreversible',
    facts: ['status:dead'],
    evidenceRefs: [entered.id, 'invariant.death.requires_lethal_injury'],
    causalParentIds: [entered.id],
  });

  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    candidateState: legacyCandidate,
    eventCandidates: [attempted, entered, killed].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });

  assert.equal(projection.state.ending, null, 'legacy death cannot survive phase-five projection');
  assert.equal(projection.state.player.injury, 'none');
  assert.equal(projection.state.evidencePhase, 'package_unnoticed');
  assert.equal(projection.state.room.package.state.destroyed, undefined);
  assert.equal(projection.state.threat, state.threat + 5);
  assert.equal(projection.acceptedEventCandidates.some(({ event: item }) => item.id === entered.id), false);
  assert.equal(projection.correctedEventIds.includes(`${entered.id}.blocked`), true);
  assert.equal(projection.rejectedEventIds.includes(entered.id), true);
  assert.equal(projection.rejectedEventIds.includes(killed.id), true);
  assert.equal(projection.displayFragments.some((fragment) => fragment.text.includes('Untrusted')), false);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  state.room.package.state.photographed = true;
  state.room.phone.state.recording = true;
  const attemptedEntry = event({
    id: 'event.valid.entry-attempted',
    eventType: 'entry_attempted',
    subject: 'chen_huaimin',
    facts: ['entry_route:front_door'],
  });
  const entered = event({
    id: 'event.valid.entered',
    eventType: 'actor_entered',
    subject: 'chen_huaimin',
    riskClass: 'high_impact',
    facts: ['entry_route:front_door', 'location:room_503'],
    evidenceRefs: [
      attemptedEntry.id,
      'fact.object.front_door.chainLocked',
      'fact.object.front_door.barricaded',
      'capability.killer.spare_key',
      'invariant.entry.requires_clear_barrier',
    ],
    causalParentIds: [attemptedEntry.id],
  });
  const attemptedAttack = event({
    id: 'event.valid.attack-attempted',
    eventType: 'attack_attempted',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['attacker:chen_huaimin', 'target:player'],
    evidenceRefs: [
      entered.id,
      'capability.killer.attack',
      'invariant.attack.requires_same_location',
    ],
    causalParentIds: [entered.id],
  });
  const landed = event({
    id: 'event.valid.attack-landed',
    eventType: 'attack_landed',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['attacker:chen_huaimin', 'target:player'],
    evidenceRefs: [
      attemptedAttack.id,
      'capability.killer.attack',
      'invariant.attack.requires_same_location',
    ],
    causalParentIds: [attemptedAttack.id],
  });
  const injured = event({
    id: 'event.valid.player-injured',
    eventType: 'character_injured',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['injury:critical'],
    evidenceRefs: [
      landed.id,
      'fact.player.injury',
      'invariant.injury.requires_landed_attack',
    ],
    causalParentIds: [landed.id],
  });
  const killed = event({
    id: 'event.valid.player-killed',
    eventType: 'character_killed',
    subject: 'player',
    riskClass: 'irreversible',
    facts: ['status:dead'],
    evidenceRefs: [
      injured.id,
      'invariant.death.requires_lethal_injury',
    ],
    causalParentIds: [injured.id],
  });
  const ending = event({
    id: 'event.valid.death-ending',
    eventType: 'ending_reached',
    subject: 'death',
    riskClass: 'irreversible',
    facts: ['ending:death', 'reason:forced_entry', 'invented_secret:must_not_commit'],
    evidenceRefs: [
      killed.id,
      'invariant.ending.requires_terminal_cause',
    ],
    causalParentIds: [killed.id],
  });
  const falseEscape = event({
    id: 'event.invalid.escape-after-player-death',
    eventType: 'ending_reached',
    subject: 'escaped_with_evidence',
    riskClass: 'irreversible',
    facts: ['ending:escaped_with_evidence', 'reason:killer_dead_with_evidence'],
    evidenceRefs: [
      killed.id,
      'invariant.ending.requires_terminal_cause',
    ],
    causalParentIds: [killed.id],
  });

  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [
      attemptedEntry,
      entered,
      attemptedAttack,
      landed,
      injured,
      killed,
      ending,
      falseEscape,
    ].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });

  assert.equal(projection.state.world?.characters.chen_huaimin.location, 'room_503');
  assert.equal(projection.state.killerStatus, 'confronting');
  assert.equal(projection.state.combatTriggered, true);
  assert.equal(projection.state.player.injury, 'critical');
  assert.equal(projection.state.ending, 'death');
  assert.equal(projection.state.endingReason, 'forced_entry');
  assert.equal(projection.state.phase, 'death');
  assert(projection.state.score);
  assert.deepEqual(projection.rejectedEventIds, [falseEscape.id]);
  assert.equal(
    projection.highRiskDecisions
      .find((decision) => decision.eventId === falseEscape.id)
      ?.decision,
    'reject',
  );
  assert.equal(
    projection.highRiskDecisions
      .filter((decision) => decision.eventId !== falseEscape.id)
      .every((decision) => decision.decision === 'pass'),
    true,
  );
  assert.equal(projection.acceptedEventCandidates.length, 7);
  assert.equal(
    projection.acceptedEventCandidates
      .find(({ event: item }) => item.id === ending.id)
      ?.event.assertions.some((assertion) => assertion.predicate === 'invented_secret'),
    false,
  );
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'room_503';
  const attempted = event({
    id: 'event.destroy.attempted',
    eventType: 'evidence_destruction_attempted',
    subject: 'package',
    facts: ['actor:chen_huaimin'],
  });
  const destroyed = event({
    id: 'event.destroy.confirmed',
    eventType: 'evidence_destroyed',
    subject: 'package',
    riskClass: 'irreversible',
    facts: ['actor:chen_huaimin', 'evidence:package'],
    evidenceRefs: [
      attempted.id,
      'fact.object.package.location',
      'invariant.evidence_destroy.requires_access',
    ],
    causalParentIds: [attempted.id],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [attempted, destroyed].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });
  assert.equal(projection.state.evidencePhase, 'evidence_destroyed');
  assert.equal(projection.state.room.package.state.destroyed, true);
  assert.equal(projection.state.world?.objects.package.flags.destroyed, true);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'room_503';
  state.room.package.state.hiddenAt = 'closet';
  state.killerKnowledge.knowsEvidenceLocation = null;
  const attempted = event({
    id: 'event.hidden.destroy-attempted',
    eventType: 'evidence_destruction_attempted',
    subject: 'package',
    facts: ['actor:chen_huaimin'],
  });
  const destroyed = event({
    id: 'event.hidden.destroyed',
    eventType: 'evidence_destroyed',
    subject: 'package',
    riskClass: 'irreversible',
    facts: ['actor:chen_huaimin', 'evidence:package'],
    evidenceRefs: [
      attempted.id,
      'fact.object.package.location',
      'invariant.evidence_destroy.requires_access',
    ],
    causalParentIds: [attempted.id],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [attempted, destroyed].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });
  assert.equal(projection.state.room.package.state.destroyed, undefined);
  assert.equal(projection.rejectedEventIds.includes(destroyed.id), true);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.policePhase = 'arrived';
  state.world.characters.real_police.location = 'corridor_5f';
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  const intervention = event({
    id: 'event.police.intervention',
    eventType: 'police_intervention_confirmed',
    subject: 'chen_huaimin',
    riskClass: 'high_impact',
    facts: ['actor:real_police', 'target:chen_huaimin'],
    evidenceRefs: [
      'fact.game.police_phase',
      'fact.world.character.real_police.location',
      'fact.world.character.chen_huaimin.location',
      'invariant.arrest.requires_police_presence',
    ],
  });
  const arrested = event({
    id: 'event.killer.arrested',
    eventType: 'character_arrested',
    subject: 'chen_huaimin',
    riskClass: 'irreversible',
    facts: ['status:arrested'],
    evidenceRefs: [
      intervention.id,
      'fact.world.character.chen_huaimin.status',
      'invariant.arrest.requires_police_presence',
    ],
    causalParentIds: [intervention.id],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [intervention, arrested].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.npc.selected',
    })),
  });
  assert.equal(projection.state.killerStatus, 'arrested');
  assert.equal(projection.state.world?.characters.chen_huaimin.status, 'arrested');
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.policePhase = 'arrived';
  state.world.characters.real_police.location = 'corridor_5f';
  state.world.characters.lin_yue.location = 'corridor_5f';
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  const unauthorizedIntervention = event({
    id: 'event.unauthorized.intervention',
    eventType: 'police_intervention_confirmed',
    subject: 'chen_huaimin',
    riskClass: 'high_impact',
    facts: ['actor:lin_yue', 'target:chen_huaimin'],
    evidenceRefs: [
      'fact.game.police_phase',
      'fact.world.character.real_police.location',
      'fact.world.character.chen_huaimin.location',
      'invariant.arrest.requires_police_presence',
    ],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [{
      event: unauthorizedIntervention,
      sourceProposalId: 'proposal.npc.lin-yue',
    }],
  });
  assert.equal(
    projection.rejectedEventIds.includes(unauthorizedIntervention.id),
    true,
    'an actor without the intervene capability cannot author an intervention',
  );
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'room_503';
  state.world.characters.chen_huaimin.status = 'dead';
  state.killerStatus = 'dead';
  const attemptedAttack = event({
    id: 'event.invalid.dead-attacker',
    eventType: 'attack_attempted',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['attacker:chen_huaimin', 'target:player'],
    evidenceRefs: [
      'capability.killer.attack',
      'invariant.attack.requires_same_location',
    ],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [{
      event: attemptedAttack,
      sourceProposalId: 'proposal.killer.selected',
    }],
  });
  assert.equal(projection.state.combatTriggered, false);
  assert.equal(projection.rejectedEventIds.includes(attemptedAttack.id), true);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'room_503';
  const attempted = event({
    id: 'event.invalid.target.attack-attempted',
    eventType: 'attack_attempted',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['attacker:chen_huaimin', 'target:player'],
    evidenceRefs: [
      'capability.killer.attack',
      'invariant.attack.requires_same_location',
    ],
  });
  const landed = event({
    id: 'event.invalid.target.attack-landed',
    eventType: 'attack_landed',
    subject: 'player',
    riskClass: 'high_impact',
    facts: ['attacker:chen_huaimin', 'target:player'],
    evidenceRefs: [
      attempted.id,
      'capability.killer.attack',
      'invariant.attack.requires_same_location',
    ],
    causalParentIds: [attempted.id],
  });
  const injuredWrongTarget = event({
    id: 'event.invalid.target.injured',
    eventType: 'character_injured',
    subject: 'lin_yue',
    riskClass: 'high_impact',
    facts: ['injury:critical'],
    evidenceRefs: [
      landed.id,
      'invariant.injury.requires_landed_attack',
    ],
    causalParentIds: [landed.id],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [attempted, landed, injuredWrongTarget].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.killer.selected',
    })),
  });
  assert.equal(projection.state.linYuePhase, 'unaware');
  assert.equal(projection.rejectedEventIds.includes(injuredWrongTarget.id), true);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.world.characters.chen_huaimin.location = 'corridor_5f';
  const attempted = event({
    id: 'event.invalid.actor.entry-attempted',
    eventType: 'entry_attempted',
    subject: 'lin_yue',
    facts: ['entry_route:front_door'],
  });
  const entered = event({
    id: 'event.invalid.actor.entered',
    eventType: 'actor_entered',
    subject: 'lin_yue',
    riskClass: 'high_impact',
    facts: ['entry_route:front_door', 'location:room_503'],
    evidenceRefs: [
      attempted.id,
      'fact.object.front_door.chainLocked',
      'fact.object.front_door.barricaded',
      'capability.killer.spare_key',
      'invariant.entry.requires_clear_barrier',
    ],
    causalParentIds: [attempted.id],
  });
  const projection = projectConfirmedHighRiskResults({
    baselineState: state,
    eventCandidates: [attempted, entered].map((candidate) => ({
      event: candidate,
      sourceProposalId: 'proposal.npc.selected',
    })),
  });
  assert.equal(projection.state.world?.characters.lin_yue.location, 'parking_lot');
  assert.equal(projection.rejectedEventIds.includes(entered.id), true);
}

{
  const falseBlocked = event({
    id: 'event.invalid.false-entry-block',
    eventType: 'entry_blocked',
    subject: 'chen_huaimin',
    facts: ['entry_route:front_door', 'blocked_by:door_chain'],
  });
  const projection = project([falseBlocked]);
  assert.equal(projection.rejectedEventIds.includes(falseBlocked.id), true);
  assert.equal(
    projection.acceptedEventCandidates.some(({ event: item }) => item.id === falseBlocked.id),
    false,
  );
}
