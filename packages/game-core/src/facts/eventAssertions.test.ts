import assert from 'node:assert/strict';
import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';
import {
  assertionValue,
  canonicalFactIdForAssertion,
  materializeEventFacts,
} from './eventAssertions';

const event: ProposedEvent = {
  id: 'event.turn-1.photo',
  kind: 'action',
  actorId: 'player',
  operation: 'photograph',
  targetIds: ['package'],
  status: 'completed',
  summary: 'The photograph was created.',
  assertions: [{
    id: 'result',
    subject: 'candidate.photo.turn-1',
    predicate: 'exists',
    value: true,
    visibleTo: ['player'],
  }],
  visibility: ['player'],
  riskClass: 'reversible',
  evidenceRefs: [],
  causalParentIds: [],
};

assert.equal(assertionValue(event, 'exists'), true);
assert.equal(
  canonicalFactIdForAssertion(event.id, 'result'),
  'fact:event.turn-1.photo:result',
);
assert.deepEqual(materializeEventFacts(event, 'turn-1'), [{
  id: 'fact:event.turn-1.photo:result',
  subject: 'candidate.photo.turn-1',
  predicate: 'exists',
  value: true,
  sourceEventId: event.id,
  visibleTo: ['player'],
  knownBy: ['player'],
  validFromTurn: 'turn-1',
  invalidatedBy: null,
}]);

const differentEvent = { ...event, id: 'event.turn-2.photo' };
assert.notEqual(
  canonicalFactIdForAssertion(event.id, 'result'),
  canonicalFactIdForAssertion(differentEvent.id, 'result'),
);
