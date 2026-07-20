import assert from 'node:assert/strict';
import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';
import { canonicalFactIdForAssertion } from '../facts/eventAssertions';
import { createInitialGameState } from '../state/createInitialState';
import { createInitialWorldState } from '../world/worldSimulator';
import {
  projectConfirmedKnowledgeAndClues,
  type KnowledgeClueProjectionCandidates,
} from './knowledgeClueTakeover';

function event(
  id: string,
  eventType: string,
  subject: string,
  facts: string[],
): ProposedEvent {
  const failed = eventType.endsWith('_failed');
  return {
    id,
    kind: eventType.startsWith('message_') ? 'information_transfer' : 'action',
    sourceActionIds: ['action-1'],
    actorId: 'player',
    operation: eventType.startsWith('message_') ? 'communicate' : 'inspect',
    targetIds: [subject],
    status: failed ? 'failed' : 'completed',
    summary: `${eventType} for ${subject}`,
    assertions: facts.map((fact, index) => {
      if (fact.startsWith('fact.')) {
        const [assertionSubject = subject, ...predicateParts] = fact.slice(5).split('.');
        return {
          id: `assertion.${id}.${index}`,
          subject: assertionSubject,
          predicate: predicateParts.join('.'),
          value: true,
          visibleTo: ['player'],
        };
      }
      const separator = fact.indexOf(':');
      return {
        id: `assertion.${id}.${index}`,
        subject,
        predicate: fact.slice(0, separator),
        value: fact.slice(separator + 1),
        visibleTo: ['player'],
      };
    }),
    visibility: ['player'],
    riskClass: 'reversible',
    evidenceRefs: [],
    causalParentIds: [],
  };
}

const baseline = createInitialGameState();
baseline.world = createInitialWorldState();

const failedMessageState = structuredClone(baseline);
const failedMessage = event(
  'event.message.failed',
  'message_delivery_failed',
  'linyue',
  ['message_delivery_failed:linyue'],
);
const failedMessageProjection = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: failedMessageState,
  eventCandidates: [{ event: failedMessage, sourceProposalId: 'proposal.player' }],
  candidates: { observations: [], knowledgeUpdates: [], clues: [] },
});
assert.equal(failedMessageProjection.status, 'projected');
if (failedMessageProjection.status !== 'projected') throw new Error('expected failed message projection');
assert.deepEqual(
  failedMessageProjection.state.world?.knowledge,
  baseline.world.knowledge,
  'an undelivered message must produce zero Knowledge updates',
);

const deliveredMessage = event(
  'event.message.delivered',
  'message_delivered',
  'linyue',
  ['message_delivered:linyue'],
);
const deliveredCandidates: KnowledgeClueProjectionCandidates = {
  observations: [],
  knowledgeUpdates: [{
    characterId: 'lin_yue',
    factId: 'player_message_received',
    confidence: 1,
    source: 'message',
    sourceEventId: deliveredMessage.id,
    basedOnFactIds: [canonicalFactIdForAssertion(
      deliveredMessage.id,
      deliveredMessage.assertions[0].id,
    )],
  }],
  clues: [],
};
const deliveredProjection = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: structuredClone(baseline),
  eventCandidates: [{ event: deliveredMessage, sourceProposalId: 'proposal.player' }],
  candidates: deliveredCandidates,
});
assert.equal(deliveredProjection.status, 'projected');
if (deliveredProjection.status !== 'projected') throw new Error('expected delivered message projection');
assert.equal(
  deliveredProjection.state.world?.knowledge.lin_yue.facts.player_message_received.sourceEventId,
  deliveredMessage.id,
);

