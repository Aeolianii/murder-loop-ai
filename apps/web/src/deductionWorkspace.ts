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
  return knowledge.filter(isConfirmedPositiveKnowledge).length >= 3;
}

export function buildTruthSubmission(
  knowledge: ReadonlyArray<PlayerKnowledge>,
  selectedKnowledgeIds: ReadonlyArray<string>,
): TruthSubmission {
  const uniqueIds = [...new Set(selectedKnowledgeIds)];
  if (uniqueIds.length !== 3) {
    throw new Error('Truth derivation requires exactly three confirmed conclusions.');
  }

  const byId = new Map(knowledge.map((item) => [item.id, item]));
  const selected = uniqueIds.map((id) => byId.get(id));
  if (
    selected.some(
      (item) => !item || !isConfirmedPositiveKnowledge(item),
    )
  ) {
    throw new Error('Every truth anchor must be a confirmed positive conclusion.');
  }

  const confirmed = selected as PlayerKnowledge[];
  return {
    selectedKnowledgeIds: uniqueIds,
    text: `推导真相：${confirmed.map((item) => item.label).join('。')}。`,
  };
}
