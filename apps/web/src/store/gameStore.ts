import { create } from 'zustand';
import type { HarnessTurnResponse } from '../api/harnessTurnClient';
import { postHarnessTurn } from '../api/harnessTurnClient';
import { freshFrontendState, loadFrontendState, persistFrontendState, resetFrontendProgress } from '../frontendState';
import { applyHarnessTurnResponse, beginHarnessTurn, rewindFrontendStateFromResponse } from '../turnViewModel';
import type { GameState } from '../types';

let stateQueue = Promise.resolve();

function enqueueTurn<T>(work: () => Promise<T>) {
  const next = stateQueue.then(work, work);
  stateQueue = next.then(() => undefined, () => undefined);
  return next;
}

interface GameStore {
  frontendState: GameState;
  busy: boolean;
  inputBusy: boolean;
  serverStatus: 'unknown' | 'online' | 'fallback';
  lastDebug: unknown | null;
  submitAction: (text: string) => Promise<HarnessTurnResponse | null>;
  rewind: () => Promise<HarnessTurnResponse | null>;
  reset: () => void;
  clearSave: () => void;
  setFrontendState: (state: GameState) => void;
}

function setAndPersist(set: (partial: Partial<GameStore>) => void, frontendState: GameState) {
  persistFrontendState(frontendState);
  set({ frontendState });
}

export const useGameStore = create<GameStore>((set, get) => ({
  frontendState: loadFrontendState(),
  busy: false,
  inputBusy: false,
  serverStatus: 'unknown',
  lastDebug: null,
  submitAction: async (text) => {
    const input = text.trim();
    const current = get().frontendState;
    if (!input || get().inputBusy || current.ending) return null;

    const pendingState = beginHarnessTurn(current, input);
    set({ frontendState: pendingState, busy: true, inputBusy: true, lastDebug: null });

    try {
      const result = await enqueueTurn(() => postHarnessTurn(input, current.coreState));
      const nextState = applyHarnessTurnResponse(pendingState, result);
      setAndPersist(set, nextState);
      set({ serverStatus: 'online', lastDebug: result });
      return result;
    } catch (error) {
      const errorState = applyHarnessTurnResponse(pendingState, {}, error);
      setAndPersist(set, errorState);
      set({ serverStatus: 'fallback', lastDebug: error });
      return null;
    } finally {
      set({ inputBusy: false, busy: false });
    }
  },
  rewind: async () => {
    const current = get().frontendState;
    set({ frontendState: { ...current, isParsing: true }, busy: true, inputBusy: true, lastDebug: null });

    try {
      const result = await enqueueTurn(() => postHarnessTurn('', current.coreState));
      const nextState = rewindFrontendStateFromResponse(current, result);
      setAndPersist(set, nextState);
      set({ serverStatus: 'online', lastDebug: result });
      return result;
    } catch (error) {
      setAndPersist(set, current);
      set({ serverStatus: 'fallback', lastDebug: error });
      return null;
    } finally {
      set({ inputBusy: false, busy: false });
    }
  },
  reset: () => {
    const frontendState = resetFrontendProgress();
    set({
      frontendState,
      busy: false,
      inputBusy: false,
      serverStatus: 'unknown',
      lastDebug: null,
    });
  },
  clearSave: () => {
    const frontendState = freshFrontendState();
    resetFrontendProgress();
    set({
      frontendState,
      busy: false,
      inputBusy: false,
      serverStatus: 'unknown',
      lastDebug: null,
    });
  },
  setFrontendState: (frontendState) => setAndPersist(set, frontendState),
}));
