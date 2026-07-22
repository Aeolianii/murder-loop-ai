import assert from 'node:assert/strict';
import type { ProposedEvent, TurnBrief } from '@murder-loop-ai/ai-contracts';
import { DEADLINE_MINUTE } from '@murder-loop-ai/shared';
import { InMemoryAtomicTurnStore } from '../commit/atomicTurnCommit';
import { createInitialGameState } from '../state/createInitialState';
import {
  commitPreparedLowRiskTurn,
  prepareLowRiskTurn,
} from './lowRiskTakeover';
import { projectConfirmedKnowledgeAndClues } from './knowledgeClueTakeover';

const deadlineAt = new Date(Date.now() + 10_000).toISOString();

function brief(actions: TurnBrief['orderedActions']): TurnBrief {
  return {
    loopId: 'legacy-run-1',
    turnId: 'takeover-turn-1',
    inputStateVersion: 1,
    deadlineAt,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: actions,
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

function action(
  actionId: string,
  operation: string,
  targetIds: string[],
  options: { scope?: string; method?: string } = {},
): TurnBrief['orderedActions'][number] {
  return {
    actionId,
    actorId: 'player',
    operation,
    targetIds,
    scope: options.scope,
    method: options.method,
    dependsOnActionIds: [],
    inputHandleIds: [],
    outputHandleIds: [],
    originalSpan: { start: 0, end: operation.length, text: `${operation} ${targetIds.join(' ')}` },
  };
}

const state = createInitialGameState();
const before = structuredClone(state);
const prepared = prepareLowRiskTurn({
  state,
  brief: brief([
    action('inspect-package', 'inspect', ['package'], { scope: 'exterior.label' }),
    action('photo-package', 'photograph', ['package'], { scope: 'exterior.label' }),
    action('secure-door', 'secure_entry', ['front_door', 'chair']),
    action('message-linyue', 'communicate', ['lin_yue']),
    action('pick-charger', 'pick_up', ['phone_charger']),
  ]),
});

assert.equal(prepared.status, 'prepared');
if (prepared.status !== 'prepared') throw new Error('expected a prepared low-risk turn');
assert.equal(
  prepared.executionAuthorityId,
  'deterministic.turn-brief-reducer.takeover-turn-1',
);
assert.equal(prepared.playerResult.state.room.package.inspected, true);
assert.equal(prepared.playerResult.state.room.package.state.opened, false, 'exterior observation cannot open package');
assert.equal(prepared.playerResult.state.room.package.state.photographed, true);
assert.equal(prepared.playerResult.state.room.front_door.state.locked, true);
assert.equal(prepared.playerResult.state.room.front_door.state.chainLocked, true);
assert.equal(prepared.playerResult.state.room.front_door.state.barricaded, true);
assert.equal(prepared.playerResult.state.room.chair.state.movedToDoor, true);
assert.equal(prepared.playerResult.state.playerHolding, 'phone_charger');
assert.equal(prepared.playerResult.state.minute, before.minute + 5);
assert(prepared.playerResult.state.phoneBattery < before.phoneBattery);
assert.equal(prepared.playerResult.state.room.phone.state.battery, prepared.playerResult.state.phoneBattery);
assert.deepEqual(prepared.playerResult.state.clues, before.clues, 'phase 3 cannot write clues');
assert.deepEqual(prepared.playerResult.state.killerKnowledge, before.killerKnowledge, 'phase 3 cannot write Killer Knowledge');
assert.equal(prepared.playerResult.state.linYuePhase, before.linYuePhase, 'phase 3 communication cannot write NPC state');
assert(prepared.playerResult.domainEvents.some((event) => event.eventType === 'message_delivered'));
assert.equal(prepared.playerResult.domainEvents[0].createdAt.run, before.run);
assert.equal(prepared.playerResult.domainEvents[0].createdAt.minute, before.minute);
assert(prepared.eventCandidates.every(({ event }) => event.riskClass === 'reversible'));
assert.equal(JSON.stringify(state), JSON.stringify(before), 'preparation must not mutate input state');

const photoShareBrief = brief([
  {
    ...action('photo-package-share', 'photograph', ['package']),
    outputHandleIds: ['handle-package-photo'],
  },
  {
    ...action('message-linyue-photo', 'communicate', ['lin_yue']),
    dependsOnActionIds: ['photo-package-share'],
    inputHandleIds: ['handle-package-photo'],
  },
]);
photoShareBrief.communications = [{
  id: 'communication-package-photo',
  actionId: 'message-linyue-photo',
  senderId: 'player',
  recipientIds: ['lin_yue'],
  channel: 'phone',
  contentSummary: '询问这个包裹是不是林越的',
  attachmentHandleIds: ['handle-package-photo'],
  intendedAudience: ['lin_yue'],
}];
photoShareBrief.candidateHandles = [{
  id: 'handle-package-photo',
  kind: 'photograph',
  producedByActionId: 'photo-package-share',
  dependsOnActionIds: ['photo-package-share'],
}];

const preparedPhotoShare = prepareLowRiskTurn({
  state,
  brief: photoShareBrief,
});
assert.equal(preparedPhotoShare.status, 'prepared');
if (preparedPhotoShare.status !== 'prepared') throw new Error('expected photo sharing to be prepared');
const deliveredPhotoEvent = preparedPhotoShare.playerResult.domainEvents.find((event) => (
  event.eventType === 'message_delivered'
));
assert(deliveredPhotoEvent?.facts.includes('fact.lin_yue.package_photo_received'));
assert(preparedPhotoShare.knowledgeClueCandidates.knowledgeUpdates.some((update) => (
  update.characterId === 'lin_yue' && update.factId === 'package_photo'
)));

const projectedPhotoShare = projectConfirmedKnowledgeAndClues({
  baselineState: state,
  candidateState: preparedPhotoShare.playerResult.state,
  eventCandidates: preparedPhotoShare.eventCandidates,
  candidates: preparedPhotoShare.knowledgeClueCandidates,
});
assert.equal(projectedPhotoShare.status, 'projected');
if (projectedPhotoShare.status !== 'projected') throw new Error('expected photo sharing knowledge projection');
assert.equal(projectedPhotoShare.state.linYuePhase, 'received_photo');
assert.equal(projectedPhotoShare.state.evidencePhase, 'evidence_shared');
assert.equal(projectedPhotoShare.state.world?.objects.package_photo.flags.sharedWithLinYue, true);
assert.equal(projectedPhotoShare.state.world?.knowledge.lin_yue.facts.package_photo.source, 'message');
assert(projectedPhotoShare.state.clues.some((clue) => clue.id === 'linyue_has_photo'));

const localQuestionBrief = brief([
  action('ask-through-door', 'communicate', ['front_door'], {
    method: 'speak loudly through the closed door',
  }),
]);
localQuestionBrief.utteranceMode = 'question';
localQuestionBrief.communications = [Object.assign({
  id: 'communication-through-door',
  actionId: 'ask-through-door',
  senderId: 'player',
  recipientIds: [],
  channel: 'local_voice',
  contentSummary: '询问门外是谁',
  attachmentHandleIds: [],
  intendedAudience: [],
}, {
  situatedAudience: {
    anchorEntityIds: ['front_door'],
    description: '门外能够听见玩家声音的任何人',
  },
})];
const noPhoneState = structuredClone(state);
noPhoneState.phoneFunctional = false;
noPhoneState.phoneBattery = 0;
const preparedLocalQuestion = prepareLowRiskTurn({
  state: noPhoneState,
  brief: localQuestionBrief,
});
assert.equal(
  preparedLocalQuestion.status,
  'prepared',
  'a question containing an executable communication action must enter the turn',
);
if (preparedLocalQuestion.status !== 'prepared') throw new Error('expected a prepared local question');
assert(
  preparedLocalQuestion.playerResult.domainEvents.some((event) => (
    event.eventType === 'communication_emitted'
  )),
  'local speech must be confirmed independently from phone availability',
);
assert(
  preparedLocalQuestion.eventCandidates.some(({ event }) => (
    event.operation === 'communicate' && event.status === 'completed'
  )),
  'the situated communication event must be commit-ready',
);
assert.doesNotMatch(preparedLocalQuestion.playerResult.text, /消息发送|手机当前无法使用/);
assert.doesNotMatch(
  preparedLocalQuestion.playerResult.text,
  /说道：“询问/,
  'a semantic content summary must not be presented as a verbatim player quote',
);

const unsupportedAttack = prepareLowRiskTurn({
  state,
  brief: brief([action('attack', 'attack', ['chen_huaimin'])]),
});
assert.equal(unsupportedAttack.status, 'not_eligible');
if (unsupportedAttack.status === 'not_eligible') assert.equal(unsupportedAttack.reason, 'unsupported_operation');

const packageContentsAction = action('inspect-inside', 'inspect', ['package']);
packageContentsAction.originalSpan = { start: 0, end: 6, text: '检查包裹内容' };
const interiorObservation = prepareLowRiskTurn({
  state,
  brief: brief([packageContentsAction]),
});
assert.equal(interiorObservation.status, 'prepared');
if (interiorObservation.status !== 'prepared') throw new Error('expected package contents inspection');
assert.equal(interiorObservation.playerResult.state.room.package.state.opened, true);
assert.equal(interiorObservation.playerResult.state.evidencePhase, 'package_opened');
assert.match(interiorObservation.playerResult.text, /旧书/);
assert.match(interiorObservation.playerResult.text, /药板/);
assert.match(interiorObservation.playerResult.text, /数字纸条/);
assert(
  interiorObservation.playerResult.domainEvents.some((event) => (
    event.eventType === 'package_opened'
    && event.facts.includes('fact.package.interior.contents_revealed')
  )),
);
assert.equal(interiorObservation.playerResult.state.room.package_old_book?.visible, true);
assert.equal(interiorObservation.playerResult.state.room.package_medicine_blister?.visible, true);
assert.equal(interiorObservation.playerResult.state.room.package_numeric_note?.visible, true);

const packageItemCases = [
  {
    raw: '检查旧书',
    target: 'package_old_book',
    expected: /掏空|夹层/,
    forbidden: /药板|数字纸条/,
  },
  {
    raw: '检查药板',
    target: 'package_medicine_blister',
    expected: /铝箔|药片/,
    forbidden: /旧书|数字纸条/,
  },
  {
    raw: '检查数字纸条',
    target: 'package_numeric_note',
    expected: /数字|含义/,
    forbidden: /旧书|药板/,
  },
] as const;

for (const packageItemCase of packageItemCases) {
  // The semantic compiler used to collapse all three phrases back to the package.
  // The reducer must recover the concrete visible child target from the original span.
  const itemAction = action('inspect-package-item', 'inspect', ['package'], { scope: 'interior.contents' });
  itemAction.originalSpan = { start: 0, end: packageItemCase.raw.length, text: packageItemCase.raw };
  const itemInspection = prepareLowRiskTurn({
    state: interiorObservation.playerResult.state,
    brief: brief([itemAction]),
  });
  assert.equal(itemInspection.status, 'prepared');
  if (itemInspection.status !== 'prepared') throw new Error('expected package item inspection');

  assert.equal(itemInspection.plan.actions[0]?.target, packageItemCase.target);
  assert.equal(itemInspection.playerResult.state.room[packageItemCase.target]?.inspected, true);
  assert.equal(itemInspection.playerResult.state.room[packageItemCase.target]?.state.detailsChecked, true);
  assert.match(itemInspection.playerResult.text, packageItemCase.expected);
  assert.doesNotMatch(itemInspection.playerResult.text, packageItemCase.forbidden);
  assert.doesNotMatch(itemInspection.playerResult.text, /打开并检查了包裹|包裹里的异常物品/);
  assert(itemInspection.playerResult.domainEvents.some((event) => (
    event.eventType === 'package_item_inspected'
    && event.subject === packageItemCase.target
    && event.facts.includes(`fact.${packageItemCase.target}.details.checked`)
    && event.facts.includes(`fact.${packageItemCase.target}.no_new_clue`)
  )));
  assert(!itemInspection.playerResult.domainEvents.some((event) => event.eventType === 'package_opened'));
}

const projectedInterior = projectConfirmedKnowledgeAndClues({
  baselineState: state,
  candidateState: interiorObservation.playerResult.state,
  eventCandidates: interiorObservation.eventCandidates,
  candidates: interiorObservation.knowledgeClueCandidates,
});
assert.equal(projectedInterior.status, 'projected');
if (projectedInterior.status !== 'projected') throw new Error('expected package contents projection');
assert(projectedInterior.state.clues.some((clue) => clue.id === 'package_contents'));
assert(projectedInterior.state.observations.some((observation) => (
  observation.subject === 'package' && observation.scope === 'interior.contents'
)));

const multiAreaInspection = prepareLowRiskTurn({
  state: createInitialGameState(),
  brief: brief([
    action('inspect-under-bed', 'inspect', ['bed'], { scope: 'under' }),
    action('inspect-closet', 'inspect', ['closet'], { scope: 'interior' }),
  ]),
});
assert.equal(multiAreaInspection.status, 'prepared');
if (multiAreaInspection.status !== 'prepared') throw new Error('expected multi-area inspection');
assert.equal(multiAreaInspection.playerResult.state.room.bed.state.checkedUnder, true);
assert.equal(multiAreaInspection.playerResult.state.room.closet.state.checked, true);
assert.match(multiAreaInspection.playerResult.text, /床底/);
assert.match(multiAreaInspection.playerResult.text, /衣柜/);
assert.match(multiAreaInspection.playerResult.text, /未发现|没有发现|无异常/);
assert.doesNotMatch(multiAreaInspection.playerResult.text, /[A-Za-z]/);
assert(multiAreaInspection.playerResult.domainEvents.some((event) => (
  event.subject === 'bed'
  && event.facts.includes('fact.bed.under.checked')
  && event.facts.includes('fact.bed.under.no_anomaly')
)));
assert(multiAreaInspection.playerResult.domainEvents.some((event) => (
  event.subject === 'closet'
  && event.facts.includes('fact.closet.interior.checked')
  && event.facts.includes('fact.closet.interior.no_anomaly')
)));

const inventedBarricade = prepareLowRiskTurn({
  state,
  brief: brief([action('invented-barricade', 'secure_entry', ['front_door', 'suitcase'])]),
});
assert.equal(inventedBarricade.status, 'not_eligible');
if (inventedBarricade.status === 'not_eligible') assert.equal(inventedBarricade.reason, 'unsupported_target');

const ordinaryWait = prepareLowRiskTurn({
  state,
  brief: brief([action('wait-player', 'wait', ['player'])]),
});
assert.equal(ordinaryWait.status, 'prepared');

function aiActionOutcome(
  actionId: string,
  status: ProposedEvent['status'],
  summary: string,
  riskClass: ProposedEvent['riskClass'] = 'reversible',
): ProposedEvent {
  return {
    id: `event.ai-action.${actionId}`,
    kind: 'action',
    sourceActionIds: [actionId],
    actorId: 'player',
    operation: 'act',
    targetIds: ['phone'],
    status,
    summary,
    assertions: [{
      id: `assertion.ai-action.${actionId}`,
      subject: 'player',
      predicate: status === 'completed' ? 'action_completed' : 'action_unavailable',
      value: true,
      visibleTo: ['player'],
    }],
    visibility: ['player'],
    riskClass,
    evidenceRefs: ['fact.player.phone_functional'],
    causalParentIds: [],
  };
}

const browseAction = action('browse-social-feed', 'act', ['phone'], { scope: 'social.feed' });
browseAction.originalSpan = { start: 0, end: 10, text: '打开手机浏览社区动态' };
const aiApprovedOpenAction = prepareLowRiskTurn({
  state: createInitialGameState(),
  brief: brief([browseAction]),
  aiPlayerOutcomes: [aiActionOutcome(
    browseAction.actionId,
    'completed',
    '你打开手机浏览了一会社区动态，几分钟过去了，没有看到与门外动静直接相关的新消息。',
  )],
});
assert.equal(aiApprovedOpenAction.status, 'prepared');
if (aiApprovedOpenAction.status !== 'prepared') throw new Error('expected AI-approved open action');
assert.equal(aiApprovedOpenAction.plan.actions[0]?.intent, 'act');
assert.match(aiApprovedOpenAction.playerResult.text, /浏览.*社区动态/);
assert(aiApprovedOpenAction.playerResult.domainEvents.some((event) => (
  event.eventType === 'player_action_completed'
  && event.subject === 'phone'
)));

const aiRejectedOpenAction = prepareLowRiskTurn({
  state: createInitialGameState(),
  brief: brief([browseAction]),
  aiPlayerOutcomes: [aiActionOutcome(
    browseAction.actionId,
    'failed',
    '你无法完成这个动作，因为当前场景中没有可用的网络连接。',
  )],
});
assert.equal(aiRejectedOpenAction.status, 'prepared');
if (aiRejectedOpenAction.status !== 'prepared') throw new Error('expected AI-rejected open action result');
assert.match(aiRejectedOpenAction.playerResult.text, /无法.*因为/);
assert.equal(aiRejectedOpenAction.eventCandidates[0]?.event.status, 'failed');

const aiRejectedHighRiskOpenAction = prepareLowRiskTurn({
  state: createInitialGameState(),
  brief: brief([browseAction]),
  aiPlayerOutcomes: [aiActionOutcome(
    browseAction.actionId,
    'failed',
    '你无法完成这个动作，因为所需物品并不存在。',
    'high_impact',
  )],
});
assert.equal(aiRejectedHighRiskOpenAction.status, 'prepared');
if (aiRejectedHighRiskOpenAction.status !== 'prepared') {
  throw new Error('expected high-risk-classified failed action to remain a resolved outcome');
}
assert.equal(aiRejectedHighRiskOpenAction.eventCandidates[0]?.event.status, 'failed');
assert.match(aiRejectedHighRiskOpenAction.playerResult.text, /无法.*不存在/);

const powerlessPhoneState = createInitialGameState();
powerlessPhoneState.phoneBattery = 0;
powerlessPhoneState.phoneFunctional = false;
powerlessPhoneState.room.phone.state.battery = 0;
const ruleCorrectedOpenAction = prepareLowRiskTurn({
  state: powerlessPhoneState,
  brief: brief([browseAction]),
  aiPlayerOutcomes: [aiActionOutcome(
    browseAction.actionId,
    'completed',
    '你成功打开手机并浏览了社区动态。',
  )],
});
assert.equal(ruleCorrectedOpenAction.status, 'prepared');
if (ruleCorrectedOpenAction.status !== 'prepared') throw new Error('expected resource-corrected open action');
assert.match(ruleCorrectedOpenAction.playerResult.text, /手机.*没电|手机.*无法使用/);
assert.doesNotMatch(ruleCorrectedOpenAction.playerResult.text, /成功打开/);
assert.equal(ruleCorrectedOpenAction.eventCandidates[0]?.event.status, 'failed');

const poweredPhoneState = createInitialGameState();
poweredPhoneState.phoneFunctional = false;
const aiOwnsNonPowerFeasibility = prepareLowRiskTurn({
  state: poweredPhoneState,
  brief: brief([browseAction]),
  aiPlayerOutcomes: [aiActionOutcome(
    browseAction.actionId,
    'completed',
    '你打开手机浏览了一会儿社区动态，没有发现新的异常。',
  )],
});
assert.equal(aiOwnsNonPowerFeasibility.status, 'prepared');
if (aiOwnsNonPowerFeasibility.status !== 'prepared') throw new Error('expected AI-owned feasibility result');
assert.equal(aiOwnsNonPowerFeasibility.eventCandidates[0]?.event.status, 'completed');
assert.match(aiOwnsNonPowerFeasibility.playerResult.text, /浏览.*社区动态/);

const missingAiOpenAction = prepareLowRiskTurn({
  state: createInitialGameState(),
  brief: brief([browseAction]),
});
assert.equal(missingAiOpenAction.status, 'not_eligible');
if (missingAiOpenAction.status === 'not_eligible') {
  assert.equal(missingAiOpenAction.reason, 'ai_outcome_required');
}

const depletedBatteryState = structuredClone(state);
depletedBatteryState.phoneBattery = 1;
depletedBatteryState.room.phone.state.battery = 1;
const batteryDeathBoundary = prepareLowRiskTurn({
  state: depletedBatteryState,
  brief: brief([action('wait-low-battery', 'wait', ['player'])]),
});
assert.equal(batteryDeathBoundary.status, 'not_eligible');
if (batteryDeathBoundary.status === 'not_eligible') assert.equal(batteryDeathBoundary.reason, 'high_risk_boundary');

const deadlineState = structuredClone(state);
deadlineState.minute = DEADLINE_MINUTE - 1;
const deadlineBoundary = prepareLowRiskTurn({
  state: deadlineState,
  brief: brief([action('wait-at-deadline', 'wait', ['player'])]),
});
assert.equal(deadlineBoundary.status, 'not_eligible');
if (deadlineBoundary.status === 'not_eligible') assert.equal(deadlineBoundary.reason, 'high_risk_boundary');

const phaseFiveDeadlinePreparation = prepareLowRiskTurn({
  state: deadlineState,
  brief: brief([action('wait-at-deadline', 'wait', ['player'])]),
  allowHighRiskContinuation: true,
});
assert.equal(
  phaseFiveDeadlinePreparation.status,
  'prepared',
  'phase five must own the downstream deadline outcome instead of falling back to legacy rules',
);
if (phaseFiveDeadlinePreparation.status === 'prepared') {
  assert.equal(
    phaseFiveDeadlinePreparation.playerResult.state.phase,
    'post_2347_escalation',
    'a confirmed turn reaching 23:47 must progress through the phase machine without regressing',
  );
}

const store = new InMemoryAtomicTurnStore({
  loopId: prepared.envelope.loopId,
  stateVersion: prepared.envelope.inputStateVersion,
  state,
});
const committed = await commitPreparedLowRiskTurn({
  prepared,
  finalState: { ...prepared.playerResult.state, threat: 37 },
  store,
  now: new Date(Date.now()),
});
assert.equal(committed.outcome.result.commitStatus, 'committed');
assert.equal(committed.state?.threat, 37, 'legacy high-risk stages may contribute state before the final atomic commit');
assert.equal(committed.state?.room.package.state.opened, false);
assert(committed.outcome.confirmedEvents.some((event) => (
  event.operation === 'preserve_evidence'
  && event.targetIds.includes('package')
  && event.status === 'completed'
)));
assert(committed.outcome.displayFragments.length > 0);

const conflictStore = new InMemoryAtomicTurnStore({
  loopId: prepared.envelope.loopId,
  stateVersion: prepared.envelope.inputStateVersion + 1,
  state,
});
const conflicted = await commitPreparedLowRiskTurn({
  prepared,
  finalState: prepared.playerResult.state,
  store: conflictStore,
  now: new Date(Date.now()),
});
assert.equal(conflicted.outcome.result.commitStatus, 'conflict');
assert.equal(conflicted.state, undefined);
assert.deepEqual(conflicted.outcome.confirmedEvents, []);
assert.deepEqual(conflicted.outcome.displayFragments, []);
assert.equal(conflictStore.snapshot().state.room.package.state.photographed, false);

const failingStore = new InMemoryAtomicTurnStore({
  loopId: prepared.envelope.loopId,
  stateVersion: prepared.envelope.inputStateVersion,
  state,
});
failingStore.failNextCommit();
const failed = await commitPreparedLowRiskTurn({
  prepared,
  finalState: prepared.playerResult.state,
  store: failingStore,
  now: new Date(Date.now()),
});
assert.equal(failed.outcome.result.commitStatus, 'failed');
assert.equal(failed.state, undefined);
assert.deepEqual(failed.outcome.confirmedEvents, []);
assert.deepEqual(failed.outcome.displayFragments, []);
