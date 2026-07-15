import type { GameState, LoopMemory, MemoryFragment } from '@murder-loop-ai/shared';

const SHORT_TERM_LIMIT = 5;
const CURRENT_RUN_LIMIT = 30;
const CROSS_RUN_LIMIT = 12;
const CHARACTER_LIMIT = 12;

type VisibleMemoryAgent = 'parser' | 'rule' | 'killer' | 'narrator' | 'director' | 'npc' | 'ui-adapter' | 'sidebar';

export function createEmptyLoopMemory(): LoopMemory {
  return {
    shortTerm: [],
    currentRun: [],
    crossRun: [],
    characters: {
      player: [],
      linYue: [],
      killer: [],
    },
  };
}

export function normalizeLoopMemory(raw: unknown): LoopMemory {
  const empty = createEmptyLoopMemory();
  if (Array.isArray(raw)) {
    const fragments = raw.map((item) => normalizeFragment(item, 'legacy')).filter(Boolean) as MemoryFragment[];
    return {
      ...empty,
      currentRun: trim(
        fragments
          .filter((item) => item.id.startsWith('checkpoint-'))
          .map((item) => ({ ...item, scope: 'current_run' as const, kind: 'checkpoint' as const })),
        CURRENT_RUN_LIMIT,
      ),
      crossRun: trim(
        fragments
          .filter((item) => !item.id.startsWith('checkpoint-'))
          .map((item) => ({ ...item, scope: 'cross_run' as const })),
        CROSS_RUN_LIMIT,
      ),
    };
  }

  if (!raw || typeof raw !== 'object') return empty;
  const source = raw as Partial<LoopMemory>;
  return {
    shortTerm: normalizeList(source.shortTerm, 'short_term', SHORT_TERM_LIMIT),
    currentRun: normalizeList(source.currentRun, 'current_run', CURRENT_RUN_LIMIT),
    crossRun: normalizeList(source.crossRun, 'cross_run', CROSS_RUN_LIMIT),
    characters: {
      player: normalizeCharacterList(source.characters?.player, 'player'),
      linYue: normalizeCharacterList(source.characters?.linYue, 'linYue'),
      killer: normalizeCharacterList(source.characters?.killer, 'killer'),
    },
  };
}

export function recordTurnMemory(
  state: GameState,
  input: { playerInput?: string; summary?: string; title?: string; text?: string },
): void {
  state.memory = normalizeLoopMemory(state.memory);
  const title = input.summary || input.title || state.log.at(-1)?.title || 'Turn remembered';
  const text = input.text || input.playerInput || state.log.at(-1)?.text || title;
  const fragment: MemoryFragment = {
    id: `turn-${state.run}-${state.minute}-${state.log.length}-${Math.random().toString(36).slice(2, 8)}`,
    run: state.run,
    minute: state.minute,
    title,
    text,
    scope: 'current_run',
    kind: 'action',
    importance: 4,
    source: 'rule',
  };

  state.memory.shortTerm = trim([...state.memory.shortTerm, { ...fragment, scope: 'short_term' }], SHORT_TERM_LIMIT);
  state.memory.currentRun = trim([...state.memory.currentRun, fragment], CURRENT_RUN_LIMIT);
}

export function recordConversationCheckpoint(state: GameState, entry: { id: string; title: string; text: string }): void {
  state.memory = normalizeLoopMemory(state.memory);
  const id = `checkpoint-${entry.id}`;
  if (state.memory.currentRun.some((item) => item.id === id)) return;

  state.memory.currentRun = trim(
    [
      ...state.memory.currentRun,
      {
        id,
        run: state.run,
        minute: state.minute,
        title: entry.title,
        text: entry.text,
        scope: 'current_run',
        kind: 'checkpoint',
        importance: 8,
        source: 'system',
      },
    ],
    CURRENT_RUN_LIMIT,
  );
}

export function getConversationCheckpoint(memory: LoopMemory): MemoryFragment | null {
  const normalized = normalizeLoopMemory(memory);
  return [...normalized.currentRun].reverse().find((item) => item.kind === 'checkpoint' || item.id.startsWith('checkpoint-')) ?? null;
}

