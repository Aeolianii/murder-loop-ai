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

export async function postHarnessTurn(
  input: string,
  state: unknown,
  gameSessionId: string,
  inputStateVersion: number,
): Promise<HarnessTurnResponse> {
  const response = await fetch('/api/harness/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      state,
      gameSessionId,
      inputStateVersion,
    }),
  });
  if (!response.ok) throw new Error(`harness turn failed: ${response.status}`);
  return (await response.json()) as HarnessTurnResponse;
}
