import assert from 'node:assert/strict';
import type { KillerStrategy } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyKillerStrategy, applyKillerStrategyDomainEvent } from './applyKillerStrategy';
import { buildKillerStrategyIntent, confirmKillerStrategyIntent } from '../domain/killerStrategyDomain';

function spareKeyStrategy(): KillerStrategy {
  return {
    id: 'killer-spare-key-test',
    type: 'spare_key_entry',
    title: 'Spare key turns',
    rationale: 'Test spare key against door defenses.',
    visibleToPlayer: true,
    risk: 'high',
  };
}

function testSpareKeyAgainstChainLockDoesNotInventBarricade() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = false;

  const result = applyKillerStrategy(state, spareKeyStrategy());

  assert.equal(result.state.ending, null);
  assert.equal(result.simulationIntents[0].intentType, 'killer_plan_proposed');
  assert.equal(result.domainEvents[0].eventType, 'killer_strategy_applied');
  assert.equal(result.domainEvents[0].causationId, result.simulationIntents[0].id);
  assert.ok(result.domainEvents.some((event) => event.eventType === 'threat_changed'));
  assert.match(result.text, /反锁|门链|内侧/);
  assert.doesNotMatch(result.text, /椅子|行李箱|顶住|刮|门缝里漏进来/);
}

function testSpareKeyAgainstBarricadeMentionsPhysicalBlock() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = true;

  const result = applyKillerStrategy(state, spareKeyStrategy());

  assert.equal(result.state.ending, null);
  assert.match(result.text, /堵|顶|抵|椅子|行李箱|障碍/);
}

function testConfirmedDomainEventIsTheReducerInput() {
  const state = createInitialGameState();
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  const killerStrategy = spareKeyStrategy();
  const intent = buildKillerStrategyIntent(killerStrategy, { run: state.run, minute: state.minute });
  const confirmed = confirmKillerStrategyIntent(state, intent);

  const direct = applyKillerStrategyDomainEvent(state, confirmed);
  const wrapped = applyKillerStrategy(state, killerStrategy);

  assert.equal(direct.text, wrapped.text);
  assert.equal(direct.state.threat, wrapped.state.threat);
  assert.equal(state.threat, createInitialGameState().threat);
}

function testPhoneProbeUsesAgentGeneratedResponseHint() {
  const state = createInitialGameState();
  const strategy: KillerStrategy = {
    id: 'killer-phone-probe-test',
    type: 'phone_probe',
    title: 'Phone probe',
    rationale: 'Test generated message text.',
    responseHint: '陌生号码：“别装没看见，那个纸箱是不是在你屋里？”',
    visibleToPlayer: true,
    risk: 'medium',
  };

  const result = applyKillerStrategy(state, strategy);

  assert.equal(result.text, strategy.responseHint);
}

function testFramingPressureUsesAgentGeneratedResponseHint() {
  const state = createInitialGameState();
  const strategy: KillerStrategy = {
    id: 'killer-framing-pressure-test',
    type: 'framing_pressure',
    title: 'Pressure',
    rationale: 'Test generated pressure text.',
    responseHint: '陌生号码：“你不回复，我就当你已经拆开了。”',
    visibleToPlayer: true,
    risk: 'medium',
  };

  const result = applyKillerStrategy(state, strategy);

  assert.equal(result.text, strategy.responseHint);
}

function testFramingPressureFallbackDoesNotNameContraband() {
  const state = createInitialGameState();
  const strategy: KillerStrategy = {
    id: 'killer-framing-pressure-fallback-test',
    type: 'framing_pressure',
    title: 'Pressure',
    rationale: 'Test fallback pressure text.',
    visibleToPlayer: true,
    risk: 'medium',
  };

  const result = applyKillerStrategy(state, strategy);

  assert.doesNotMatch(result.text, /违禁品|毒品|走私|贩毒/);
  assert.match(result.text, /纸箱|包裹|门口|东西/);
}

testSpareKeyAgainstChainLockDoesNotInventBarricade();
testSpareKeyAgainstBarricadeMentionsPhysicalBlock();
testPhoneProbeUsesAgentGeneratedResponseHint();
testFramingPressureUsesAgentGeneratedResponseHint();
testFramingPressureFallbackDoesNotNameContraband();
testConfirmedDomainEventIsTheReducerInput();
