interface PromptWorldInfoCard {
  id: string;
  title: string;
  content?: string;
  tags?: string[];
  priority?: number;
  source?: string;
}

export function formatWorldInfoPromptBlock(
  cards: PromptWorldInfoCard[] | undefined,
  agent: 'killer' | 'narrator',
): string {
  if (!cards?.length) return '';

  const roleBoundary = agent === 'killer'
    ? 'Use these cards only when they are compatible with Chen Huaimin visible knowledge and observable events.'
    : 'Use these cards to keep narration consistent, but never create rule outcomes, endings, deaths, arrests, or clues from them alone.';

  return [
    '[World Info Lite]',
    'These cards are setting/context hints, not rule authority.',
    roleBoundary,
    'After using these cards, still obey the JSON-only output schema requested by the current prompt.',
    ...cards.map((card) => {
      const meta = [
        card.source ? `source=${card.source}` : undefined,
        typeof card.priority === 'number' ? `priority=${card.priority}` : undefined,
      ].filter(Boolean).join(', ');
      return `- ${card.id} | ${card.title}${meta ? ` (${meta})` : ''}: ${card.content ?? ''}`;
    }),
  ].join('\n');
}
