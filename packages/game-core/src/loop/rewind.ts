import { firstDeathMemory } from '@murder-loop-ai/content';
import { START_MINUTE, type GameState } from '@murder-loop-ai/shared';
import { getConversationCheckpoint, normalizeLoopMemory, rewindMemoryAfterDeath } from '../memory/loopMemory';
import { createInitialGameState } from '../state/createInitialState';
import { grantReviveProtection } from './reviveProtection';

export function rewindAfterDeath(state: GameState): GameState {
  const sourceMemory = normalizeLoopMemory(state.memory);
  const conversationCheckpoint = getConversationCheckpoint(sourceMemory);
  const next = createInitialGameState();

  next.run = state.run + 1;
  next.memory = rewindMemoryAfterDeath({ ...state, memory: sourceMemory });
  next.clues = state.clues.filter((clue) => clue.isPersistent);
  const retainedObservationIds = new Set(next.clues.flatMap((clue) => clue.basedOnObservationIds ?? []));
  next.observations = state.observations.filter((observation) => retainedObservationIds.has(observation.id));
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

  return next;
}
