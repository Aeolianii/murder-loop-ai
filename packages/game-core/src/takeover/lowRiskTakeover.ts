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
  ['act', 'act'],
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

const PACKAGE_INTERIOR_SCOPE = /(interior|inside|contents?|open|内部|里面|内容|打开|拆开|翻开)/i;
const PACKAGE_CHILD_IDS = [
  'package_old_book',
  'package_medicine_blister',
  'package_numeric_note',
] as const;

type PackageChildId = typeof PACKAGE_CHILD_IDS[number];

type LowRiskOperation = 'inspect' | 'preserve_evidence' | 'communicate' | 'secure_entry' | 'pick_up' | 'use_item' | 'wait' | 'act';

export type LowRiskTakeoverRejectReason =
  | 'compiler_fallback'
  | 'clarification_required'
  | 'conditional_action_not_supported'
  | 'empty_turn'
  | 'unsupported_actor'
  | 'unsupported_operation'
  | 'unsupported_target'
  | 'ai_outcome_required'
  | 'observation_scope_not_low_risk'
  | 'high_risk_boundary';

export interface PreparedLowRiskPlayerResult extends RuleResult {
  domainEvents: DomainEvent[];
}

export interface PreparedLowRiskTurn {
  status: 'prepared';
  envelope: TurnEnvelope;
  executionAuthorityId: string;
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
  aiPlayerOutcomes?: ProposedEvent[];
  allowHighRiskContinuation?: boolean;
}): LowRiskTakeoverPreparation {
  const eligibility = validateTurnEligibility(
    input.state,
    input.brief,
    input.aiPlayerOutcomes ?? [],
  );
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
  const actionById = new Map(input.brief.orderedActions.map((action) => [action.actionId, action]));
  const packagePhotoHandleIds = new Set(input.brief.candidateHandles.flatMap((handle) => {
    const producer = actionById.get(handle.producedByActionId);
    return producer
      && LOW_RISK_OPERATIONS.get(producer.operation) === 'preserve_evidence'
      && producer.targetIds.includes('package')
      ? [handle.id]
      : [];
  }));
  const communicationByActionId = new Map(
    input.brief.communications.map((communication) => [communication.actionId, communication]),
  );
  let chargerUsed = false;

  for (const action of input.brief.orderedActions) {
    const operation = LOW_RISK_OPERATIONS.get(action.operation)!;
    const eventId = `event.low-risk.${input.brief.turnId}.${action.actionId}`;
    const causalParentIds = action.dependsOnActionIds
      .map((actionId) => eventIdByActionId.get(actionId))
      .filter((id): id is string => Boolean(id));
    const communication = communicationByActionId.get(action.actionId);
    const attachmentHandleIds = new Set([
      ...action.inputHandleIds,
      ...(communication?.attachmentHandleIds ?? []),
    ]);
    const applied = applyLowRiskAction({
      state,
      action,
      operation,
      communication,
      eventId,
      causalParentIds,
      envelope: input.brief,
      aiOutcome: aiOutcomeForAction(input.aiPlayerOutcomes ?? [], action),
      sharesPackagePhoto: state.room.package.state.photographed === true
        && [...attachmentHandleIds].some((handleId) => packagePhotoHandleIds.has(handleId)),
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
  const executionAuthorityId = deterministicTurnBriefAuthorityId(input.brief.turnId);
  state.log.push({
    id: `log-low-risk-${input.brief.turnId}`,
    run: state.run,
    minute: state.minute,
    title: '行动已确认',
    text,
    tone: 'neutral',
    channel: 'action',
  });

  return {
    status: 'prepared',
    envelope: envelopeFromBrief(input.brief),
    executionAuthorityId,
    plan,
    playerResult: {
      title: '行动已确认',
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
      // Atomic commit still uses the legacy sourceProposalId field for provenance.
      // A deterministic authority id prevents these events being attributed to an AI proposal.
      sourceProposalId: executionAuthorityId,
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

export function deterministicTurnBriefAuthorityId(turnId: string): string {
  return `deterministic.turn-brief-reducer.${turnId}`;
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

function validateTurnEligibility(
  state: GameState,
  brief: TurnBrief,
  aiPlayerOutcomes: ProposedEvent[],
): LowRiskTakeoverRejectReason | undefined {
  if (brief.compilerVersion.includes('fallback')) return 'compiler_fallback';
  if (!['command', 'question', 'mixed'].includes(brief.utteranceMode)) return 'clarification_required';
  if (brief.ambiguities.some((ambiguity) => ambiguity.requiresClarification)) return 'clarification_required';
  if ([...brief.globalConstraints, ...brief.scopedConstraints].some((constraint) => constraint.type === 'conditional')) {
    return 'conditional_action_not_supported';
  }
  if (brief.orderedActions.length === 0) return 'empty_turn';

  for (const action of brief.orderedActions) {
    if (action.actorId !== 'player') return 'unsupported_actor';
    const operation = LOW_RISK_OPERATIONS.get(action.operation);
    if (!operation) return 'unsupported_operation';

    if (operation === 'preserve_evidence'
      && action.targetIds.includes('package')
      && inspectsPackageInterior(action)) {
      return 'observation_scope_not_low_risk';
    }
    if (operation === 'inspect') {
      const targetIds = effectiveInspectTargetIds(action);
      if (targetIds.length === 0) return 'unsupported_target';
      const invalid = targetIds.some((targetId) => targetId !== 'room' && !state.room[targetId]?.visible);
      if (invalid) return 'unsupported_target';
    }
    if (operation === 'preserve_evidence') {
      if (action.targetIds.length === 0 || action.targetIds.some((targetId) => !state.room[targetId]?.visible)) {
        return 'unsupported_target';
      }
    }
    if (operation === 'communicate') {
      const communication = brief.communications.find((candidate) => (
        candidate.actionId === action.actionId
      ));
      if (communication?.situatedAudience) {
        const anchors = communication.situatedAudience.anchorEntityIds;
        if (
          action.targetIds.length !== anchors.length
          || anchors.some((anchorId) => (
            !action.targetIds.includes(anchorId)
            || (anchorId !== 'room' && anchorId !== 'player' && !state.room[anchorId]?.visible)
          ))
        ) return 'unsupported_target';
      } else if (communication) {
        if (
          action.targetIds.length !== communication.recipientIds.length
          || communication.recipientIds.some((recipientId) => !action.targetIds.includes(recipientId))
        ) return 'unsupported_target';
      } else if (action.targetIds.length !== 1) {
        return 'unsupported_target';
      }
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
    if (operation === 'act') {
      if (
        action.targetIds.length === 0
        || action.targetIds.some((targetId) => (
          !['room', 'player', 'self'].includes(targetId)
          && !state.room[targetId]?.visible
        ))
      ) {
        return 'unsupported_target';
      }
      if (!aiOutcomeForAction(aiPlayerOutcomes, action)) return 'ai_outcome_required';
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
  const communicationByActionId = new Map(
    brief.communications.map((communication) => [communication.actionId, communication]),
  );
  const actions = brief.orderedActions.map((action) => {
    const operation = LOW_RISK_OPERATIONS.get(action.operation)!;
    const targetIds = operation === 'inspect' ? effectiveInspectTargetIds(action) : action.targetIds;
    const communication = communicationByActionId.get(action.actionId);
    return {
      id: action.actionId,
      raw: action.originalSpan.text,
      intent: operation,
      target: canonicalActionTarget(targetIds),
      method: [action.scope, action.method].filter(Boolean).join(' / ') || undefined,
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low' as const,
      contactChannel: operation === 'communicate'
        ? communication?.situatedAudience ? 'doorstep' as const : 'phone' as const
        : undefined,
      itemKind: operation === 'pick_up' ? 'utility' as const : undefined,
    };
  });
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
  communication?: TurnBrief['communications'][number];
  eventId: string;
  causalParentIds: string[];
  envelope: TurnEnvelope;
  aiOutcome?: ProposedEvent;
  sharesPackagePhoto: boolean;
}): AppliedLowRiskAction {
  const { state, action, operation } = input;
  const targetIds = operation === 'inspect' ? effectiveInspectTargetIds(action) : action.targetIds;
  let eventType = 'low_risk_action_confirmed';
  let subject = canonicalActionTarget(targetIds);
  let summary = '行动已经确认。';
  let facts: string[] = [`action_confirmed:${action.actionId}`];
  let status: ProposedEvent['status'] = 'completed';
  let ruleKind: RuleEvent['kind'] = 'action';
  let eventKind: ProposedEvent['kind'] = 'action';

  if (operation === 'act') {
    const resourceFailure = genericResourceFailure(state, action);
    const aiOutcome = input.aiOutcome!;
    status = resourceFailure ? 'failed' : aiOutcome.status;
    eventType = status === 'completed' ? 'player_action_completed' : 'player_action_failed';
    summary = resourceFailure ?? aiOutcome.summary;
    facts = [
      `action_adjudicated:${action.actionId}`,
      `fact.player.open_action.${status === 'completed' ? 'valid' : 'invalid'}`,
    ];
  } else if (operation === 'inspect') {
    for (const targetId of targetIds) {
      if (targetId !== 'room') state.room[targetId].inspected = true;
    }
    const packageContentsRevealed = targetIds.includes('package')
      && inspectsPackageInterior(action);
    if (packageContentsRevealed) {
      state.room.package.state.opened = true;
      for (const childId of PACKAGE_CHILD_IDS) state.room[childId].visible = true;
      if (state.world?.objects.package) state.world.objects.package.flags.opened = true;
      if (state.evidencePhase === 'package_unnoticed' || state.evidencePhase === 'package_seen') {
        state.evidencePhase = 'package_opened';
      }
      eventType = 'package_opened';
      ruleKind = 'clue';
      summary = '你打开并检查了包裹。纸箱里有一本被掏空的旧书、一块只剩部分药片的药板和一张数字纸条；模糊的“5-03 / 503”收件标记说明它可能不是你的。获得线索：包裹里的异常物品。';
      facts = [
        'inspected:package',
        'fact.package.exterior.label_ambiguous',
        'fact.package.interior.opened',
        'fact.package.interior.contents_revealed',
        'fact.package.interior.old_book_visible',
        'fact.package.interior.medicine_blister_visible',
        'fact.package.interior.numeric_note_visible',
      ];
    } else {
      eventType = targetIds.some(isPackageChildId) ? 'package_item_inspected' : 'inspection_completed';
      const outcomes = targetIds.map((targetId) => inspectionOutcome(state, targetId));
      summary = outcomes.map((outcome) => outcome.summary).join(' ');
      facts = outcomes.flatMap((outcome) => outcome.facts);
    }
  } else if (operation === 'preserve_evidence') {
    if (!state.phoneFunctional) {
      eventType = 'photograph_failed';
      status = 'failed';
      summary = `手机当前无法使用，没能拍下${actionTargetLabel(subject)}。`;
      facts = ['photograph_failed:phone_unavailable'];
    } else {
      for (const targetId of action.targetIds) state.room[targetId].state.photographed = true;
      eventType = subject === 'package' ? 'package_photographed' : 'object_photographed';
      summary = `你拍下了${actionTargetLabel(subject)}当前可见的外观，照片已保存在手机中。`;
      facts = action.targetIds.flatMap((targetId) => [
        `photographed:${targetId}`,
        `fact.${targetId}.exterior.photo_captured`,
      ]);
    }
  } else if (operation === 'communicate') {
    ruleKind = 'message';
    if (input.communication?.situatedAudience) {
      const audience = input.communication.situatedAudience;
      const anchorLabel = audience.anchorEntityIds.map(actionTargetLabel).join('、');
      eventType = 'communication_emitted';
      subject = canonicalActionTarget(audience.anchorEntityIds);
      summary = `你朝着${anchorLabel}附近开口说道：“${input.communication.contentSummary}”`;
      facts = [
        `communication_emitted:${input.communication.channel}`,
        ...audience.anchorEntityIds.map((anchorId) => `communication_anchor:${anchorId}`),
      ];
    } else if (state.phoneFunctional) {
      eventKind = 'information_transfer';
      eventType = 'message_delivered';
      summary = input.sharesPackagePhoto
        ? `你已将包裹照片和消息发送给${actionTargetLabel(subject)}。`
        : `你已将消息发送给${actionTargetLabel(subject)}。`;
      facts = [
        `message_delivered:${subject}`,
        ...(input.sharesPackagePhoto && subject === 'linyue'
          ? ['fact.lin_yue.package_photo_received']
          : []),
      ];
    } else {
      eventKind = 'information_transfer';
      eventType = 'message_delivery_failed';
      status = 'failed';
      summary = `手机当前无法使用，发给${actionTargetLabel(subject)}的消息未能送达。`;
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
    summary = barricaded ? '你锁好门锁、扣上门链，并用椅子抵住了入户门。' : '你锁好门锁并扣上了入户门的门链。';
    facts = ['front_door:locked', 'front_door:chain_locked', ...(barricaded ? ['front_door:barricaded'] : [])];
  } else if (operation === 'pick_up') {
    const itemId = action.targetIds[0];
    state.playerHolding = itemId;
    eventType = 'item_picked_up';
    subject = itemId;
    summary = `你拿起了${actionTargetLabel(itemId)}。`;
    facts = [`item_picked_up:${itemId}`];
  } else if (operation === 'use_item') {
    const itemId = action.targetIds[0];
    subject = itemId;
    if (state.playerHolding !== itemId) {
      eventType = 'item_use_failed';
      status = 'failed';
      summary = `你没有拿着${actionTargetLabel(itemId)}，因此无法使用它。`;
      facts = [`item_use_failed:not_held:${itemId}`];
    } else if (itemId === 'phone_charger') {
      state.phoneBattery = Math.min(100, state.phoneBattery + 30);
      state.phoneFunctional = state.phoneBattery > 0;
      state.room.phone_charger.state.pluggedIn = true;
      eventType = 'item_used';
      summary = '你接上了手机充电器，手机开始充电。';
      facts = ['phone_charger:plugged_in'];
    } else {
      state.room.front_door.state.barricaded = true;
      eventType = 'item_used';
      summary = '你用胶带进一步加固了入户门。';
      facts = ['front_door:tape_reinforced'];
    }
  } else {
    eventType = 'player_waited';
    subject = 'player';
    summary = '你保持安静并观察房间，暂时没有发现新的异常。';
    facts = ['player:waited'];
  }

  return makeAppliedEvent({
    eventId: input.eventId,
    eventType,
    kind: eventKind,
    sourceActionIds: [action.actionId],
    actorId: 'player',
    operation,
    targetIds: targetIds.length > 0 ? targetIds : [subject],
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

function inspectionOutcome(
  state: GameState,
  targetId: string,
): { summary: string; facts: string[] } {
  const baseFacts = [`inspected:${targetId}`];
  if (targetId === 'bed') {
    state.room.bed.state.checkedUnder = true;
    return {
      summary: '你俯身检查了床底，确认下面没有藏人，也没有发现可疑物品或新的线索。',
      facts: [...baseFacts, 'fact.bed.under.checked', 'fact.bed.under.no_anomaly'],
    };
  }
  if (targetId === 'closet') {
    state.room.closet.state.checked = true;
    return {
      summary: '你逐层检查了衣柜，确认里面没有藏人，也没有发现可疑物品或新的线索。',
      facts: [...baseFacts, 'fact.closet.interior.checked', 'fact.closet.interior.no_anomaly'],
    };
  }
  if (targetId === 'bathroom') {
    state.room.bathroom.state.waterTankChecked = true;
    return {
      summary: '你检查了卫生间和水箱，里面没有藏人，也没有发现可疑物品或新的线索。',
      facts: [...baseFacts, 'fact.bathroom.water_tank.checked', 'fact.bathroom.water_tank.no_anomaly'],
    };
  }
  if (targetId === 'window') {
    state.room.window.state.checked = true;
    const locked = state.room.window.state.locked === true;
    return {
      summary: `你检查了窗户，确认窗锁${locked ? '已经扣好' : '没有扣上'}；窗边没有发现其他异常或新的线索。`,
      facts: [
        ...baseFacts,
        'fact.window.lock.checked',
        `fact.window.lock.${locked ? 'locked' : 'unlocked'}`,
        'fact.window.no_new_clue',
      ],
    };
  }
  if (targetId === 'front_door') {
    const locked = state.room.front_door.state.locked === true;
    const chained = state.room.front_door.state.chainLocked === true;
    return {
      summary: `你检查了入户门，门锁${locked ? '已经锁好' : '尚未反锁'}，门链${chained ? '已经扣上' : '还没有扣上'}；门边没有发现新的异常。`,
      facts: [
        ...baseFacts,
        'fact.front_door.lock.checked',
        `fact.front_door.lock.${locked ? 'locked' : 'unlocked'}`,
        `fact.front_door.chain.${chained ? 'secured' : 'open'}`,
        'fact.front_door.no_new_clue',
      ],
    };
  }
  if (targetId === 'package') {
    return {
      summary: '你检查了包裹外观，收件标记模糊不清；包裹仍保持封闭，内部物品尚未确认。',
      facts: [...baseFacts, 'fact.package.exterior.observed', 'fact.package.exterior.label_ambiguous'],
    };
  }
  if (targetId === 'package_old_book') {
    state.room.package_old_book.state.detailsChecked = true;
    return {
      summary: '你逐页翻看那本被掏空的旧书。书页中部形成一个空夹层，里面没有遗留其他物品，封面和书页上也没有发现新的标记。',
      facts: [
        ...baseFacts,
        'fact.package_old_book.details.checked',
        'fact.package_old_book.compartment.hollow',
        'fact.package_old_book.compartment.empty',
        'fact.package_old_book.no_new_clue',
      ],
    };
  }
  if (targetId === 'package_medicine_blister') {
    state.room.package_medicine_blister.state.detailsChecked = true;
    return {
      summary: '你拿起药板仔细检查。铝箔有撕开的痕迹，剩余药片上没有可辨认的品牌或药名；除此之外，没有发现新的编号或异常。',
      facts: [
        ...baseFacts,
        'fact.package_medicine_blister.details.checked',
        'fact.package_medicine_blister.foil.opened',
        'fact.package_medicine_blister.label.unreadable',
        'fact.package_medicine_blister.no_new_clue',
      ],
    };
  }
  if (targetId === 'package_numeric_note') {
    state.room.package_numeric_note.state.detailsChecked = true;
    return {
      summary: '你摊开数字纸条逐行检查。上面只有一串排列整齐的数字，没有发现姓名、地址或可直接识别的联系方式；目前无法确认它的含义，也没有获得新的线索。',
      facts: [
        ...baseFacts,
        'fact.package_numeric_note.details.checked',
        'fact.package_numeric_note.sequence.numeric',
        'fact.package_numeric_note.identifying_text.absent',
        'fact.package_numeric_note.meaning.unknown',
        'fact.package_numeric_note.no_new_clue',
      ],
    };
  }
  return {
    summary: `你检查了${actionTargetLabel(targetId)}，暂时没有发现异常或新的线索。`,
    facts: [...baseFacts, `fact.${targetId}.observed`, `fact.${targetId}.no_anomaly`],
  };
}

function inspectsPackageInterior(action: TurnBrief['orderedActions'][number]): boolean {
  return PACKAGE_INTERIOR_SCOPE.test([
    action.scope,
    action.method,
    action.originalSpan.text,
  ].filter(Boolean).join(' '));
}

function aiOutcomeForAction(
  outcomes: ProposedEvent[],
  action: TurnBrief['orderedActions'][number],
): ProposedEvent | undefined {
  return outcomes.find((outcome) => (
    outcome.actorId === 'player'
    && outcome.operation === 'act'
    && outcome.status !== 'attempted'
    && outcome.sourceActionIds.includes(action.actionId)
    && action.targetIds.every((targetId) => outcome.targetIds.includes(targetId))
    && (outcome.visibility.includes('player') || outcome.visibility.includes('public'))
    && isChineseDisplayText(outcome.summary)
  ));
}

function genericResourceFailure(
  state: GameState,
  action: TurnBrief['orderedActions'][number],
): string | undefined {
  if (!action.targetIds.includes('phone')) return undefined;
  if (state.phoneBattery <= 0) {
    return '手机已经没电，屏幕无法亮起，因此无法完成这个动作。';
  }
  return undefined;
}

function isChineseDisplayText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text) && !/[A-Za-z]/.test(text);
}

function isPackageChildId(targetId: string): targetId is PackageChildId {
  return (PACKAGE_CHILD_IDS as readonly string[]).includes(targetId);
}

function packageChildTarget(action: TurnBrief['orderedActions'][number]): PackageChildId | undefined {
  const explicitTarget = action.targetIds.find(isPackageChildId);
  if (explicitTarget) return explicitTarget;

  const text = [action.originalSpan.text, action.scope, action.method]
    .filter(Boolean)
    .join(' ');
  if (/旧书|掏空的书|old\s*book/i.test(text)) return 'package_old_book';
  if (/药板|药盒|药片|blister|medicine/i.test(text)) return 'package_medicine_blister';
  if (/数字纸条|数字.*纸|纸条|number(?:ed|ic)?\s*note/i.test(text)) return 'package_numeric_note';
  return undefined;
}

function effectiveInspectTargetIds(action: TurnBrief['orderedActions'][number]): string[] {
  const packageChild = packageChildTarget(action);
  return packageChild ? [packageChild] : action.targetIds;
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
    summary: `时间向前推进了${after - before}分钟。`,
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
    summary: `手机电量从${before}变为${after}。`,
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
  sourceActionIds?: string[];
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
      sourceActionIds: input.sourceActionIds ?? [],
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

function actionTargetLabel(targetId: string): string {
  const labels: Record<string, string> = {
    package: '包裹',
    package_old_book: '包裹里的旧书',
    package_medicine_blister: '包裹里的药板',
    package_numeric_note: '包裹里的数字纸条',
    front_door: '入户门',
    window: '窗户',
    room: '房间',
    player: '自己',
    self: '自己',
    bed: '床底',
    closet: '衣柜',
    bathroom: '卫生间',
    phone: '手机',
    phone_charger: '手机充电器',
    chair: '椅子',
    tape: '胶带',
    flashlight: '手电筒',
    hanger: '衣架',
    mirror: '镜子',
    newspaper: '旧报纸',
    belt: '皮带',
    screwdriver: '螺丝刀',
    lighter: '打火机',
    bleach: '清洁剂',
    pen_paper: '纸笔',
    linyue: '林越',
    lin_yue: '林越',
    police_dispatch: '警方接线员',
    chen_huaimin: '陈怀民',
  };
  return labels[targetId] ?? '当前目标';
}

function envelopeFromBrief(brief: TurnBrief): TurnEnvelope {
  return {
    loopId: brief.loopId,
    turnId: brief.turnId,
    inputStateVersion: brief.inputStateVersion,
    deadlineAt: brief.deadlineAt,
  };
}
