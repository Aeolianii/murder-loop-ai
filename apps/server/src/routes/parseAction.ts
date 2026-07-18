import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema } from '@murder-loop-ai/ai-contracts';
import { fallbackParseAction } from '@murder-loop-ai/game-core';
import { completeRoleJson } from '../ai/openaiClient';
import { normalizeActionPlanJson } from '../ai/unwrapJsonObject';
import { buildParseSystemPrompt } from '../ai/parserPrompt';

export async function parseActionRoute(app: FastifyInstance) {
  app.post('/api/parse-action', async (request) => {
    const body = request.body as { input?: string; state?: unknown };
    const input = body.input || '';
    const fallback = fallbackParseAction(input);

    const ai = await completeRoleJson(
      'parse',
      buildParseSystemPrompt(),
      { input, state: body.state },
      { temperature: 0.25 },
    ).catch(() => null);

    const parsed = ActionPlanSchema.safeParse(normalizeActionPlanJson(ai));
    return parsed.success ? parsed.data : fallback;
  });
}
