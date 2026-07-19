import assert from 'node:assert/strict';
import { ShadowReportStore } from './shadowReportStore';

const envelope = (turnId: string) => ({
  loopId: 'legacy-run-1',
  turnId,
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:01.000Z',
});

const store = new ShadowReportStore(2);
store.begin(envelope('turn-1'));
store.begin(envelope('turn-2'));
store.complete('turn-2', {
  kind: 'compiler_unavailable',
  envelope: envelope('turn-2'),
  semantic: { status: 'failed', durationMs: 4, issues: ['no key'] },
});
store.begin(envelope('turn-3'));

assert.equal(store.get('turn-1'), undefined, 'oldest report must be evicted at capacity');
assert.equal(store.get('turn-2')?.status, 'completed');
assert.equal(store.get('turn-3')?.status, 'pending');
assert.deepEqual(store.list().map((record) => record.turnId), ['turn-3', 'turn-2']);

const snapshot = store.get('turn-2');
if (snapshot?.payload?.kind === 'compiler_unavailable') snapshot.payload.semantic.issues.push('mutated');
assert.deepEqual(
  (store.get('turn-2')?.payload as { semantic: { issues: string[] } }).semantic.issues,
  ['no key'],
);

store.fail('turn-3', new Error('adapter exploded'));
assert.equal(store.get('turn-3')?.status, 'failed');
assert.equal(store.get('turn-3')?.error, 'adapter exploded');
