import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { chooseFallbackKillerStrategy } from './fallbackStrategy';
import { buildKillerContext } from '../context/ContextBuilder';
import { createInformantPoliceCallEvent } from '../world/knowledgeEvents';
import { applyEventEffects, createInitialWorldState } from '../world/worldSimulator';

function testPackagePhotoDoesNotForceFramingPressure() {
  const state = createInitialGameState();
  state.killerPhase = 'soft_pressure';
  state.threat = 35;
  state.clues.push({
    id: 'package_photo',
    title: 'Package photo',
    detail: 'The package label and contents were photographed.',
    source: 'player_discovered',
    weight: 8,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.notEqual(strategy.type, 'framing_pressure');
}

function testUnknownLinYueContactDoesNotForceLure() {
  const state = createInitialGameState();
  state.linYuePhase = 'received_photo';
  state.threat = 50;
  state.killerKnowledge.knowsPlayerContactedLinYue = false;

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.notEqual(strategy.type, 'lure_linyue');
}

function testUnknownPoliceCallDoesNotForcePoliceCounterplay() {
  const state = createInitialGameState();
  state.policePhase = 'real_police_en_route';
  state.threat = 70;
  state.killerKnowledge.knowsPoliceCalled = false;

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.notEqual(strategy.type, 'direct_confrontation');
  assert.notEqual(strategy.type, 'fake_callback');
  assert.notEqual(strategy.type, 'fake_police');
}

function testInformantPoliceKnowledgeCanTriggerPoliceCounterplay() {
  const state = createInitialGameState();
  state.policePhase = 'dispatch_pending';
  state.threat = 60;
  state.killerKnowledge.knowsPoliceCalled = false;
  const world = createInitialWorldState();
  const event = createInformantPoliceCallEvent(world);
  world.events.push(event);
  applyEventEffects(world, event);
  state.world = world;

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.equal(strategy.type, 'fake_callback');
}

function testInitialPhoneProbeIncludesConcreteMessageHint() {
  const state = createInitialGameState();
  state.killerPhase = 'confirming_package';
  state.threat = 30;

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.equal(strategy.type, 'phone_probe');
  assert.match(strategy.responseHint ?? '', /陌生号码/);
  assert.match(strategy.responseHint ?? '', /[“"][^”"]+[”"]/);
}

function testUnansweredStrangerMessageEscalatesToPressure() {
  const state = createInitialGameState();
  state.threat = 40;
  state.log.push({
    id: 'ambient-phone-probe',
    run: state.run,
    minute: state.minute,
    title: '陌生号码试探',
    text: '陌生号码：“门口那个包裹你拿进去了吗？”',
    tone: 'threat',
    channel: 'ambient',
  });
  state.log.push({
    id: 'action-lock-door',
    run: state.run,
    minute: state.minute + 1,
    title: '门已锁好',
    text: '门已锁好。你退后半步。',
    tone: 'neutral',
    channel: 'action',
  });

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.equal(strategy.type, 'framing_pressure');
  assert.match(strategy.responseHint ?? '', /陌生号码/);
  assert.doesNotMatch(strategy.responseHint ?? '', /门口那个包裹你拿进去了吗/);
  assert.doesNotMatch(strategy.responseHint ?? '', /违禁品|毒品|走私|贩毒/);
}

function testDoorRefusalCanEscalateToPressureWithoutUnansweredMessage() {
  const state = createInitialGameState();
  state.killerKnowledge.suspectsPlayerIsAlert = true;
  state.log.push({
    id: 'action-lock-door',
    run: state.run,
    minute: state.minute,
    title: '反锁门',
    text: '反锁门：门锁和门链从屋内扣上；没有搬动家具。',
    tone: 'neutral',
    channel: 'action',
  });

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.equal(strategy.type, 'framing_pressure');
  assert.match(strategy.responseHint ?? '', /纸箱|包裹|东西|门口/);
  assert.doesNotMatch(strategy.responseHint ?? '', /违禁品|毒品|走私|贩毒/);
}

function testIdentityVerificationCanEscalateToPressureWithoutUnansweredMessage() {
  const state = createInitialGameState();
  state.killerKnowledge.suspectsPlayerIsAlert = true;
  state.log.push({
    id: 'action-verify',
    run: state.run,
    minute: state.minute,
    title: '先核实身份',
    text: '核实身份：要求对方报单位和警号，并等待官方回拨。',
    tone: 'clue',
    channel: 'action',
  });

  const strategy = chooseFallbackKillerStrategy(buildKillerContext(state));

  assert.equal(strategy.type, 'framing_pressure');
  assert.doesNotMatch(strategy.responseHint ?? '', /违禁品|毒品|走私|贩毒/);
}

function testRepliedStrangerMessageDoesNotEscalateAsIgnored() {
  const state = createInitialGameState();
  state.threat = 40;
  state.log.push({
    id: 'ambient-phone-probe',
    run: state.run,
    minute: state.minute,
    title: '陌生号码试探',
    text: '陌生号码：“门口那个包裹你拿进去了吗？”',
    tone: 'threat',
    channel: 'ambient',
  });
  state.log.push({
    id: 'action-reply-chen',
    run: state.run,
    minute: state.minute + 1,
    title: '房东在试探',
    text: '联系陈怀民：你把“什么包裹？”发了出去。',
    tone: 'threat',
    channel: 'action',
  });

  const context = buildKillerContext(state);
  context.observableEvents.push({
    subject: 'player_messaged_chen',
    summary: 'Chen received a direct message from the player.',
    confidence: 'high',
    source: 'state_projection',
  });
  const strategy = chooseFallbackKillerStrategy(context);

  assert.equal(strategy.type, 'message_reply');
}

testPackagePhotoDoesNotForceFramingPressure();
testUnknownLinYueContactDoesNotForceLure();
testUnknownPoliceCallDoesNotForcePoliceCounterplay();
testInformantPoliceKnowledgeCanTriggerPoliceCounterplay();
testInitialPhoneProbeIncludesConcreteMessageHint();
testUnansweredStrangerMessageEscalatesToPressure();
testDoorRefusalCanEscalateToPressureWithoutUnansweredMessage();
testIdentityVerificationCanEscalateToPressureWithoutUnansweredMessage();
testRepliedStrangerMessageDoesNotEscalateAsIgnored();
