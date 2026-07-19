import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { ShadowReportStore } from '../shadow/shadowReportStore';
import { shadowReportsRoute } from './shadowReports';

const app = Fastify({ logger: false });
const store = new ShadowReportStore();
const envelope = {
  loopId: 'legacy-run-1',
  turnId: 'shadow-turn-1',
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:01.000Z',
};
store.begin(envelope);
store.complete(envelope.turnId, {
  kind: 'compiler_unavailable',
  envelope,
  semantic: { status: 'failed', durationMs: 3, issues: ['no model'] },
});
await app.register(shadowReportsRoute, { store });

const list = await app.inject({ method: 'GET', url: '/api/debug/shadow-runs' });
assert.equal(list.statusCode, 200);
assert.equal(list.json().runs[0].turnId, envelope.turnId);
assert.equal('payload' in list.json().runs[0], false, 'list endpoint must stay compact');

const detail = await app.inject({ method: 'GET', url: `/api/debug/shadow-runs/${envelope.turnId}` });
assert.equal(detail.statusCode, 200);
assert.equal(detail.json().payload.kind, 'compiler_unavailable');

const missing = await app.inject({ method: 'GET', url: '/api/debug/shadow-runs/missing' });
assert.equal(missing.statusCode, 404);
await app.close();
