import assert from 'node:assert/strict';
import { WORLD_MODEL_SCHEMA_VERSION, type TurnBrief } from '@murder-loop-ai/ai-contracts';
import {
  createInitialGameState,
  type FinalizeShadowRunInput,
  type ShadowCandidateWave,
  type ShadowRunReport,
} from '@murder-loop-ai/game-core';
import type { ActionPlan, TurnResolution } from '@murder-loop-ai/shared';
import { ShadowReportStore } from './shadowReportStore';
import {
  createShadowRunCoordinator,
  deriveLegacyShadowStateVersion,
  legacyEventsFromResolution,
} from './shadowCoordinator';

const state = createInitialGameState();
const plan: ActionPlan = {
  id: 'plan-1',
  raw: 'wait',
  summary: 'Wait',
  actions: [{
    id: 'action-1',
    raw: 'wait',
    intent: 'wait',
    target: 'self',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }],
  confidence: 1,
  warnings: [],
};
const ruleResult = {
  title: 'Wait',
  text: 'One minute passes.',
  tone: 'neutral' as const,
  addedClues: [],
  timePassed: 1,
  threatDelta: 0,
  events: [{
    kind: 'action' as const,
    subject: 'player',
    summary: 'Player waited.',
    sensoryHints: [],
    visibility: 'player' as const,
  }],
  state,
};
const resolution: TurnResolution = {
  plan,
  playerResult: ruleResult,
  killerStrategy: {
    id: 'killer-wait',
    type: 'wait',
    title: 'Wait',
    rationale: 'No change.',
    visibleToPlayer: false,
    risk: 'low',
  },
  killerResult: { ...ruleResult, events: [] },
  narration: { title: 'Wait', text: 'One minute passes.' },
  finalState: state,
};

const report = {
  semanticComparison: { equivalent: true, differences: [] },
  differences: { items: [], unexplainedCount: 0 },
  simulatedCommit: {
    simulated: true,
    result: {
      loopId: 'legacy-run-1',
      turnId: 'shadow-turn-1',
      inputStateVersion: 0,
      outputStateVersion: 1,
      commitStatus: 'committed',
      confirmedEventIds: [],
    },
  },
  metrics: {
    schemaSuccessRate: 1,
    permissionLeakCount: 0,
    specialistReplacementRate: 0,
    fallbackRate: 0,
    highRiskDecisions: { pass: 0, defer: 0, reject: 0 },
    semanticEquivalent: true,
    compilerDurationMs: 1,
    secondWaveDurationMs: 1,
    timedOutCallCount: 0,
  },
  replay: {},
} as unknown as ShadowRunReport;

let waveInputState = state;
let waveInputFactAuthorizationMode: string | undefined;
let waveInputPrecompiledBrief: TurnBrief | undefined;
let finalizeInput: FinalizeShadowRunInput | undefined;
const store = new ShadowReportStore(5);
const coordinator = createShadowRunCoordinator({
  adapters: {
    semanticCompiler: { compile: async () => { throw new Error('unused test adapter'); } },
    mainWorldModel: async () => ({ proposals: [] }),
    specialists: [],
  },
  store,
  deadlineMs: 6_000,
  compilerTimeoutMs: 800,
  mainFactAuthorizationMode: 'advisory_for_reversible_player',
  now: () => new Date('2026-07-20T12:00:00.000Z'),
  createTurnId: () => 'shadow-turn-1',
  runCandidateWave: async (input) => {
    waveInputState = input.state;
    waveInputFactAuthorizationMode = input.mainFactAuthorizationMode;
    waveInputPrecompiledBrief = input.precompiledBrief;
    return {
      status: 'completed',
      envelope: input.envelope,
      semantic: { status: 'compiled', durationMs: 1, issues: [] },
      mainProposals: [],
      specialistCandidates: [],
      callRecords: [],
      completedAt: new Date('2026-07-20T12:00:01.000Z'),
    } as ShadowCandidateWave;
  },
  finalize: (input) => {
    finalizeInput = input;
    return report;
  },
});

const prefetchedBrief: TurnBrief = {
  loopId: 'prefetch-loop',
  turnId: 'prefetch-turn',
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:05.000Z',
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
  utteranceMode: 'command',
  resolvedReferences: [],
  orderedActions: [],
  globalConstraints: [],
  scopedConstraints: [],
  communications: [],
  candidateHandles: [],
  ambiguities: [],
};
const session = coordinator.start({ rawInput: 'wait', state, precompiledBrief: prefetchedBrief });
assert.notEqual(waveInputState, state, 'Shadow must run from a detached legacy-state snapshot');
assert.equal(waveInputFactAuthorizationMode, 'advisory_for_reversible_player');
assert.equal(waveInputPrecompiledBrief, prefetchedBrief);
assert.equal(session.envelope.loopId, `legacy-run-${state.run}`);
assert.equal(session.envelope.turnId, 'shadow-turn-1');
assert.equal(session.envelope.inputStateVersion, deriveLegacyShadowStateVersion(state));
assert.equal(session.envelope.deadlineAt, '2026-07-20T12:00:06.000Z');
assert.equal(store.get(session.envelope.turnId)?.status, 'pending');

