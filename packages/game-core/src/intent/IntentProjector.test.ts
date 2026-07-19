import assert from 'node:assert/strict';
import type { Fact, TurnBrief } from '@murder-loop-ai/ai-contracts';
import { FactLedger } from '../facts/FactLedger';
import { buildKnowledgeProjections } from '../facts/knowledgeProjection';
import { projectTurnIntent } from './IntentProjector';

const facts: Fact[] = [
  {
    id: 'fact.player.has_phone',
    subject: 'player',
    predicate: 'has_phone',
    value: true,
    sourceEventId: 'event.loop.started',
    visibleTo: ['player'],
    knownBy: ['player'],
    validFromTurn: 'turn-1',
    invalidatedBy: null,
  },
  {
    id: 'fact.killer.in_corridor',
    subject: 'killer',
    predicate: 'location',
    value: 'corridor_5f',
    sourceEventId: 'event.killer.moved',
    visibleTo: ['system'],
    knownBy: ['killer', 'system'],
    validFromTurn: 'turn-1',
    invalidatedBy: null,
  },
  {
    id: 'fact.weather.rain',
    subject: 'weather',
    predicate: 'rain',
    value: true,
    sourceEventId: 'event.environment.rain',
    visibleTo: ['public'],
    knownBy: ['system'],
    validFromTurn: 'turn-1',
    invalidatedBy: null,
  },
];

const brief: TurnBrief = {
  loopId: 'loop-1',
  turnId: 'turn-1',
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:01.000Z',
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: 'world-model-v1',
  utteranceMode: 'command',
  resolvedReferences: [],
  orderedActions: [{
    actionId: 'action-photo',
    actorId: 'player',
    operation: 'photograph',
    targetIds: ['package'],
    scope: 'exterior.label',
    dependsOnActionIds: [],
    inputHandleIds: [],
    outputHandleIds: ['candidate.photo.action-photo'],
    originalSpan: { start: 0, end: 7, text: '只拍外包装' },
  }],
  globalConstraints: [{
    id: 'constraint-no-open',
    type: 'must_not',
    actionIds: [],
    value: 'open_package',
    originalSpan: { start: 8, end: 13, text: '不要打开' },
  }],
  scopedConstraints: [],
  communications: [{
    id: 'communication-linyue',
    actionId: 'action-photo',
    senderId: 'player',
    recipientIds: ['lin_yue'],
    channel: 'phone',
    contentSummary: 'A package exterior photo is attached.',
    attachmentHandleIds: ['candidate.photo.action-photo'],
    intendedAudience: ['lin_yue'],
  }],
  candidateHandles: [{
    id: 'candidate.photo.action-photo',
    kind: 'photo',
    producedByActionId: 'action-photo',
    dependsOnActionIds: ['action-photo'],
  }],
  ambiguities: [],
};

const knowledge = buildKnowledgeProjections(new FactLedger(facts), ['lin_yue', 'police_dispatch']);
const projections = projectTurnIntent({
  brief,
  knowledge,
  canonicalConstraints: ['package_interior_requires_open_event'],
  conditionalSignals: [
    {
      id: 'signal-door-noise',
      domain: 'killer',
      visibleTo: ['killer'],
      prerequisiteEventIds: ['event.player.made_door_noise'],
      payload: { kind: 'audible_door_noise' },
    },
    {
      id: 'signal-exterior-observation',
      domain: 'clue',
      visibleTo: ['clue'],
      prerequisiteEventIds: ['observation.package.exterior'],
      payload: { observationScope: 'exterior' },
    },
    {
      id: 'signal-visible-recommendation',
      domain: 'recommendation',
      visibleTo: ['recommendation'],
      prerequisiteEventIds: ['event.photo.confirmed'],
      payload: { kind: 'photo_follow_up' },
    },
  ],
});

assert.equal(projections.mainWorldModel.turnBrief, brief);
assert.equal(projections.mainWorldModel.facts.length, facts.length);
assert.equal(projections.playerSpecialist.turnBrief, brief);
assert.deepEqual(projections.playerSpecialist.factIds, ['fact.player.has_phone', 'fact.weather.rain']);

const killerJson = JSON.stringify(projections.killerSpecialist);
assert.equal('turnBrief' in projections.killerSpecialist, false);
assert(!killerJson.includes('只拍外包装'));
assert(!killerJson.includes('不要打开'));
assert.deepEqual(projections.killerSpecialist.factIds.sort(), ['fact.killer.in_corridor', 'fact.weather.rain'].sort());
assert.deepEqual(projections.killerSpecialist.conditionalSignals.map((signal) => signal.id), ['signal-door-noise']);

assert.equal(projections.npcSpecialists.lin_yue.communications.length, 1);
assert.equal(
  projections.npcSpecialists.lin_yue.communications[0].prerequisiteEventId,
  'event.message_delivered.communication-linyue',
);
assert.equal(projections.npcSpecialists.police_dispatch.communications.length, 0);
assert(!JSON.stringify(projections.npcSpecialists.lin_yue).includes('不要打开'));

assert.deepEqual(projections.clueSpecialist.conditionalSignals.map((signal) => signal.id), ['signal-exterior-observation']);
assert.deepEqual(
  projections.recommendationSpecialist.conditionalSignals.map((signal) => signal.id),
  ['signal-visible-recommendation'],
);
