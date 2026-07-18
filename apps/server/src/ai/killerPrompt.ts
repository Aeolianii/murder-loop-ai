import type { KillerContext } from '@murder-loop-ai/game-core';

export function buildKillerPromptPayload(killerContext: KillerContext): { killerContext: KillerContext } {
  return { killerContext };
}
