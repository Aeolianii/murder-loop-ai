import assert from 'node:assert/strict';
import type { TurnBrief } from '@murder-loop-ai/ai-contracts';
import { DEADLINE_MINUTE } from '@murder-loop-ai/shared';
import { InMemoryAtomicTurnStore } from '../commit/atomicTurnCommit';
import { createInitialGameState } from '../state/createInitialState';
import {
  commitPreparedLowRiskTurn,
  prepareLowRiskTurn,
} from './lowRiskTakeover';

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
  sourceProposalId: 'proposal.player.selected',
});

assert.equal(prepared.status, 'prepared');
if (prepared.status !== 'prepared') throw new Error('expected a prepared low-risk turn');
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

const unsupportedAttack = prepareLowRiskTurn({
  state,
  brief: brief([action('attack', 'attack', ['chen_huaimin'])]),
  sourceProposalId: 'proposal.attack',
});
assert.equal(unsupportedAttack.status, 'not_eligible');
if (unsupportedAttack.status === 'not_eligible') assert.equal(unsupportedAttack.reason, 'unsupported_operation');

const interiorObservation = prepareLowRiskTurn({
  state,
  brief: brief([action('inspect-inside', 'inspect', ['package'], { scope: 'interior.contents' })]),
  sourceProposalId: 'proposal.interior',
});
assert.equal(interiorObservation.status, 'not_eligible');
if (interiorObservation.status === 'not_eligible') assert.equal(interiorObservation.reason, 'observation_scope_not_low_risk');

const inventedBarricade = prepareLowRiskTurn({
  state,
  brief: brief([action('invented-barricade', 'secure_entry', ['front_door', 'suitcase'])]),
  sourceProposalId: 'proposal.invented-barricade',
});
assert.equal(inventedBarricade.status, 'not_eligible');
if (inventedBarricade.status === 'not_eligible') assert.equal(inventedBarricade.reason, 'unsupported_target');

const ordinaryWait = prepareLowRiskTurn({
  state,
  brief: brief([action('wait-player', 'wait', ['player'])]),
  sourceProposalId: 'proposal.wait-player',
});
assert.equal(ordinaryWait.status, 'prepared');

const depletedBatteryState = structuredClone(state);
depletedBatteryState.phoneBattery = 1;
depletedBatteryState.room.phone.state.battery = 1;
const batteryDeathBoundary = prepareLowRiskTurn({
  state: depletedBatteryState,
  brief: brief([action('wait-low-battery', 'wait', ['player'])]),
  sourceProposalId: 'proposal.wait-low-battery',
});
assert.equal(batteryDeathBoundary.status, 'not_eligible');
if (batteryDeathBoundary.status === 'not_eligible') assert.equal(batteryDeathBoundary.reason, 'high_risk_boundary');

const deadlineState = structuredClone(state);
deadlineState.minute = DEADLINE_MINUTE - 1;
const deadlineBoundary = prepareLowRiskTurn({
  state: deadlineState,
  brief: brief([action('wait-at-deadline', 'wait', ['player'])]),
  sourceProposalId: 'proposal.wait-at-deadline',
});
assert.equal(deadlineBoundary.status, 'not_eligible');
if (deadlineBoundary.status === 'not_eligible') assert.equal(deadlineBoundary.reason, 'high_risk_boundary');

const phaseFiveDeadlinePreparation = prepareLowRiskTurn({
  state: deadlineState,
  brief: brief([action('wait-at-deadline', 'wait', ['player'])]),
  sourceProposalId: 'proposal.wait-at-deadline',
  allowHighRiskContinuation: true,
});
assert.equal(
  phaseFiveDeadlinePreparation.status,
  'prepared',
  'phase five must own the downstream deadline outcome instead of falling back to legacy rules',
);

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
assert(committed.outcome.confirmedEvents.some((event) => event.eventType === 'package_photographed'));
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