export function recordDeathMemory(state: GameState): MemoryFragment {
  state.memory = normalizeLoopMemory(state.memory);
  const lastLog = state.log.at(-1);
  const fragment: MemoryFragment = {
    id: `memory-${state.run}-${state.minute}-${Math.random().toString(36).slice(2, 8)}`,
    run: state.run,
    minute: state.minute,
    title: lastLog?.title || 'Loop ended',
    text: lastLog?.text || 'The loop ended before the memory could become clear.',
    scope: 'cross_run',
    kind: 'death',
    owner: 'player',
    importance: 9,
    source: 'system',
  };

  state.memory.crossRun = trim([...state.memory.crossRun, fragment], CROSS_RUN_LIMIT);
  state.memory.characters.player = trim([...state.memory.characters.player, { ...fragment, scope: 'character' }], CHARACTER_LIMIT);
  return fragment;
}

export function rewindMemoryAfterDeath(state: GameState): LoopMemory {
  const source = normalizeLoopMemory(state.memory);
  const memory = createEmptyLoopMemory();
  memory.crossRun = trim(source.crossRun, CROSS_RUN_LIMIT);
  memory.characters.player = trim(source.characters.player, CHARACTER_LIMIT);

  const tempState = { ...state, memory };
  recordDeathMemory(tempState);
  return tempState.memory;
}

export function buildVisibleMemoryForAgent(memory: LoopMemory, agent: VisibleMemoryAgent): string[] {
  const normalized = normalizeLoopMemory(memory);
  if (agent === 'killer') {
    return normalized.characters.killer.map(formatMemoryLine).slice(-5);
  }

  if (agent === 'narrator' || agent === 'director') {
    return [
      ...normalized.shortTerm.slice(-3),
      ...normalized.currentRun.slice(-5),
      ...normalized.crossRun.slice(-5),
      ...normalized.characters.player.slice(-5),
    ].map(formatMemoryLine);
  }

  return [
    ...normalized.shortTerm.slice(-3),
    ...normalized.currentRun.slice(-3),
    ...normalized.crossRun.slice(-3),
  ].map(formatMemoryLine);
}

function normalizeList(raw: unknown, scope: NonNullable<MemoryFragment['scope']>, limit: number): MemoryFragment[] {
  if (!Array.isArray(raw)) return [];
  return trim(raw.map((item) => normalizeFragment(item, 'system', scope)).filter(Boolean) as MemoryFragment[], limit);
}

function normalizeCharacterList(raw: unknown, owner: NonNullable<MemoryFragment['owner']>): MemoryFragment[] {
  if (!Array.isArray(raw)) return [];
  return trim(
    raw
      .map((item) => normalizeFragment(item, 'system', 'character'))
      .filter(Boolean)
      .map((item) => ({ ...item, owner })) as MemoryFragment[],
    CHARACTER_LIMIT,
  );
}

function normalizeFragment(raw: unknown, source: NonNullable<MemoryFragment['source']>, scope?: NonNullable<MemoryFragment['scope']>): MemoryFragment | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<MemoryFragment>;
  if (!item.id || !item.title || !item.text) return null;
  return {
    id: String(item.id),
    run: typeof item.run === 'number' ? item.run : 1,
    minute: typeof item.minute === 'number' ? item.minute : undefined,
    title: String(item.title),
    text: String(item.text),
    scope: item.scope ?? scope,
    kind: item.kind ?? (item.id.startsWith('checkpoint-') ? 'checkpoint' : 'observation'),
    owner: item.owner,
    importance: typeof item.importance === 'number' ? item.importance : 5,
    source: item.source ?? source,
  };
}

function trim<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

function formatMemoryLine(memory: MemoryFragment): string {
  const minute = typeof memory.minute === 'number' ? ` @${memory.minute}` : '';
  return `[${memory.kind ?? 'memory'} r${memory.run}${minute}] ${memory.title}: ${memory.text}`;
}