const inspection = event(
  'event.inspect.package',
  'inspection_completed',
  'package',
  ['inspected:package', 'fact.package.exterior.label_ambiguous'],
);
const labelAssertion = inspection.assertions.find((assertion) => (
  assertion.predicate === 'exterior.label_ambiguous'
))!;
const labelFactId = canonicalFactIdForAssertion(inspection.id, labelAssertion.id);
const legalClueCandidates: KnowledgeClueProjectionCandidates = {
  observations: [{
    id: 'observation.package.exterior',
    subject: 'package',
    predicate: 'exterior_label',
    value: 'ambiguous',
    scope: 'exterior.label',
    visibleFactIds: [labelFactId],
    sourceEventIds: [inspection.id],
    observedAt: { run: baseline.run, minute: baseline.minute },
  }],
  knowledgeUpdates: [{
    characterId: 'player',
    factId: 'package_exterior_label_ambiguous',
    confidence: 1,
    source: 'seen',
    sourceEventId: inspection.id,
    basedOnFactIds: [labelFactId],
  }],
  clues: [{
    id: 'wrong_package',
    claims: [labelFactId],
    basedOnObservationIds: ['observation.package.exterior'],
  }],
};
const candidateWithLegacyLeaks = structuredClone(baseline);
candidateWithLegacyLeaks.clues.push({
  id: 'narrator_invented_note',
  title: 'Narrator invented note',
  detail: 'This must not survive the phase-four projection.',
  source: 'ai_generated',
  weight: 99,
  discoveredAt: { run: baseline.run, minute: baseline.minute },
  isPersistent: true,
});
candidateWithLegacyLeaks.world!.knowledge.lin_yue.facts.unsourced_leak = {
  confidence: 1,
  source: 'inferred',
  minuteLearned: baseline.minute,
};

const legalProjection = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: candidateWithLegacyLeaks,
  eventCandidates: [{ event: inspection, sourceProposalId: 'proposal.player' }],
  candidates: legalClueCandidates,
});
assert.equal(legalProjection.status, 'projected');
if (legalProjection.status !== 'projected') throw new Error('expected legal clue projection');
assert.equal(legalProjection.state.clues.some((clue) => clue.id === 'narrator_invented_note'), false);
assert.equal(legalProjection.state.world?.knowledge.lin_yue.facts.unsourced_leak, undefined);
assert.deepEqual(legalProjection.state.clues[0].basedOnObservationIds, ['observation.package.exterior']);
assert.deepEqual(legalProjection.state.clues[0].sourceEventIds, [inspection.id]);
assert.equal(legalProjection.state.clues[0].title, '标记模糊的包裹');
assert.doesNotMatch(legalProjection.state.clues[0].detail, /内部纸条/);
assert.equal(legalProjection.state.observations[0].sourceEventIds[0], inspection.id);

const sourcelessClue = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: structuredClone(baseline),
  eventCandidates: [{ event: inspection, sourceProposalId: 'proposal.player' }],
  candidates: {
    observations: [],
    knowledgeUpdates: [],
    clues: [{
      ...legalClueCandidates.clues[0],
      basedOnObservationIds: ['observation.missing'],
    }],
  },
});
assert.deepEqual(sourcelessClue, { status: 'rejected', reason: 'clue_source_missing' });

const overreachingClue = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: structuredClone(baseline),
  eventCandidates: [{ event: inspection, sourceProposalId: 'proposal.player' }],
  candidates: {
    ...legalClueCandidates,
    clues: [{
      ...legalClueCandidates.clues[0],
      claims: ['fact.package.interior.secret_note'],
    }],
  },
});
assert.deepEqual(overreachingClue, { status: 'rejected', reason: 'clue_claim_not_observed' });

const undeliveredKnowledge = projectConfirmedKnowledgeAndClues({
  baselineState: baseline,
  candidateState: structuredClone(baseline),
  eventCandidates: [{ event: failedMessage, sourceProposalId: 'proposal.player' }],
  candidates: {
    observations: [],
    knowledgeUpdates: [{
      ...deliveredCandidates.knowledgeUpdates[0],
      sourceEventId: failedMessage.id,
    }],
    clues: [],
  },
});
assert.deepEqual(undeliveredKnowledge, { status: 'rejected', reason: 'knowledge_event_not_confirmed' });
