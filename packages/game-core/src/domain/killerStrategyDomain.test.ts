import assert from 'node:assert/strict';
import type { KillerStrategy } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  buildKillerOutcomeDomainEvents,
  buildKillerStrategyIntent,
  confirmKillerStrategyIntent,
  readKillerStrategyFromDomainEvent,
} from './killerStrategyDomain';
import { isAuthoritativeConcept } from './domainEvents';

function strategy(type = 'spare_key_entry'): KillerStrategy {
  return {
    id: `killer-${type}-domain-test`,
    type,
    title: 'Killer strategy test',
    rationale: 'Exercise the domain boundary.',
    visibleToPlayer: true,
    risk: 'high',
  };
}

function testStrategyIsIntentUntilRulesConfirmIt() {
  const state = createInitialGameState();
  const proposal = buildKillerStrategyIntent(strategy(), { run: state.run, minute: state.minute });

  assert.equal(proposal.kind, 'simulation_intent');
  assert.equal(proposal.requiresDomainReview, true);
  assert.equal(isAuthoritativeConcept(proposal), false);

  const confirmed = confirmKillerStrategyIntent(state, proposal);
  assert.equal(confirmed.eventType, 'killer_strategy_applied');
  assert.equal(confirmed.authority, 'game');
  assert.equal(confirmed.causationId, proposal.id);
  assert.equal(isAuthoritativeConcept(confirmed), true);
  assert.deepEqual(readKillerStrategyFromDomainEvent(confirmed), proposal.strategy);
}

function testOutcomeEventsDescribeThreatAndEndingChanges() {
  const before = createInitialGameState();
  const proposal = buildKillerStrategyIntent(strategy(), { run: before.run, minute: before.minute });
  const confirmed = confirmKillerStrategyIntent(before, proposal);
  const after = createInitialGameState();
  after.threat = before.threat + 10;
  after.ending = 'death';
  after.endingReason = 'forced_entry';

  const events = buildKillerOutcomeDomainEvents(confirmed, before, after);

  assert.deepEqual(events.map((event) => event.eventType), [
    'killer_strategy_applied',
    'threat_changed',
    'ending_reached',
  ]);
  assert.deepEqual(events[2].ending, { id: 'death', reason: 'forced_entry' });
}

function testInvalidEventCannotReachReducer() {
  const state = createInitialGameState();
  const proposal = buildKillerStrategyIntent(strategy(), { run: state.run, minute: state.minute });
  const confirmed = confirmKillerStrategyIntent(state, proposal);

  assert.throws(
    () => readKillerStrategyFromDomainEvent({ ...confirmed, authority: 'world' }),
    /authoritative killer_strategy_applied/,
  );
}

testStrategyIsIntentUntilRulesConfirmIt();
testOutcomeEventsDescribeThreatAndEndingChanges();
testInvalidEventCannotReachReducer();
