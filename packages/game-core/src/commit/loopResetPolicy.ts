import type { GameState } from '@murder-loop-ai/shared';
import type { AtomicTurnStore } from './atomicTurnCommit';

export const DEFAULT_LOOP_RESET_POLICY = {
  preserve: ['canonical_truth', 'story_identity', 'space_structure', 'allowed_endings'],
  restoreFromCheckpoint: ['physical_state', 'resources', 'npc_state', 'killer_state', 'npc_knowledge', 'killer_knowledge'],
  retainFromPreviousLoop: ['player_cross_loop_memory', 'persistent_player_clues'],
  rebuild: ['facts', 'player', 'killer', 'npc', 'clue', 'recommendation'],
  invalidate: ['model_requests', 'async_reviews', 'late_results'],
} as const;

export interface PrepareGameLoopResetOptions {
  previousLoopId: string;
  nextLoopId: string;
  startingStateVersion: number;
  nextRun: number;
}

export interface PreparedGameLoopReset {
  previousLoopId: string;
  nextLoopId: string;
  startingStateVersion: number;
  state: GameState;
  rebuildProjections: Array<(typeof DEFAULT_LOOP_RESET_POLICY.rebuild)[number]>;
  invalidatedWork: Array<(typeof DEFAULT_LOOP_RESET_POLICY.invalidate)[number]>;
}

export interface AtomicLoopResetRequest {
  expectedLoopId: string;
  expectedStateVersion: number;
  reset: PreparedGameLoopReset;
}

export interface AtomicLoopResetOutcome {
  status: 'reset' | 'conflict' | 'failed';
  previousLoopId: string;
  nextLoopId?: string;
  stateVersion?: number;
}

export function prepareGameLoopReset(
  current: GameState,
  checkpoint: GameState,
  options: PrepareGameLoopResetOptions,
): PreparedGameLoopReset {
  if (options.previousLoopId === options.nextLoopId) {
    throw new Error('A loop reset requires a new loopId.');
  }
  if (options.startingStateVersion < 0 || !Number.isInteger(options.startingStateVersion)) {
    throw new Error('The starting state version must be a non-negative integer.');
  }

  const state = structuredClone(checkpoint) as GameState;
  state.run = options.nextRun;
  state.memory.crossRun = structuredClone(current.memory.crossRun);
  state.memory.characters.player = structuredClone(current.memory.characters.player);
  state.clues = structuredClone(current.clues.filter((clue) => clue.isPersistent));

  return {
    previousLoopId: options.previousLoopId,
    nextLoopId: options.nextLoopId,
    startingStateVersion: options.startingStateVersion,
    state,
    rebuildProjections: [...DEFAULT_LOOP_RESET_POLICY.rebuild],
    invalidatedWork: [...DEFAULT_LOOP_RESET_POLICY.invalidate],
  };
}

export async function atomicLoopReset(
  request: AtomicLoopResetRequest,
  store: AtomicTurnStore<GameState>,
): Promise<AtomicLoopResetOutcome> {
  if (request.reset.previousLoopId !== request.expectedLoopId) {
    return { status: 'conflict', previousLoopId: request.expectedLoopId };
  }

  let status: AtomicLoopResetOutcome['status'];
  try {
    status = await store.resetLoop({
      expectedLoopId: request.expectedLoopId,
      expectedStateVersion: request.expectedStateVersion,
      nextLoopId: request.reset.nextLoopId,
      startingStateVersion: request.reset.startingStateVersion,
      candidateState: request.reset.state,
    });
  } catch {
    status = 'failed';
  }

  return status === 'reset'
    ? {
        status,
        previousLoopId: request.expectedLoopId,
        nextLoopId: request.reset.nextLoopId,
        stateVersion: request.reset.startingStateVersion,
      }
    : { status, previousLoopId: request.expectedLoopId };
}