await coordinator.complete(session, resolution);
assert.equal(store.get(session.envelope.turnId)?.status, 'completed');
assert.equal(store.get(session.envelope.turnId)?.payload?.kind, 'completed');
assert.equal(finalizeInput?.current.loopId, `legacy-run-${resolution.finalState.run}`);
assert.equal(finalizeInput?.current.stateVersion, session.envelope.inputStateVersion);
assert.deepEqual(finalizeInput?.current.committedTurnIds, []);
assert.ok(finalizeInput?.legacyEvents.some((event) => event.eventType === 'rule.action'));

const domainResolution = structuredClone(resolution) as TurnResolution & {
  playerResult: TurnResolution['playerResult'] & {
    domainEvents: Array<{
      id: string;
      eventType: string;
      subject: string;
      facts: string[];
    }>;
  };
};
domainResolution.playerResult.domainEvents = [{
  id: 'domain-1',
  eventType: 'player_waited',
  subject: 'player',
  facts: ['player waited'],
}];
assert.deepEqual(legacyEventsFromResolution(domainResolution, 'turn-domain'), [{
  id: 'domain-1',
  eventType: 'player_waited',
  subject: 'player',
  facts: ['player waited'],
}]);

const unavailableStore = new ShadowReportStore(2);
const unavailableCoordinator = createShadowRunCoordinator({
  adapters: {
    semanticCompiler: { compile: async () => { throw new Error('unused test adapter'); } },
    mainWorldModel: async () => ({ proposals: [] }),
    specialists: [],
  },
  store: unavailableStore,
  createTurnId: () => 'shadow-unavailable',
  runCandidateWave: async (input) => ({
    status: 'compiler_unavailable',
    envelope: input.envelope,
    semantic: { status: 'timed_out', durationMs: 10, issues: ['timeout'] },
    mainProposals: [],
    specialistCandidates: [],
    callRecords: [],
    completedAt: new Date(),
  }),
});
const unavailableSession = unavailableCoordinator.start({ rawInput: 'wait', state });
await unavailableCoordinator.complete(unavailableSession, resolution);
assert.equal(unavailableStore.get('shadow-unavailable')?.payload?.kind, 'compiler_unavailable');

let latestFinalizeInput: FinalizeShadowRunInput | undefined;
let nextId = 0;
const latestCoordinator = createShadowRunCoordinator({
  adapters: {
    semanticCompiler: { compile: async () => { throw new Error('unused test adapter'); } },
    mainWorldModel: async () => ({ proposals: [] }),
    specialists: [],
  },
  store: new ShadowReportStore(3),
  createTurnId: () => `shadow-latest-${nextId += 1}`,
  runCandidateWave: async (input) => ({
    status: 'completed',
    envelope: input.envelope,
    semantic: { status: 'compiled', durationMs: 1, issues: [] },
    mainProposals: [],
    specialistCandidates: [],
    callRecords: [],
    completedAt: new Date(),
  } as ShadowCandidateWave),
  finalize: (input) => {
    latestFinalizeInput = input;
    return report;
  },
});
const oldLoopSession = latestCoordinator.start({ rawInput: 'wait', state });
latestCoordinator.start({ rawInput: 'new loop', state: { ...state, run: state.run + 1 } });
await latestCoordinator.complete(oldLoopSession, resolution);
assert.equal(
  latestFinalizeInput?.current.loopId,
  `legacy-run-${state.run + 1}`,
  'late Shadow completion must be compared with the latest observed loop',
);

nextId = 0;
const evictionCoordinator = createShadowRunCoordinator({
  adapters: {
    semanticCompiler: { compile: async () => { throw new Error('unused test adapter'); } },
    mainWorldModel: async () => ({ proposals: [] }),
    specialists: [],
  },
  store: new ShadowReportStore(1),
  createTurnId: () => `shadow-evicted-${nextId += 1}`,
  runCandidateWave: async (input) => ({
    status: 'compiler_unavailable',
    envelope: input.envelope,
    semantic: { status: 'clarification_required', durationMs: 1, issues: ['clarify'] },
    mainProposals: [],
    specialistCandidates: [],
    callRecords: [],
    completedAt: new Date(),
  }),
});
const evictedSession = evictionCoordinator.start({ rawInput: 'old', state });
evictionCoordinator.start({ rawInput: 'new', state });
await assert.doesNotReject(
  () => evictionCoordinator.complete(evictedSession, resolution),
  'report eviction must not create an unhandled background rejection',
);
