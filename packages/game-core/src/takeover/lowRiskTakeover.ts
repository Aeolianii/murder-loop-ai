import type {
  DisplayFragment,
  HighRiskDecision,
  ProposedEvent,
  TurnBrief,
  TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import { DEADLINE_MINUTE, type ActionPlan, type GameState, type RuleEvent, type RuleResult } from '@murder-loop-ai/shared';
import {
  atomicTurnCommit,
  type AtomicTurnCommitOutcome,
  type AtomicTurnStore,
  type CommitEventCandidate,
} from '../commit/atomicTurnCommit';
import type { DomainEvent } from '../domain/domainEvents';
import { assertionIds } from '../facts/eventAssertions';
import {
  buildLowRiskKnowledgeClueCandidates,
  type KnowledgeClueProjectionCandidates,
} from './knowledgeClueTakeover';

const LOW_RISK_OPERATIONS = new Map<string, LowRiskOperation>([
  ['inspect', 'inspect'],
  ['observe', 'inspect'],
  ['photograph', 'preserve_evidence'],
  ['take_photo', 'preserve_evidence'],
  ['preserve_evidence', 'preserve_evidence'],
  ['communicate', 'communicate'],
  ['send_message', 'communicate'],
  ['secure_entry', 'secure_entry'],
  ['secure', 'secure_entry'],
  ['lock', 'secure_entry'],
  ['pick_up', 'pick_up'],
  ['use_item', 'use_item'],
  ['wait', 'wait'],
]);

const ORDINARY_ITEM_IDS = new Set([
  'phone_charger',
  'chair',
  'tape',
  'flashlight',
  'hanger',
  'mirror',
  'newspaper',
  'belt',
  'screwdriver',
  'lighter',
  'bleach',
  'pen_paper',
]);

const COMMUNICATION_TARGET_IDS = new Set(['lin_yue', 'linyue', 'police_dispatch', 'chen_huaimin']);
const PACKAGE_INTERIOR_SCOPE = /(interior|inside|contents?|open)/i;

type LowRiskOperation = 'inspect' | 'preserve_evidence' | 'communicate' | 'secure_entry' | 'pick_up' | 'use_item' | 'wait';

export type LowRiskTakeoverRejectReason =
  | 'compiler_fallback'
  | 'clarification_required'
  | 'conditional_action_not_supported'
  | 'empty_turn'
  | 'unsupported_actor'
  | 'unsupported_operation'
  | 'unsupported_target'
  | 'observation_scope_not_low_risk'
  | 'high_risk_boundary';

export interface PreparedLowRiskPlayerResult extends RuleResult {
  domainEvents: DomainEvent[];
}

export interface PreparedLowRiskTurn {
  status: 'prepared';
  envelope: TurnEnvelope;
  sourceProposalId: string;
  plan: ActionPlan;
  playerResult: PreparedLowRiskPlayerResult;
  eventCandidates: CommitEventCandidate[];
  displayFragments: DisplayFragment[];
  knowledgeClueCandidates: KnowledgeClueProjectionCandidates;
}

export type LowRiskTakeoverPreparation = PreparedLowRiskTurn | {
  status: 'not_eligible';
  reason: LowRiskTakeoverRejectReason;
};

interface AppliedLowRiskAction {
  proposedEvent: ProposedEvent;
  domainEvent: DomainEvent;
  ruleEvent: RuleEvent;
  summary: string;
}

export function prepareLowRiskTurn(input: {
  state: GameState;
  brief: TurnBrief;
  sourceProposalId: string;
  allowHighRiskContinuation?: boolean;
}): LowRiskTakeoverPreparation {
  const eligibility = validateTurnEligibility(input.state, input.brief);
  if (eligibility) return { status: 'not_eligible', reason: eligibility };
  if (
    !input.allowHighRiskContinuation
    && crossesLegacyHighRiskBoundary(input.state, input.brief)
  ) {
    return { status: 'not_eligible', reason: 'high_risk_boundary' };
  }

  const state = structuredClone(input.state) as GameState;
  const plan = buildActionPlan(input.brief);
  const actionEvents: AppliedLowRiskAction[] = [];
  const eventIdByActionId = new Map<string, string>();
  let chargerUsed = false;

  for (const action of input.brief.orderedActions) {
    const operation = LOW_RISK_OPERATIONS.get(action.operation)!;
    const eventId = `event.low-risk.${input.brief.turnId}.${action.actionId}`;
    const causalParentIds = action.dependsOnActionIds
      .map((actionId) => eventIdByActionId.get(actionId))
      .filter((id): id is string => Boolean(id));
    const applied = applyLowRiskAction({
      state,
      action,
      operation,
      eventId,
      causalParentIds,
      envelope: input.brief,
    });
    actionEvents.push(applied);
    eventIdByActionId.set(action.actionId, eventId);
    chargerUsed ||= operation === 'use_item'
      && action.targetIds.includes('phone_charger')
      && state.playerHolding === 'phone_charger';
  }

  const timePassed = Math.max(1, Math.min(5, input.brief.orderedActions.length));
  const minuteBefore = state.minute;
  state.minute += timePassed;
  const supplementalEvents = [createTimeEvent(
    input.brief,
    state.run,
    minuteBefore,
    state.minute,
    actionEvents.at(-1)?.proposedEvent.id,
  )];

  const batteryBefore = state.phoneBattery;
  if (!chargerUsed && state.phoneFunctional) {
    const recording = state.room.phone?.state.recording === true;
    state.phoneBattery = Math.max(0, Math.round(state.phoneBattery - timePassed * (recording ? 3 : 1.5)));
    state.phoneFunctional = state.phoneBattery > 0;
  }
  if (state.room.phone?.state) state.room.phone.state.battery = state.phoneBattery;
  if (state.phoneBattery !== batteryBefore) {
    supplementalEvents.push(createBatteryEvent(
      input.brief,
      state.run,
      state.minute,
      batteryBefore,
      state.phoneBattery,
      supplementalEvents[0].proposedEvent.id,
    ));
  }

  state.phase = state.minute >= DEADLINE_MINUTE - 5
    ? 'pre_2347_countdown'
    : state.policePhase === 'real_police_en_route'
      ? 'confrontation'
      : state.policePhase !== 'not_contacted'
        ? 'police_called'
        : state.threat >= 48
          ? 'killer_pressure'
          : 'investigating';

  const allEvents = [...actionEvents, ...supplementalEvents];
  const knowledgeClueCandidates = buildLowRiskKnowledgeClueCandidates(
    allEvents.map((event) => event.proposedEvent),
    { run: state.run, minute: state.minute },
  );
  const text = actionEvents.map((event) => event.summary).join(' ');
  state.log.push({
    id: `log-low-risk-${input.brief.turnId}`,
    run: state.run,
    minute: state.minute,
    title: 'Action confirmed',
    text,
    tone: 'neutral',
    channel: 'action',
  });

  return {
    status: 'prepared',
    envelope: envelopeFromBrief(input.brief),
    sourceProposalId: input.sourceProposalId,
    plan,
    playerResult: {
      title: 'Action confirmed',
      text,
      tone: 'neutral',
      addedClues: [],
      timePassed,
      threatDelta: 0,
      events: allEvents.map((event) => event.ruleEvent),
      domainEvents: allEvents.map((event) => event.domainEvent),
      state,
    },
    eventCandidates: allEvents.map(({ proposedEvent }) => ({
      event: proposedEvent,
      sourceProposalId: input.sourceProposalId,
    })),
    displayFragments: allEvents.map(({ proposedEvent, summary }) => ({
      id: `display.${proposedEvent.id}`,
      text: summary,
      eventRefs: [proposedEvent.id],
      claimRefs: assertionIds(proposedEvent),
    })),
    knowledgeClueCandidates,
  };
}

export async function commitPreparedLowRiskTurn(input: {
  prepared: PreparedLowRiskTurn;
  finalState: GameState;
  store: AtomicTurnStore<GameState>;
  now?: Date;
  additionalEventCandidates?: CommitEventCandidate[];
  highRiskDecisions?: HighRiskDecision[];
  additionalDisplayFragments?: DisplayFragment[];
}): Promise<{ outcome: AtomicTurnCommitOutcome; state?: GameState }> {
  const outcome = await atomicTurnCommit({
    envelope: input.prepared.envelope,
    expectedOutputStateVersion: input.prepared.envelope.inputStateVersion + 1,
    candidateState: input.finalState,
    events: [
      ...input.prepared.eventCandidates,
      ...(input.additionalEventCandidates ?? []),
    ],
    highRiskDecisions: input.highRiskDecisions ?? [],
    displayFragments: [
      ...input.prepared.displayFragments,
      ...(input.additionalDisplayFragments ?? []),
    ],
  }, input.store, input.now);

  return {
    outcome,
    state: outcome.result.commitStatus === 'committed'
      ? structuredClone(input.finalState) as GameState
      : undefined,
  };
}

function validateTurnEligibility(state: GameState, brief: TurnBrief): LowRiskTakeoverRejectReason | undefined {
  if (brief.compilerVersion.includes('fallback')) return 'compiler_fallback';
  if (brief.utteranceMode !== 'command') return 'clarification_required';
  if (brief.ambiguities.some((ambiguity) => ambiguity.requiresClarification)) return 'clarification_required';
  if ([...brief.globalConstraints, ...brief.scopedConstraints].some((constraint) => constraint.type === 'conditional')) {
    return 'conditional_action_not_supported';
  }
  if (brief.orderedActions.length === 0) return 'empty_turn';

  for (const action of brief.orderedActions) {
    if (action.actorId !== 'player') return 'unsupported_actor';
    const operation = LOW_RISK_OPERATIONS.get(action.operation);
    if (!operation) return 'unsupported_operation';

    if ((operation === 'inspect' || operation === 'preserve_evidence')
      && action.targetIds.includes('package')
      && PACKAGE_INTERIOR_SCOPE.test(`${action.scope ?? ''} ${action.method ?? ''}`)) {
      return 'observation_scope_not_low_risk';
    }
    if (operation === 'inspect') {
      if (action.targetIds.length === 0) return 'unsupported_target';
      const invalid = action.targetIds.some((targetId) => targetId !== 'room' && !state.room[targetId]?.visible);
      if (invalid) return 'unsupported_target';
    }
    if (operation === 'preserve_evidence') {
      if (action.targetIds.length === 0 || action.targetIds.some((targetId) => !state.room[targetId]?.visible)) {
        return 'unsupported_target';
      }
    }
    if (operation === 'communicate') {
      if (action.targetIds.length !== 1 || !COMMUNICATION_TARGET_IDS.has(action.targetIds[0])) return 'unsupported_target';
    }
    if (operation === 'secure_entry') {
      if (!action.targetIds.includes('front_door')) return 'unsupported_target';
      if (action.targetIds.some((targetId) => (
        targetId !== 'front_door'
        && (!['chair', 'luggage', 'suitcase'].includes(targetId) || !state.room[targetId]?.visible)
      ))) {
        return 'unsupported_target';
      }
    }
    if (operation === 'pick_up') {
      if (action.targetIds.length !== 1 || !ORDINARY_ITEM_IDS.has(action.targetIds[0]) || !state.room[action.targetIds[0]]) {
        return 'unsupported_target';
      }
    }
    if (operation === 'use_item') {
      if (action.targetIds.length !== 1 || !['phone_charger', 'tape'].includes(action.targetIds[0])) return 'unsupported_target';
    }
    if (
      operation === 'wait'
      && action.targetIds.length > 0
      && !action.targetIds.every((id) => ['room', 'player', 'self'].includes(id))
    ) {
      return 'unsupported_target';
    }
  }
  return undefined;
}

function crossesLegacyHighRiskBoundary(state: GameState, brief: TurnBrief): boolean {
  if (state.ending || state.combatTriggered || state.policePhase !== 'not_contacted') return true;
  const timePassed = Math.max(1, Math.min(5, brief.orderedActions.length));
  if (state.minute + timePassed >= DEADLINE_MINUTE - 10) return true;

  const contactsLinYue = brief.orderedActions.some((action) => (
    LOW_RISK_OPERATIONS.get(action.operation) === 'communicate'
    && action.targetIds.some((targetId) => targetId === 'lin_yue' || targetId === 'linyue')
  ));
  if (!contactsLinYue && (state.linYuePhase === 'worried' || state.linYuePhase === 'coming_to_apartment')) {
    return true;
  }

  let heldItem = state.playerHolding;
  let chargerUsed = false;
  for (const action of brief.orderedActions) {
    const operation = LOW_RISK_OPERATIONS.get(action.operation);
    if (operation === 'pick_up') heldItem = action.targetIds[0] ?? heldItem;
    if (operation === 'use_item' && action.targetIds[0] === 'phone_charger' && heldItem === 'phone_charger') {
      chargerUsed = true;
    }
  }
  if (state.phoneFunctional && !chargerUsed) {
    const perMinute = state.room.phone?.state.recording === true ? 3 : 1.5;
    return Math.round(state.phoneBattery - timePassed * perMinute) <= 0;
  }
  return false;
}

function buildActionPlan(brief: TurnBrief): ActionPlan {
  const actions = brief.orderedActions.map((action) => ({
    id: action.actionId,
    raw: action.originalSpan.text,
    intent: LOW_RISK_OPERATIONS.get(action.operation)!,
    target: canonicalActionTarget(action.targetIds),
    method: [action.scope, action.method].filter(Boolean).join(' / ') || undefined,
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low' as const,
    contactChannel: LOW_RISK_OPERATIONS.get(action.operation) === 'communicate' ? 'phone' as const : undefined,
    itemKind: LOW_RISK_OPERATIONS.get(action.operation) === 'pick_up' ? 'utility' as const : undefined,
  }));
  return {
    id: `plan.low-risk.${brief.turnId}`,
    raw: brief.orderedActions.map((action) => action.originalSpan.text).join(' then '),
    summary: actions.map((action) => `${action.intent}:${action.target}`).join(', '),
    actions,
    confidence: 1,
    warnings: [],
  };
}

function applyLowRiskAction(input: {
  state: GameState;
  action: TurnBrief['orderedActions'][number];
  operation: LowRiskOperation;
  eventId: string;
  causalParentIds: string[];
  envelope: TurnEnvelope;
}): AppliedLowRiskAction {
  const { state, action, operation } = input;
  let eventType = 'low_risk_action_confirmed';
  let subject = canonicalActionTarget(action.targetIds);
  let summary = 'The low-risk action was confirmed.';
  let facts: string[] = [`action_confirmed:${action.actionId}`];
  let status: ProposedEvent['status'] = 'completed';
  let ruleKind: RuleEvent['kind'] = 'action';

  if (operation === 'inspect') {
    for (const targetId of action.targetIds) {
      if (targetId !== 'room') state.room[targetId].inspected = true;
    }
    eventType = 'inspection_completed';
    summary = `Inspected ${subject} without changing concealed contents.`;
    facts = action.targetIds.flatMap((targetId) => [
      `inspected:${targetId}`,
      `fact.${targetId}.exterior.observed`,
      ...(targetId === 'package' ? ['fact.package.exterior.label_ambiguous'] : []),
    ]);
  } else if (operation === 'preserve_evidence') {
    if (!state.phoneFunctional) {
      eventType = 'photograph_failed';
      status = 'failed';
      summary = `Could not photograph ${subject} because the phone is unavailable.`;
      facts = ['photograph_failed:phone_unavailable'];
    } else {
      for (const targetId of action.targetIds) state.room[targetId].state.photographed = true;
      eventType = subject === 'package' ? 'package_photographed' : 'object_photographed';
      summary = `Photographed the visible exterior of ${subject}.`;
      facts = action.targetIds.flatMap((targetId) => [
        `photographed:${targetId}`,
        `fact.${targetId}.exterior.photo_captured`,
      ]);
    }
  } else if (operation === 'communicate') {
    ruleKind = 'message';
    if (state.phoneFunctional) {
      eventType = 'message_delivered';
      summary = `Delivered a message to ${subject}.`;
      facts = [`message_delivered:${subject}`];
    } else {
      eventType = 'message_delivery_failed';
      status = 'failed';
      summary = `The message to ${subject} was not delivered because the phone is unavailable.`;
      facts = [`message_delivery_failed:${subject}`];
    }
  } else if (operation === 'secure_entry') {
    const barricaded = action.targetIds.some((targetId) => ['chair', 'luggage', 'suitcase'].includes(targetId));
    state.room.front_door.state.locked = true;
    state.room.front_door.state.chainLocked = true;
    state.room.front_door.state.barricaded = barricaded || state.room.front_door.state.barricaded === true;
    if (state.room.chair?.state) {
      state.room.chair.state.movedToDoor = action.targetIds.includes('chair') || state.room.chair.state.movedToDoor === true;
    }
    eventType = 'front_door_secured';
    subject = 'front_door';
    summary = barricaded ? 'Locked, chained, and barricaded the front door.' : 'Locked and chained the front door.';
    facts = ['front_door:locked', 'front_door:chain_locked', ...(barricaded ? ['front_door:barricaded'] : [])];
  } else if (operation === 'pick_up') {
    const itemId = action.targetIds[0];
    state.playerHolding = itemId;
    eventType = 'item_picked_up';
    subject = itemId;
    summary = `Picked up ${itemId}.`;
    facts = [`item_picked_up:${itemId}`];
  } else if (operation === 'use_item') {
    const itemId = action.targetIds[0];
    subject = itemId;
    if (state.playerHolding !== itemId) {
      eventType = 'item_use_failed';
      status = 'failed';
      summary = `Could not use ${itemId} because it is not being held.`;
      facts = [`item_use_failed:not_held:${itemId}`];
    } else if (itemId === 'phone_charger') {
      state.phoneBattery = Math.min(100, state.phoneBattery + 30);
      state.phoneFunctional = state.phoneBattery > 0;
      state.room.phone_charger.state.pluggedIn = true;
      eventType = 'item_used';
      summary = 'Connected the phone charger.';
      facts = ['phone_charger:plugged_in'];
    } else {
      state.room.front_door.state.barricaded = true;
      eventType = 'item_used';
      summary = 'Used tape to reinforce the front door.';
      facts = ['front_door:tape_reinforced'];
    }
  } else {
    eventType = 'player_waited';
    subject = 'player';
    summary = 'Waited and observed the room.';
    facts = ['player:waited'];
  }

  return makeAppliedEvent({
    eventId: input.eventId,
    eventType,
    kind: operation === 'communicate' ? 'information_transfer' : 'action',
    actorId: 'player',
    operation,
    targetIds: action.targetIds.length > 0 ? action.targetIds : [subject],
    status,
    subject,
    summary,
    facts,
    causalParentIds: input.causalParentIds,
    envelope: input.envelope,
    createdAt: { run: state.run, minute: state.minute },
    ruleKind,
  });
}

function createTimeEvent(
  envelope: TurnEnvelope,
  run: number,
  before: number,
  after: number,
  causalParentId?: string,
): AppliedLowRiskAction {
  return makeAppliedEvent({
    eventId: `event.low-risk.${envelope.turnId}.time`,
    eventType: 'time_advanced',
    kind: 'timer',
    actorId: 'system',
    operation: 'advance_time',
    targetIds: ['clock'],
    status: 'completed',
    subject: 'clock',
    summary: `Time advanced by ${after - before} minute(s).`,
    facts: [`minute:${after}`, `minutes_elapsed:${after - before}`],
    causalParentIds: causalParentId ? [causalParentId] : [],
    envelope,
    createdAt: { run, minute: after },
    ruleKind: 'state_change',
  });
}

function createBatteryEvent(
  envelope: TurnEnvelope,
  run: number,
  minute: number,
  before: number,
  after: number,
  causalParentId: string,
): AppliedLowRiskAction {
  return makeAppliedEvent({
    eventId: `event.low-risk.${envelope.turnId}.battery`,
    eventType: 'phone_battery_changed',
    kind: 'state_transition',
    actorId: 'system',
    operation: 'change_battery',
    targetIds: ['phone'],
    status: 'completed',
    subject: 'phone',
    summary: `Phone battery changed from ${before} to ${after}.`,
    facts: [`phone_battery:${after}`],
    causalParentIds: [causalParentId],
    envelope,
    createdAt: { run, minute },
    ruleKind: 'state_change',
  });
}

function makeAppliedEvent(input: {
  eventId: string;
  eventType: string;
  kind: ProposedEvent['kind'];
  actorId: string;
  operation: string;
  targetIds: string[];
  status: ProposedEvent['status'];
  subject: string;
  summary: string;
  facts: string[];
  causalParentIds: string[];
  envelope: TurnEnvelope;
  createdAt: { run: number; minute: number };
  ruleKind: RuleEvent['kind'];
}): AppliedLowRiskAction {
  return {
    proposedEvent: {
      id: input.eventId,
      kind: input.kind,
      actorId: input.actorId,
      operation: input.operation,
      targetIds: input.targetIds,
      status: input.status,
      summary: input.summary,
      assertions: assertionsFromLegacyFacts(
        input.eventId,
        input.subject,
        input.facts,
        ['player'],
      ),
      visibility: ['player'],
      riskClass: 'reversible',
      evidenceRefs: [],
      causalParentIds: input.causalParentIds,
    },
    domainEvent: {
      id: `domain.${input.eventId}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: input.createdAt,
      causationId: input.causalParentIds.at(-1),
      correlationId: input.envelope.turnId,
      eventType: input.eventType,
      authority: 'game',
      subject: input.subject,
      summary: input.summary,
      facts: input.facts,
      visibility: 'player',
      payload: { turnId: input.envelope.turnId },
    },
    ruleEvent: {
      kind: input.ruleKind,
      subject: input.subject,
      summary: input.summary,
      sensoryHints: [],
      visibility: 'player',
    },
    summary: input.summary,
  };
}

function assertionsFromLegacyFacts(
  eventId: string,
  defaultSubject: string,
  facts: string[],
  visibleTo: string[],
): ProposedEvent['assertions'] {
  return facts.map((fact, index) => {
    if (fact.startsWith('fact.')) {
      const [subject = defaultSubject, ...predicateParts] = fact.slice('fact.'.length).split('.');
      return {
        id: `assertion.${eventId}.${index}`,
        subject,
        predicate: predicateParts.join('.') || 'confirmed',
        value: true,
        visibleTo: [...visibleTo],
      };
    }
    const separator = fact.indexOf(':');
    const predicate = separator >= 0 ? fact.slice(0, separator) : fact;
    const rawValue = separator >= 0 ? fact.slice(separator + 1) : true;
    const numericValue = typeof rawValue === 'string' && rawValue.trim() !== ''
      ? Number(rawValue)
      : Number.NaN;
    return {
      id: `assertion.${eventId}.${index}`,
      subject: defaultSubject,
      predicate,
      value: Number.isFinite(numericValue) ? numericValue : rawValue,
      visibleTo: [...visibleTo],
    };
  });
}

function canonicalActionTarget(targetIds: string[]): string {
  const target = targetIds[0] ?? 'room';
  return target === 'lin_yue' ? 'linyue' : target;
}

function envelopeFromBrief(brief: TurnBrief): TurnEnvelope {
  return {
    loopId: brief.loopId,
    turnId: brief.turnId,
    inputStateVersion: brief.inputStateVersion,
    deadlineAt: brief.deadlineAt,
  };
}
