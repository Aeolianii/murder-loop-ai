import type { FastifyInstance } from 'fastify';
import { shadowReportStore, type ShadowReportStore } from '../shadow/shadowReportStore';

interface ShadowReportsRouteOptions {
  store?: ShadowReportStore;
}

export async function shadowReportsRoute(
  app: FastifyInstance,
  options: ShadowReportsRouteOptions = {},
) {
  const store = options.store ?? shadowReportStore;

  app.get('/api/debug/shadow-runs', async () => ({ runs: store.list() }));
  app.get('/api/debug/shadow-runs/:turnId', async (request, reply) => {
    const { turnId } = request.params as { turnId: string };
    const record = store.get(turnId);
    if (!record) return reply.code(404).send({ error: 'shadow_run_not_found' });
    return record;
  });
}
