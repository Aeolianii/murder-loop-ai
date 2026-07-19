import assert from 'node:assert/strict';
import type { SemanticCompilerRequest } from '@murder-loop-ai/ai-contracts';
import { createAiShadowAdapters, type ShadowCompletion } from './shadowAiAdapters';

const request: SemanticCompilerRequest = {
  loopId: 'legacy-run-1',
  turnId: 'shadow-turn-1',
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:01.000Z',
  rawInput: '等待',
  playerContext: {
    facts: [],
    accessibleEntityIds: ['player'],
    capabilities: ['wait'],
    activeCommunicationActorIds: [],
    recentConfirmedEventIds: [],
    entityAliasIndex: {},
    recentReferenceCandidates: [],
    phaseSummary: 'loop started',
  },
};
const brief = {
  ...request,
  rawInput: undefined,
  playerContext: undefined,
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: 'world-model-v1',
  utteranceMode: 'command' as const,
  resolvedReferences: [],
  orderedActions: [],
  globalConstraints: [],
  scopedConstraints: [],
  communications: [],
  candidateHandles: [],
  ambiguities: [],
};
delete (brief as Record<string, unknown>).rawInput;
delete (brief as Record<string, unknown>).playerContext;

const calls: Array<{ role: string; user: unknown; signal?: AbortSignal; maxTokens?: number }> = [];
const completion: ShadowCompletion = async (role, _system, user, options) => {
  calls.push({ role, user, signal: options.signal, maxTokens: options.maxTokens });
  if (role === 'semantic_compiler') return { status: 'compiled', brief };
  if (role === 'world_model') return { proposals: [] };
  return { candidates: [] };
};
const adapters = createAiShadowAdapters(completion);
const controller = new AbortController();
const semantic = await adapters.semanticCompiler.compile(request, { signal: controller.signal });
assert.equal(semantic.status, 'compiled');
assert.equal(calls[0].role, 'semantic_compiler');
assert.equal(calls[0].signal, controller.signal);
assert((calls[0].maxTokens ?? 0) <= 1400);

await adapters.mainWorldModel({ turnBrief: brief, facts: [] }, {
  envelope: request,
  signal: controller.signal,
});
assert.equal(calls.at(-1)?.role, 'world_model');

assert.deepEqual(
  adapters.specialists.map((registration) => registration.id),
  [
    'player-specialist',
    'killer-specialist',
    'npc-specialist:lin_yue',
    'npc-specialist:police_dispatch',
    'environment-specialist',
    'clue-specialist',
    'recommendation-specialist',
  ],
);

const killer = adapters.specialists.find((registration) => registration.id === 'killer-specialist');
await killer?.generate({ facts: [], conditionalSignals: [] }, {
  envelope: request,
  signal: controller.signal,
});
assert.equal(calls.at(-1)?.role, 'killer_specialist');
assert.equal(JSON.stringify(calls.at(-1)?.user).includes(request.rawInput), false);
