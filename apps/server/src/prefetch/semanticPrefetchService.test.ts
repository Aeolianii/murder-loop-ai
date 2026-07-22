import assert from 'node:assert/strict';
import { WORLD_MODEL_SCHEMA_VERSION, type TurnBrief } from '@murder-loop-ai/ai-contracts';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import { createSemanticPrefetchService } from './semanticPrefetchService';

function brief(input: {
  loopId: string;
  turnId: string;
  inputStateVersion: number;
  deadlineAt: string;
  label: string;
}): TurnBrief {
  return {
    loopId: input.loopId,
    turnId: input.turnId,
    inputStateVersion: input.inputStateVersion,
    deadlineAt: input.deadlineAt,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [{
      actionId: `action-${input.turnId}`,
      actorId: 'player',
      operation: 'wait',
      targetIds: ['player'],
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: input.label.length, text: input.label },
    }],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

const state = createInitialGameState();
const recommendations = [
  { id: 'recommendation.one', label: '等待一分钟', rationale: '观察环境变化。' },
  { id: 'recommendation.two', label: '检查门锁', rationale: '确认门是否安全。' },
  { id: 'recommendation.three', label: '联系林越', rationale: '同步目前情况。' },
];

{
  const calls: string[] = [];
  const service = createSemanticPrefetchService({
    compile: async (input) => {
      calls.push(input.recommendation.id);
      return {
        brief: brief({ ...input.envelope, label: input.recommendation.label }),
        durationMs: 320,
      };
    },
  });

  service.schedule({
    gameSessionId: 'session-ready',
    loopId: 'loop-1',
    stateVersion: 4,
    state,
    recommendations,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.sort(), recommendations.map((item) => item.id).sort());
  const claimed = await service.claim({
    gameSessionId: 'session-ready',
    loopId: 'loop-1',
    stateVersion: 4,
    recommendationId: recommendations[1].id,
    label: recommendations[1].label,
  });
  assert.equal(claimed.status, 'ready_hit');
  assert.equal(claimed.brief?.orderedActions[0]?.originalSpan.text, recommendations[1].label);
  assert.equal(claimed.savedCompilerMs, 320);
  assert.equal(service.pendingCount(), 0, 'claiming one recommendation must cancel and remove sibling work');
  assert.equal(service.metrics().semantic_prefetch_ready_hit, 1);
  assert.equal(service.metrics().semantic_prefetch_cancelled, 2);
}

{
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = createSemanticPrefetchService({
    compile: async (input) => {
      await gate;
      return {
        brief: brief({ ...input.envelope, label: input.recommendation.label }),
        durationMs: 500,
      };
    },
  });
  service.schedule({
    gameSessionId: 'session-inflight',
    loopId: 'loop-1',
    stateVersion: 2,
    state,
    recommendations: [recommendations[0]],
  });
  const claimPromise = service.claim({
    gameSessionId: 'session-inflight',
    loopId: 'loop-1',
    stateVersion: 2,
    recommendationId: recommendations[0].id,
    label: recommendations[0].label,
  });
  release();
  const claimed = await claimPromise;
  assert.equal(claimed.status, 'inflight_hit');
  assert.ok((claimed.savedCompilerMs ?? -1) >= 0);
  assert.equal(service.metrics().semantic_prefetch_inflight_hit, 1);
}

{
  const aborted: string[] = [];
  const service = createSemanticPrefetchService({
    compile: async (input) => {
      await new Promise<never>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          aborted.push(input.recommendation.id);
          reject(new Error('cancelled'));
        }, { once: true });
      });
      throw new Error('unreachable');
    },
  });
  service.schedule({
    gameSessionId: 'session-natural-language',
    loopId: 'loop-1',
    stateVersion: 1,
    state,
    recommendations,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  service.cancelSession('session-natural-language', 'natural_language_submitted');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(aborted.sort(), recommendations.map((item) => item.id).sort());
  assert.equal(service.pendingCount(), 0);
  assert.equal(service.metrics().semantic_prefetch_cancelled, 3);
}

{
  const service = createSemanticPrefetchService({
    compile: async (input) => ({
      brief: brief({ ...input.envelope, label: input.recommendation.label }),
      durationMs: 100,
    }),
  });
  service.schedule({
    gameSessionId: 'session-stale',
    loopId: 'loop-1',
    stateVersion: 5,
    state,
    recommendations: [recommendations[0]],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const stale = await service.claim({
    gameSessionId: 'session-stale',
    loopId: 'loop-1',
    stateVersion: 6,
    recommendationId: recommendations[0].id,
    label: recommendations[0].label,
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.brief, undefined);
  assert.equal(service.metrics().semantic_prefetch_stale, 1);

  const miss = await service.claim({
    gameSessionId: 'session-miss',
    loopId: 'loop-1',
    stateVersion: 1,
    recommendationId: 'recommendation.unknown',
    label: '未知动作',
  });
  assert.equal(miss.status, 'miss');
  assert.equal(service.metrics().semantic_prefetch_miss, 1);
}
