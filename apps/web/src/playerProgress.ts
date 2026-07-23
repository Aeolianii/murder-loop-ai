import type { EndingTier } from '@murder-loop-ai/shared';

export const META_PROGRESS_SAVE_KEY = 'murder-loop-ai:meta-progress:v1';

export interface EndingUnlockRecord {
  unlockedAt: string;
  bestScore: number;
}

export interface PlayerProgress {
  version: 1;
  unlockedEndings: Partial<Record<EndingTier, EndingUnlockRecord>>;
}

export function createEmptyPlayerProgress(): PlayerProgress {
  return {
    version: 1,
    unlockedEndings: {},
  };
}

function isEndingTier(value: string): value is EndingTier {
  return ['S', 'A', 'B', 'C', 'D'].includes(value);
}

export function loadPlayerProgress(
  storage: Pick<Storage, 'getItem'> | null =
    typeof window === 'undefined' ? null : window.localStorage,
): PlayerProgress {
  if (!storage) return createEmptyPlayerProgress();
  try {
    const raw = storage.getItem(META_PROGRESS_SAVE_KEY);
    if (!raw) return createEmptyPlayerProgress();
    const parsed = JSON.parse(raw) as {
      unlockedEndings?: Record<string, Partial<EndingUnlockRecord>>;
    };
    const unlockedEndings: PlayerProgress['unlockedEndings'] = {};
    Object.entries(parsed.unlockedEndings ?? {}).forEach(([tier, record]) => {
      if (
        !isEndingTier(tier)
        || typeof record.unlockedAt !== 'string'
        || typeof record.bestScore !== 'number'
      ) {
        return;
      }
      unlockedEndings[tier] = {
        unlockedAt: record.unlockedAt,
        bestScore: Math.max(0, Math.min(100, Math.round(record.bestScore))),
      };
    });
    return { version: 1, unlockedEndings };
  } catch {
    return createEmptyPlayerProgress();
  }
}

export function persistPlayerProgress(
  progress: PlayerProgress,
  storage: Pick<Storage, 'setItem'> | null =
    typeof window === 'undefined' ? null : window.localStorage,
) {
  storage?.setItem(META_PROGRESS_SAVE_KEY, JSON.stringify(progress));
}

export function unlockEnding(
  progress: PlayerProgress,
  tier: EndingTier,
  totalScore: number,
  unlockedAt = new Date().toISOString(),
): PlayerProgress {
  const previous = progress.unlockedEndings[tier];
  return {
    version: 1,
    unlockedEndings: {
      ...progress.unlockedEndings,
      [tier]: {
        unlockedAt: previous?.unlockedAt ?? unlockedAt,
        bestScore: Math.max(previous?.bestScore ?? 0, Math.round(totalScore)),
      },
    },
  };
}
