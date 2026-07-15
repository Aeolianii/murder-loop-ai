import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { roleHealth } from './ai/roleConfig';
import { env } from './env';
import { killerStrategyRoute } from './routes/killerStrategy';
import { narrateRoute } from './routes/narrate';
import { npcReplyRoute } from './routes/npcReply';
import { parseActionRoute } from './routes/parseAction';
import { scoreRunRoute } from './routes/scoreRun';
import { frontendAdapterRoute } from './routes/frontendAdapter';
import { harnessTurnRoute } from './routes/harnessTurn';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
});

async function registerCoreRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'murder-loop-ai-server',
    ai: {
      openai: Boolean(env.openaiApiKey),
      deepseek: Boolean(env.deepseekApiKey || env.deepseekApiKeys.length),
      duckingmind: Boolean(env.duckingmindApiKey),
      roles: roleHealth(),
    },
  }));

  await app.register(harnessTurnRoute);
}

async function registerDebugRoutes(app: FastifyInstance) {
  await app.register(parseActionRoute);
  await app.register(killerStrategyRoute);
  await app.register(narrateRoute);
  await app.register(npcReplyRoute);
  await app.register(scoreRunRoute);
}

async function registerLegacyRoutes(app: FastifyInstance) {
  await app.register(frontendAdapterRoute);
}

await registerCoreRoutes(app);
await registerDebugRoutes(app);
await registerLegacyRoutes(app);

try {
  await app.listen({ port: env.port, host: '127.0.0.1' });
  app.log.info(`murder-loop-ai server listening on http://127.0.0.1:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
