import type { PlayerKnowledge } from '@murder-loop-ai/shared';

export interface TruthSubmission {
  selectedKnowledgeIds: string[];
  text: string;
}

export function isConfirmedPositiveKnowledge(
  item: PlayerKnowledge,
): boolean {
  return item.category !== 'hypothesis'
    && item.truthLayerContribution > 0;
}

export function canStartTruthDerivation(
  knowledge: ReadonlyArray<PlayerKnowledge>,
): boolean {
  return knowledge.some(isConfirmedPositiveKnowledge);
}

export function buildTruthSubmission(
  knowledge: ReadonlyArray<PlayerKnowledge>,
): TruthSubmission {
  const confirmed = Array.from(
    new Map(
      knowledge
        .filter(isConfirmedPositiveKnowledge)
        .map((item) => [item.id, item]),
    ).values(),
  );
  if (confirmed.length === 0) {
    throw new Error('Truth derivation requires at least one confirmed conclusion.');
  }

  return {
    selectedKnowledgeIds: confirmed.map((item) => item.id),
    text: `推导真相：${confirmed.map((item) => item.label).join('。')}。`,
  };
}
