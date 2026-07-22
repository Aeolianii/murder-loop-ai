import type { ActionAudioCue } from '@murder-loop-ai/shared';
import type { GameState as FrontendGameState } from '../types';

export interface HarnessTurnResponse extends Partial<FrontendGameState> {
  gameSessionId?: string;
  inputStateVersion?: number;
  outputStateVersion?: number;
  coreState?: unknown;
  storyLog?: FrontendGameState['storyLog'];
  audioCue?: ActionAudioCue | null;
  turn?: {
    plan?: { actions?: Array<{ intent: string }> };
    killerStrategy?: { type: string };
  };
}

export type HarnessTurnOperation = 'turn' | 'reset_loop';

export async function postHarnessTurn(
  input: string,
  state: unknown,
  gameSessionId: string,
  inputStateVersion: number,
  operation: HarnessTurnOperation = 'turn',
  recommendationId?: string,
): Promise<HarnessTurnResponse> {
  const response = await fetch('/api/harness/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation,
      input,
      state,
      gameSessionId,
      inputStateVersion,
      ...(recommendationId ? { recommendationId } : {}),
    }),
  });
  if (!response.ok) throw new Error(`harness turn failed: ${response.status}`);
  return (await response.json()) as HarnessTurnResponse;
}
