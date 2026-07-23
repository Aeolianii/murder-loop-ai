import { INITIAL_STATE } from './constants';
import type { GameState } from './types';

export const FRONTEND_SAVE_KEY = 'murder-loop-ai:frontend-state:v1';

export function freshFrontendState(): GameState {
  return {
    ...structuredClone(INITIAL_STATE),
    gameSessionId: createGameSessionId(),
    stateVersion: 0,
  };
}

export function loadFrontendState(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): GameState {
  if (!storage) return freshFrontendState();
  try {
    const raw = storage.getItem(FRONTEND_SAVE_KEY);
    if (!raw) return freshFrontendState();
    const fresh = freshFrontendState();
    const saved = JSON.parse(raw) as Partial<GameState>;
    return {
      ...fresh,
      ...saved,
      playMode: saved.playMode === 'hard' ? 'hard' : 'easy',
      gameSessionId: typeof saved.gameSessionId === 'string' && saved.gameSessionId.trim()
        ? saved.gameSessionId
        : fresh.gameSessionId,
      stateVersion: Number.isInteger(saved.stateVersion) && (saved.stateVersion ?? -1) >= 0
        ? saved.stateVersion!
        : 0,
      isParsing: false,
      isParsingAction: false,
      actionConfirmation: null,
    };
  } catch {
    return freshFrontendState();
  }
}

function createGameSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function persistFrontendState(
  state: GameState,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  if (!storage) return;
  const cleanState: GameState = {
    ...state,
    isParsing: false,
    isParsingAction: false,
    actionConfirmation: null,
  };
  storage.setItem(FRONTEND_SAVE_KEY, JSON.stringify(cleanState));
}

export function resetFrontendProgress(
  storage: Pick<Storage, 'removeItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  storage?.removeItem(FRONTEND_SAVE_KEY);
  return freshFrontendState();
}
