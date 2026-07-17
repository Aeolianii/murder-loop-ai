import type { WorldEvent } from '@murder-loop-ai/shared';

export function formatConfirmedWorldEventsPromptBlock(events: WorldEvent[] | undefined): string {
  if (!events?.length) return '';

  return [
    '[Confirmed World Events]',
    'These events are read-only facts confirmed by the Behavior Network.',
    'Narrator may describe only the listed ids, actors, locations, facts, and hints.',
    'Narrator must not add facts, move characters, resolve conflicts, decide endings, or write world state.',
    ...events.map((event) => {
      const lines = [
        `- [${event.minute}] ${event.type}.${event.id}`,
        `  actors: ${event.actors.join(', ')}`,
        event.location ? `  location: ${event.location}` : undefined,
        `  facts: ${event.facts.join('; ')}`,
        event.narrationHint ? `  hint: ${event.narrationHint}` : undefined,
      ].filter(Boolean);
      return lines.join('\n');
    }),
  ].join('\n');
}
