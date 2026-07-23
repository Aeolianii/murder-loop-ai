import { create } from 'zustand';
import {
  HarnessTurnRequestError,
  type HarnessTurnResponse,
  postHarnessSidebar,
  postHarnessTurn,
} from '../api/harnessTurnClient';
import { freshFrontendState, loadFrontendState, persistFrontendState, resetFrontendProgress } from '../frontendState';
import { applyHarnessTurnResponse, beginHarnessTurn, rewindFrontendStateFromResponse } from '../turnViewModel';
import type { GameState, PlayMode, RecommendedAction } from '../types';

let stateQueue = Promise.resolve();

function enqueueHarnessRequest<T>(work: () => Promise<T>) {
  const next = stateQueue.then(work, work);
  stateQueue = next.then(() => undefined, () => undefined);
  return next;
}

interface GameStore {
  frontendState: GameState;
  busy: boolean;
  inputBusy: boolean;
  serverStatus: 'unknown' | 'online' | 'fallback';
  lastTurnDebug: unknown | null;
  submitAction: (text: string) => Promise<HarnessTurnResponse | null>;
  submitRecommendedAction: (action: RecommendedAction) => Promise<HarnessTurnResponse | null>;
  submitTruth: () => Promise<HarnessTurnResponse | null>;
  rewind: () => Promise<HarnessTurnResponse | null>;
  reset: () => void;
  clearSave: () => void;
  setPlayMode: (mode: PlayMode) => void;
  setFrontendState: (state: GameState) => void;
}

function setAndPersist(set: (partial: Partial<GameStore>) => void, frontendState: GameState) {
  persistFrontendState(frontendState);
  set({ frontendState });
}

export const useGameStore = create<GameStore>((set, get) => {
  const deferSidebarUpdate = (result: HarnessTurnResponse) => {
    const gameSessionId = result.gameSessionId;
    const stateVersion = result.outputStateVersion;
    if (!gameSessionId || !Number.isInteger(stateVersion) || (stateVersion ?? -1) < 0) return;

    setTimeout(() => {
      const applySidebar = (sidebar: NonNullable<GameState['sidebar']>) => {
        const current = get().frontendState;
        if (
          current.gameSessionId !== gameSessionId
          || current.stateVersion !== stateVersion
        ) return;
        setAndPersist(set, { ...current, sidebar });
      };

      if (result.sidebar) {
        applySidebar(result.sidebar);
        return;
      }

      void postHarnessSidebar(gameSessionId, stateVersion!)
        .then(response => {
          if (
            response.gameSessionId !== gameSessionId
            || response.stateVersion !== stateVersion
          ) return;
          applySidebar(response.sidebar);
        })
        .catch(() => undefined);
    }, 0);
  };

  const submit = async (text: string, recommendationId?: string) => {
    const input = text.trim();
    const current = get().frontendState;
    if (!input || get().inputBusy || current.ending) return null;

    const pendingState = beginHarnessTurn(current, input);
    set({ frontendState: pendingState, busy: true, inputBusy: true, lastTurnDebug: null });

    try {
      const result = await enqueueHarnessRequest(() => postHarnessTurn(
        input,
        current.coreState,
        current.gameSessionId,
        current.stateVersion,
        'turn',
        recommendationId,
        current.playMode !== 'hard',
      ));
      const nextState = applyHarnessTurnResponse(
        pendingState,
        result.sidebar ? { ...result, sidebar: undefined } : result,
      );
      setAndPersist(set, nextState);
      set({ serverStatus: 'online', lastTurnDebug: result });
      deferSidebarUpdate(result);
      return result;
    } catch (error) {
      const errorState = applyHarnessTurnResponse(pendingState, {}, error);
      setAndPersist(set, errorState);
      set({
        serverStatus: error instanceof HarnessTurnRequestError ? 'online' : 'fallback',
        lastTurnDebug: error,
      });
      return null;
    } finally {
      set({ inputBusy: false, busy: false });
    }
  };

  return {
    frontendState: loadFrontendState(),
    busy: false,
    inputBusy: false,
    serverStatus: 'unknown',
    lastTurnDebug: null,
    submitAction: (text) => submit(text),
    submitRecommendedAction: (action) => submit(action.label, action.id),
    submitTruth: async () => {
      const current = get().frontendState;
      if (get().inputBusy || current.ending) return null;

      const pendingState = { ...current, isParsing: true };
      set({ frontendState: pendingState, busy: true, inputBusy: true, lastTurnDebug: null });

      try {
        const result = await enqueueHarnessRequest(() => postHarnessTurn(
          '',
          current.coreState,
          current.gameSessionId,
          current.stateVersion,
          'deduction',
          undefined,
          current.playMode !== 'hard',
        ));
        const nextState = applyHarnessTurnResponse(pendingState, result);
        setAndPersist(set, nextState);
        set({ serverStatus: 'online', lastTurnDebug: result });
        return result;
      } catch (error) {
        const errorState = applyHarnessTurnResponse(pendingState, {}, error);
        setAndPersist(set, errorState);
        set({
          serverStatus: error instanceof HarnessTurnRequestError ? 'online' : 'fallback',
          lastTurnDebug: error,
        });
        return null;
      } finally {
        set({ inputBusy: false, busy: false });
      }
    },
    rewind: async () => {
      const current = get().frontendState;
      set({ frontendState: { ...current, isParsing: true }, busy: true, inputBusy: true, lastTurnDebug: null });

      try {
        const result = await enqueueHarnessRequest(() => postHarnessTurn(
          '',
          current.coreState,
          current.gameSessionId,
          current.stateVersion,
          'reset_loop',
          undefined,
          current.playMode !== 'hard',
        ));
        const nextState = rewindFrontendStateFromResponse(current, result);
        setAndPersist(set, nextState);
        set({ serverStatus: 'online', lastTurnDebug: result });
        return result;
      } catch (error) {
        setAndPersist(set, current);
        set({
          serverStatus: error instanceof HarnessTurnRequestError ? 'online' : 'fallback',
          lastTurnDebug: error,
        });
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
        lastTurnDebug: null,
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
        lastTurnDebug: null,
      });
    },
    setPlayMode: (playMode) => {
      const frontendState = { ...get().frontendState, playMode };
      setAndPersist(set, frontendState);
    },
    setFrontendState: (frontendState) => setAndPersist(set, frontendState),
  };
});
