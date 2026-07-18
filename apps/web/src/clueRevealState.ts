import type { Clue } from './types';

export type ClueReadMap = Record<string, boolean>;

export function findFirstNewClue(previous: Clue[], next: Clue[]) {
  const previousIds = new Set(previous.map((clue) => clue.id));
  return next.find((clue) => !previousIds.has(clue.id)) ?? null;
}

export function markClueRead(readMap: ClueReadMap, clueId: string): ClueReadMap {
  return { ...readMap, [clueId]: true };
}

export function isClueUnread(clue: Clue, readMap: ClueReadMap) {
  return clue.status === 'new' && readMap[clue.id] !== true;
}
