import type { FastifyInstance } from 'fastify';
import { fallbackNpcReply } from '@murder-loop-ai/game-core';
import type { GameState, NpcReply } from '@murder-loop-ai/shared';
import { generateNpcReplyAi } from '../ai/harnessAiAdapters';

export async function npcReplyRoute(app: FastifyInstance) {
  app.post('/api/npc-reply', async (request) => {
    const body = request.body as { speaker?: NpcReply['speaker']; input?: string; state: GameState };
    const speaker = body.speaker || 'linyue';
    const input = body.input || '';
    return generateNpcReplyAi(speaker, input, body.state)
      .catch(() => fallbackNpcReply(speaker, input, body.state));
  });
}
