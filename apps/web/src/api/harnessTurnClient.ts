import type {
  DeductionResult,
  EndingTierResult,
} from '@murder-loop-ai/shared';
import type { GameState as FrontendGameState } from '../types';

export interface HarnessTurnResponse extends Partial<FrontendGameState> {
  gameSessionId?: string;
  inputStateVersion?: number;
  outputStateVersion?: number;
  coreState?: unknown;
  storyLog?: FrontendGameState['storyLog'];
  deduction?: DeductionResult;
  deductionEnding?: EndingTierResult;
  deductionResponse?: string;
  deductionPrompt?: string;
  epiphany?: string | null;
  turn?: {
    plan?: { actions?: Array<{ intent: string }> };
    killerStrategy?: { type: string };
  };
}

export interface HarnessSidebarResponse {
  gameSessionId: string;
  stateVersion: number;
  sidebar: NonNullable<FrontendGameState['sidebar']>;
}

export type HarnessTurnOperation = 'turn' | 'reset_loop' | 'deduction';

export class HarnessTurnRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(status: number, code?: string, payload?: unknown) {
    super(`harness turn failed: ${status}${code ? ` (${code})` : ''}`);
    this.name = 'HarnessTurnRequestError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function postHarnessTurn(
  input: string,
  state: unknown,
  gameSessionId: string,
  inputStateVersion: number,
  operation: HarnessTurnOperation = 'turn',
  recommendationId?: string,
  recommendationsEnabled = true,
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
      recommendationsEnabled,
      ...(recommendationId ? { recommendationId } : {}),
    }),
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const code = payload && typeof payload === 'object' && 'error' in payload
      && typeof payload.error === 'string'
      ? payload.error
      : undefined;
    throw new HarnessTurnRequestError(response.status, code, payload);
  }
  return (await response.json()) as HarnessTurnResponse;
}

export async function postHarnessSidebar(
  gameSessionId: string,
  stateVersion: number,
): Promise<HarnessSidebarResponse> {
  const response = await fetch('/api/harness/sidebar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameSessionId, stateVersion }),
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const code = payload && typeof payload === 'object' && 'error' in payload
      && typeof payload.error === 'string'
      ? payload.error
      : undefined;
    throw new HarnessTurnRequestError(response.status, code, payload);
  }
  return (await response.json()) as HarnessSidebarResponse;
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
