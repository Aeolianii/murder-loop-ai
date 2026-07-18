import { INITIAL_STATE } from './constants';
import type { GameState } from './types';

export const FRONTEND_SAVE_KEY = 'murder-loop-ai:frontend-state:v1';

export function freshFrontendState(): GameState {
  return structuredClone(INITIAL_STATE);
}

export function loadFrontendState(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): GameState {
  if (!storage) return freshFrontendState();
  try {
    const raw = storage.getItem(FRONTEND_SAVE_KEY);
    if (!raw) return freshFrontendState();
    return {
      ...freshFrontendState(),
      ...(JSON.parse(raw) as Partial<GameState>),
      isParsing: false,
      isParsingAction: false,
      actionConfirmation: null,
    };
  } catch {
    return freshFrontendState();
  }
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
