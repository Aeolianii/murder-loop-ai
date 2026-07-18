import type { FastifyInstance } from 'fastify';
import { ScoreRecapSchema } from '@murder-loop-ai/ai-contracts';
import { scoreRun } from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';

export async function scoreRunRoute(app: FastifyInstance) {
  app.post('/api/score-run', async (request) => {
    const body = request.body as { state: GameState };
    const fallback = scoreRun(body.state);
    const parsed = ScoreRecapSchema.safeParse(fallback);
    return parsed.success ? parsed.data : fallback;
  });
}
