import assert from 'node:assert/strict';
import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';
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
  return {
    id,
    eventType,
    subject,
    summary: `${eventType} for ${subject}`,
    facts,
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
const legalClueCandidates: KnowledgeClueProjectionCandidates = {
  observations: [{
    id: 'observation.package.exterior',
    subject: 'package',
    predicate: 'exterior_label',
    value: 'ambiguous',
    scope: 'exterior.label',
    visibleFactIds: ['fact.package.exterior.label_ambiguous'],
    sourceEventIds: [inspection.id],
    observedAt: { run: baseline.run, minute: baseline.minute },
  }],
  knowledgeUpdates: [{
    characterId: 'player',
    factId: 'package_exterior_label_ambiguous',
    confidence: 1,
    source: 'seen',
    sourceEventId: inspection.id,
  }],
  clues: [{
    id: 'wrong_package',
    title: '标记模糊的包裹',
    detail: '包裹外部标签上的 5-03 / 503 标记很模糊。',
    weight: 12,
    isPersistent: true,
    claims: ['fact.package.exterior.label_ambiguous'],
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
