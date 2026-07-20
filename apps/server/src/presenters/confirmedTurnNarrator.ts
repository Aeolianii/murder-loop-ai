import { NarrationSchema } from '@murder-loop-ai/ai-contracts';
import {
  buildNarratorContext,
  sanitizeNarration,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import type { Narration, TurnResolution } from '@murder-loop-ai/shared';

export interface ConfirmedTurnNarration {
  actionNarration?: Narration;
  ambientNarration?: Narration;
  warnings: string[];
}

type NarrationSlot = 'actionNarration' | 'ambientNarration';

function presentationOnlyNarration(narration: Narration): Narration {
  const sanitized = sanitizeNarration(narration);
  return {
    title: sanitized.title,
    text: sanitized.text,
  };
}

async function runNarratorSlot(
  slot: NarrationSlot,
  narrator: AiAdapters['narrateAction'] | AiAdapters['narrateAmbient'],
  context: ReturnType<typeof buildNarratorContext>,
): Promise<{ narration?: Narration; warnings: string[] }> {
  if (!narrator) {
    return {
      warnings: [`post-commit ${slot} adapter unavailable; confirmed material remains visible.`],
    };
  }

  try {
    const parsed = NarrationSchema.safeParse(await narrator(context));
    if (!parsed.success) {
      return {
        warnings: [`post-commit ${slot} failed schema validation; confirmed material remains visible.`],
      };
    }
    const authorityWarnings = parsed.data.ending
      || parsed.data.isFatal
      || parsed.data.killerKilled
      || parsed.data.clue
      ? [`post-commit ${slot} authority fields ignored; narration is presentation-only.`]
      : [];
    return {
      narration: presentationOnlyNarration(parsed.data),
      warnings: authorityWarnings,
    };
  } catch (error) {
    return {
      warnings: [
        `post-commit ${slot} failed; confirmed material remains visible. ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
}

export async function narrateConfirmedTurn(
  resolution: TurnResolution,
  adapters: AiAdapters,
): Promise<ConfirmedTurnNarration> {
  const context = buildNarratorContext({
    state: resolution.finalState,
    playerResult: resolution.playerResult,
    killerResult: resolution.killerResult,
  });
  const [action, ambient] = await Promise.all([
    runNarratorSlot('actionNarration', adapters.narrateAction ?? adapters.narrate, context),
    runNarratorSlot('ambientNarration', adapters.narrateAmbient ?? adapters.narrate, context),
  ]);

  return {
    actionNarration: action.narration,
    ambientNarration: ambient.narration,
    warnings: [...action.warnings, ...ambient.warnings],
  };
}
