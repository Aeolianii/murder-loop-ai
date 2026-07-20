import {
  InMemoryAtomicTurnStore,
  type AtomicTurnStore,
  type VersionedTurnState,
} from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';

export interface OpenGameSessionInput {
  gameSessionId: string;
  inputStateVersion: number;
  bootstrapState: GameState;
}

export type OpenGameSessionResult = {
  status: 'ready';
  gameSessionId: string;
  loopId: string;
  stateVersion: number;
  state: GameState;
  store: AtomicTurnStore<GameState>;
} | {
  status: 'conflict';
  gameSessionId: string;
  authoritativeLoopId: string;
  authoritativeStateVersion: number;
};

export interface GameSessionStore {
  open(input: OpenGameSessionInput): OpenGameSessionResult;
  snapshot(gameSessionId: string): VersionedTurnState<GameState> | undefined;
}

export function createInMemoryGameSessionStore(): GameSessionStore {
  const stores = new Map<string, InMemoryAtomicTurnStore<GameState>>();

  return {
    open(input) {
      assertGameSessionIdentity(input.gameSessionId, input.inputStateVersion);
      let store = stores.get(input.gameSessionId);
      if (!store) {
        store = new InMemoryAtomicTurnStore({
          loopId: gameSessionLoopId(input.gameSessionId, input.bootstrapState.run),
          stateVersion: input.inputStateVersion,
          state: input.bootstrapState,
        });
        stores.set(input.gameSessionId, store);
      }

      const snapshot = store.snapshot();
      if (snapshot.stateVersion !== input.inputStateVersion) {
        return {
          status: 'conflict',
          gameSessionId: input.gameSessionId,
          authoritativeLoopId: snapshot.loopId,
          authoritativeStateVersion: snapshot.stateVersion,
        };
      }

      return {
        status: 'ready',
        gameSessionId: input.gameSessionId,
        loopId: snapshot.loopId,
        stateVersion: snapshot.stateVersion,
        state: snapshot.state,
        store,
      };
    },

    snapshot(gameSessionId) {
      return stores.get(gameSessionId)?.snapshot();
    },
  };
}

function assertGameSessionIdentity(gameSessionId: string, inputStateVersion: number): void {
  if (!gameSessionId.trim()) throw new Error('gameSessionId must not be empty.');
  if (!Number.isInteger(inputStateVersion) || inputStateVersion < 0) {
    throw new Error('inputStateVersion must be a non-negative integer.');
  }
}

export function gameSessionLoopId(gameSessionId: string, run: number): string {
  return `session.${gameSessionId}.run.${run}`;
}
