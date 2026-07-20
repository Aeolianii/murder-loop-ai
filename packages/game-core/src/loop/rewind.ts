import { firstDeathMemory } from '@murder-loop-ai/content';
import { START_MINUTE, type GameState } from '@murder-loop-ai/shared';
import {
  prepareGameLoopReset,
  type PrepareGameLoopResetOptions,
  type PreparedGameLoopReset,
} from '../commit/loopResetPolicy';
import { getConversationCheckpoint, normalizeLoopMemory, rewindMemoryAfterDeath } from '../memory/loopMemory';
import { createInitialGameState } from '../state/createInitialState';
import { grantReviveProtection } from './reviveProtection';

export function prepareDeathLoopReset(
  state: GameState,
  options: PrepareGameLoopResetOptions,
): PreparedGameLoopReset {
  const sourceMemory = normalizeLoopMemory(state.memory);
  const conversationCheckpoint = getConversationCheckpoint(sourceMemory);
  const currentWithDeathMemory = structuredClone(state) as GameState;
  currentWithDeathMemory.memory = rewindMemoryAfterDeath({ ...state, memory: sourceMemory });
  const prepared = prepareGameLoopReset(currentWithDeathMemory, createInitialGameState(), options);
  const next = prepared.state;

  grantReviveProtection(next);

  next.log = [
    conversationCheckpoint
      ? {
          id: `rewind-${next.run}`,
          run: next.run,
          minute: START_MINUTE,
          title: `第 ${next.run} 次醒来 - 对话锚点`,
          text: '电子钟回到 23:00。房间恢复原状，但上一轮和外界建立联系的那个瞬间仍留在记忆里。',
          tone: 'memory',
          channel: 'memory',
        }
      : {
          id: `rewind-${next.run}`,
          run: next.run,
          minute: START_MINUTE,
          title: `第 ${next.run} 次醒来`,
          text: state.clues.length > 0
            ? '雨声重新贴上窗户。电子钟回到 23:00。房间没有变，但上一轮发现的线索碎片还留在记忆里。'
            : firstDeathMemory.text,
          tone: 'memory',
          channel: 'memory',
        },
  ];

  return prepared;
}

/** @deprecated Prefer prepareDeathLoopReset + atomicLoopReset for persisted sessions. */
export function rewindAfterDeath(state: GameState): GameState {
  return prepareDeathLoopReset(state, {
    previousLoopId: `legacy.run.${state.run}`,
    nextLoopId: `legacy.run.${state.run + 1}`,
    startingStateVersion: 0,
    nextRun: state.run + 1,
  }).state;
}
