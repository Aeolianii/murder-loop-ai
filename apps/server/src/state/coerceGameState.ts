import { clueBook } from '@murder-loop-ai/content';
import { createInitialGameState, normalizeLoopMemory } from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';

export function coerceClues(rawClues: unknown, fallback: GameState): GameState['clues'] {
  if (!Array.isArray(rawClues)) return fallback.clues;
  return rawClues.flatMap((clue, index) => {
    if (typeof clue === 'object' && clue !== null && 'id' in clue && 'title' in clue && 'detail' in clue) {
      return [{
        ...(clue as GameState['clues'][number]),
        discoveredAt: (clue as GameState['clues'][number]).discoveredAt ?? { run: fallback.run, minute: fallback.minute },
        isPersistent: (clue as GameState['clues'][number]).isPersistent ?? true,
        source: (clue as GameState['clues'][number]).source ?? 'ai_generated',
        weight: (clue as GameState['clues'][number]).weight ?? 6,
      }];
    }

    if (typeof clue !== 'string') return [];
    const template = clueBook[clue];
    if (template) {
      return [{
        ...template,
        discoveredAt: { run: fallback.run, minute: fallback.minute },
      }];
    }

    return [{
      id: normalizeDynamicClueId(clue || `legacy_clue_${index}`),
      title: clue || `旧线索 ${index + 1}`,
      detail: '这是旧版本存档中的线索，已自动转为文字情报。',
      source: 'ai_generated' as const,
      weight: 4,
      discoveredAt: { run: fallback.run, minute: fallback.minute },
      isPersistent: true,
    }];
  });
}

export function coerceGameState(rawState: unknown): GameState {
  const fallback = createInitialGameState();
  if (!rawState || typeof rawState !== 'object') return fallback;

  const raw = rawState as Partial<GameState>;
  const state: GameState = {
    ...fallback,
    ...raw,
    player: {
      ...fallback.player,
      ...(raw.player ?? {}),
    },
    room: raw.room ?? fallback.room,
    killerKnowledge: {
      ...fallback.killerKnowledge,
      ...(raw.killerKnowledge ?? {}),
    },
    memory: normalizeLoopMemory(raw.memory ?? fallback.memory),
    log: Array.isArray(raw.log) ? raw.log : fallback.log,
    clues: coerceClues(raw.clues, { ...fallback, run: raw.run ?? fallback.run, minute: raw.minute ?? fallback.minute }),
    killerStatus: raw.killerStatus ?? fallback.killerStatus,
    playerHolding: raw.playerHolding ?? fallback.playerHolding,
    combatTriggered: raw.combatTriggered ?? fallback.combatTriggered,
    phoneBattery: raw.phoneBattery ?? ((raw.room?.phone?.state?.battery as number | undefined) ?? fallback.phoneBattery),
    phoneFunctional: raw.phoneFunctional ?? fallback.phoneFunctional,
    endingReason: raw.endingReason ?? fallback.endingReason,
  };

  return state;
}

export function normalizeDynamicClueId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'key_info';
}
