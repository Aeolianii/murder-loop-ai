import { create } from 'zustand';
import { createInitialGameState, resolveAmbientTurn, rewindAfterDeath } from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';
import { aiClient } from '../api/aiClient';

const SAVE_KEY = 'murder-loop-ai:game-state:v2';
let stateQueue = Promise.resolve();

function enqueueTurn<T>(work: () => Promise<T>) {
  const next = stateQueue.then(work, work);
  stateQueue = next.then(() => undefined, () => undefined);
  return next;
}

function loadSavedGame(): GameState {
  if (typeof window === 'undefined') return createInitialGameState();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : createInitialGameState();
  } catch {
    return createInitialGameState();
  }
}

function persistGame(game: GameState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
}

function clearSavedGame() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SAVE_KEY);
}

async function resolveHarnessTurn(game: GameState, input: string): Promise<{ finalState: GameState; debug: unknown }> {
  const response = await fetch('/api/harness/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, state: game }),
  });
  if (!response.ok) throw new Error(`/api/harness/turn failed: ${response.status}`);
  const body = await response.json() as { coreState?: GameState };
  if (!body.coreState) {
    throw new Error('/api/harness/turn returned an incomplete turn payload');
  }
  return {
    finalState: body.coreState,
    debug: body,
  };
}

interface GameStore {
  game: GameState;
  draft: string;
  plannedAction: null;
  busy: boolean;
  inputBusy: boolean;
  ambientBusy: boolean;
  autoNarrationPaused: boolean;
  serverStatus: 'unknown' | 'online' | 'fallback';
  lastDebug: unknown | null;
  setDraft: (value: string) => void;
  toggleAutoNarration: () => void;
  executeInput: () => Promise<void>;
  runAmbientTurn: () => Promise<void>;
  submitQuick: (text: string) => Promise<void>;
  rewind: () => void;
  reset: () => void;
  clearSave: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: loadSavedGame(),
  draft: '',
  plannedAction: null,
  busy: false,
  inputBusy: false,
  ambientBusy: false,
  autoNarrationPaused: false,
  serverStatus: 'unknown',
  lastDebug: null,
  setDraft: (value) => set({ draft: value }),
  toggleAutoNarration: () => set((store) => ({ autoNarrationPaused: !store.autoNarrationPaused })),
  executeInput: async () => {
    const input = get().draft.trim();
    if (!input || get().inputBusy || get().game.ending) return;
    set({ busy: true, inputBusy: true, draft: '', plannedAction: null, autoNarrationPaused: false });
    try {
      const resolution = await enqueueTurn(() => resolveHarnessTurn(get().game, input));
      persistGame(resolution.finalState);
      set({ game: resolution.finalState, serverStatus: 'online', lastDebug: resolution.debug });
    } catch (error) {
      set({ serverStatus: 'fallback', lastDebug: error });
    } finally {
      set((store) => ({ inputBusy: false, busy: store.ambientBusy }));
    }
  },
  runAmbientTurn: async () => {
    if (get().ambientBusy || get().inputBusy || get().autoNarrationPaused || get().game.ending) return;
    set({ busy: true, ambientBusy: true });
    try {
      const resolution = await enqueueTurn(() => resolveAmbientTurn(get().game, {
        chooseKillerStrategy: aiClient.chooseKillerStrategy,
        narrateAmbient: aiClient.narrateAmbient,
        narrate: aiClient.narrate,
      }));
      persistGame(resolution.finalState);
      set({ game: resolution.finalState, serverStatus: 'online', lastDebug: resolution });
    } catch {
      const resolution = await enqueueTurn(() => resolveAmbientTurn(get().game));
      persistGame(resolution.finalState);
      set({ game: resolution.finalState, serverStatus: 'fallback', lastDebug: resolution });
    } finally {
      set((store) => ({ ambientBusy: false, busy: store.inputBusy }));
    }
  },
  submitQuick: async (text) => {
    set({ draft: text });
    await get().executeInput();
  },
  rewind: () => set((store) => {
    const game = rewindAfterDeath(store.game);
    persistGame(game);
    return { game, plannedAction: null, draft: '', lastDebug: null };
  }),
  reset: () => {
    const game = createInitialGameState();
    persistGame(game);
    set({ game, plannedAction: null, draft: '', busy: false, inputBusy: false, ambientBusy: false, autoNarrationPaused: false, serverStatus: 'unknown', lastDebug: null });
  },
  clearSave: () => {
    clearSavedGame();
    const game = createInitialGameState();
    set({ game, plannedAction: null, draft: '', busy: false, inputBusy: false, ambientBusy: false, autoNarrationPaused: false, serverStatus: 'unknown', lastDebug: null });
  },
}));
