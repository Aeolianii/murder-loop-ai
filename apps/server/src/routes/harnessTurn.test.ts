import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  createInitialGameState,
  createInitialWorldState,
  prepareLowRiskTurn,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import type { TurnBrief } from '@murder-loop-ai/ai-contracts';
import type { ActionAudioCue, ActionPlan, GameState, KillerStrategy, Narration, TurnResolution } from '@murder-loop-ai/shared';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy } from '../ai/turnCoordinator';
import type { ShadowRunCoordinator } from '../shadow/shadowCoordinator';
import type { LowRiskTakeoverService } from '../takeover/lowRiskTakeoverService';
import { harnessTurnRoute } from './harnessTurn';

function registerTestHarnessRoute(
  app: ReturnType<typeof Fastify>,
  options: NonNullable<Parameters<typeof harnessTurnRoute>[1]>,
) {
  return app.register(harnessTurnRoute, {
    selectActionAudioCue: async () => null,
    shadowCoordinator: null,
    lowRiskTakeoverService: null,
    ...options,
  });
}

type HarnessTurnResolution = TurnResolution & {
  coordination: {
    warnings: string[];
    trace: Array<{
      taskId: string;
      agentId: string;
      source: string;
      decision?: string;
      warnings: string[];
      durationMs: number;
    }>;
    agentTiming: {
      totalMs: number;
      slowest: {
        taskId: string;
        agentId: string;
        source: string;
        durationMs: number;
      } | null;
      entries: Array<{
        taskId: string;
        agentId: string;
        source: string;
        durationMs: number;
      }>;
    };
    judgements: Record<string, unknown>;
  };
};

const baseState = createInitialGameState();
const finalState = {
  ...baseState,
  log: [
    ...baseState.log,
    {
      id: 'log-1',
      run: baseState.run,
      minute: baseState.minute,
      title: 'Message reply',
      text: 'The unknown number replies with another question about the package.',
      tone: 'threat' as const,
      channel: 'ambient' as const,
    },
  ],
};

const resolution = {
  plan: {
    id: 'plan-1',
    raw: 'reply to Chen',
    summary: 'Reply to Chen',
    actions: [
      {
        id: 'action-1',
        raw: 'reply to Chen',
        intent: 'communicate' as const,
        target: 'chen_huaimin' as const,
        confidence: 0.9,
        timeCost: 1,
        noise: 0,
        risk: 'medium' as const,
      },
    ],
    confidence: 0.9,
    warnings: [],
  },
  playerResult: {
    title: 'Action',
    text: 'Action complete',
    tone: 'neutral' as const,
    addedClues: [],
    timePassed: 1,
    threatDelta: 0,
    events: [],
    state: baseState,
  },
  killerStrategy: {
    id: 'strategy-1',
    type: 'message_reply' as const,
    title: 'Message reply',
    rationale: 'Continue the conversation',
    visibleToPlayer: true,
    risk: 'medium' as const,
  },
  killerResult: {
    title: 'Message reply',
    text: 'The unknown number replies with another question about the package.',
    tone: 'threat' as const,
    addedClues: [],
    timePassed: 0,
    threatDelta: 4,
    events: [],
    state: finalState,
  },
  narration: {
    title: 'Action',
    text: 'Action complete',
  },
  finalState,
  coordination: {
    warnings: [],
    trace: [
      {
        taskId: 'PlayerActionSubmitted',
        agentId: 'parser',
        source: 'game-core-harness',
        warnings: [],
        durationMs: 1,
      },
    ],
    agentTiming: {
      totalMs: 1,
      slowest: {
        taskId: 'PlayerActionSubmitted',
        agentId: 'parser',
        source: 'game-core-harness',
        durationMs: 1,
      },
      entries: [
        {
          taskId: 'PlayerActionSubmitted',
          agentId: 'parser',
          source: 'game-core-harness',
          durationMs: 1,
        },
      ],
    },
    judgements: {},
  },
} satisfies HarnessTurnResolution;

async function testHarnessTurnRouteReturnsFrontendPackage() {
  const app = Fastify({ logger: false });
  let calledWith: { stateMinute: number; input: string } | null = null;
  const selectedAudioCue: ActionAudioCue = {
    id: 'audio-plan-1',
    soundId: 'phone_msg',
    confidence: 0.91,
    reason: '回复消息的主音效最明确',
    source: 'ai',
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async (input: string, state: GameState) => {
          calledWith = { stateMinute: state.minute, input };
          return resolution.plan;
        },
        chooseKillerStrategy: async () => resolution.killerStrategy,
        narrateAction: async () => resolution.narration,
        narrateAmbient: async () => ({ title: 'Message reply', text: 'The unknown number replies with another question about the package.' }),
      },
      coordination: { warnings: [], judgements: {} },
    }),
    selectActionAudioCue: async () => selectedAudioCue,
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'reply to Chen',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { stateMinute: baseState.minute, input: 'reply to Chen' });

  const body = response.json();
  assert.equal(body.time, '23:01');
  assert.equal(body.location, '青荷公寓 503 室');
  assert.equal(body.phase, 'investigating');
  assert.ok(Array.isArray(body.clues));
  assert.equal(body.coreState.log.at(-1).title, 'Message reply');
  assert.equal(body.storyLog[0].type, 'player_input');
  assert.equal(body.storyLog[1].type, 'action_result');
  assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');
  assert.equal(body.coordination.agentTiming.entries[0].agentId, 'parser');
  assert.equal(body.coordination.agentTiming.entries[0].taskId, 'PlayerActionSubmitted');
  assert.equal(typeof body.coordination.agentTiming.totalMs, 'number');
  assert.ok(body.coordination.agentTiming.totalMs >= body.coordination.agentTiming.entries[0].durationMs);
  assert.ok(body.coordination.agentTiming.slowest);
  assert.equal(body.agentTrace[0].agent, 'parser');
  assert.equal(body.agentTrace[0].mode, 'ai');
  assert.equal(body.agentTrace[0].validation.valid, true);
  assert.equal(body.audioCue.soundId, 'phone_msg');
  assert.equal(body.audioCue.confidence, 0.91);

  await app.close();
}

async function testHarnessTurnDoesNotWaitForShadowCompletion() {
  const app = Fastify({ logger: false });
  let completeCalled = false;
  const neverCompletes = new Promise<void>(() => undefined);
  const shadowCoordinator: ShadowRunCoordinator = {
    start: ({ state }) => ({
      envelope: {
        loopId: `legacy-run-${state.run}`,
        turnId: 'shadow-nonblocking',
        inputStateVersion: 0,
        deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      },
      wave: Promise.resolve({} as never),
    }),
    complete: () => {
      completeCalled = true;
      return neverCompletes;
    },
  };

  await registerTestHarnessRoute(app, {
    shadowCoordinator,
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => resolution.plan,
        chooseKillerStrategy: async () => resolution.killerStrategy,
        narrateAction: async () => resolution.narration,
        narrateAmbient: async () => resolution.narration,
      },
    }),
  });

  const response = await Promise.race([
    app.inject({
      method: 'POST',
      url: '/api/harness/turn',
      payload: { input: 'wait', state: baseState },
    }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('formal route waited for Shadow completion')), 250);
    }),
  ]);

  assert.equal(response.statusCode, 200);
  assert.equal(completeCalled, true);
  assert.deepEqual(response.json().coordination.shadowRun, {
    turnId: 'shadow-nonblocking',
    status: 'scheduled',
  });
  await app.close();
}

function takeoverBrief(): TurnBrief {
  return {
    loopId: 'legacy-run-1',
    turnId: 'takeover-route-turn',
    inputStateVersion: baseState.log.length,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [{
      actionId: 'secure-door',
      actorId: 'player',
      operation: 'secure_entry',
      targetIds: ['front_door', 'chair'],
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: 11, text: 'secure door' },
    }],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

function takeoverPhotoShareBrief(): TurnBrief {
  const brief = takeoverBrief();
  brief.turnId = 'takeover-photo-share-turn';
  brief.orderedActions = [{
    actionId: 'photo-package',
    actorId: 'player',
    operation: 'photograph',
    targetIds: ['package'],
    dependsOnActionIds: [],
    inputHandleIds: [],
    outputHandleIds: ['handle-package-photo'],
    originalSpan: { start: 0, end: 7, text: '给包裹拍张照片' },
  }, {
    actionId: 'message-linyue',
    actorId: 'player',
    operation: 'communicate',
    targetIds: ['lin_yue'],
    dependsOnActionIds: ['photo-package'],
    inputHandleIds: ['handle-package-photo'],
    outputHandleIds: [],
    originalSpan: { start: 8, end: 28, text: '发给林越，询问这个包裹是不是他的' },
  }];
  brief.communications = [{
    id: 'communication-linyue-photo',
    actionId: 'message-linyue',
    senderId: 'player',
    recipientIds: ['lin_yue'],
    channel: 'phone',
    contentSummary: '询问这个包裹是不是林越的',
    attachmentHandleIds: ['handle-package-photo'],
    intendedAudience: ['lin_yue'],
  }];
  brief.candidateHandles = [{
    id: 'handle-package-photo',
    kind: 'photograph',
    producedByActionId: 'photo-package',
    dependsOnActionIds: ['photo-package'],
  }];
  return brief;
}

function takeoverFixture(
  commitStatus: 'committed' | 'conflict' | 'failed' = 'committed',
  withKnowledgeClueProjection = false,
  withHighRiskProjection = false,
  withLegacyMainPathExit = false,
  withRecommendations = false,
  brief = takeoverBrief(),
) {
  const prepared = prepareLowRiskTurn({
    state: baseState,
    brief,
    sourceProposalId: 'proposal.player.route',
  });
  if (prepared.status !== 'prepared') throw new Error('expected route takeover fixture');
  let parserCalls = 0;
  let killerStrategyCalls = 0;
  let actionNarrationCalls = 0;
  let ambientNarrationCalls = 0;
  let completeCalls = 0;
  let committedFinalState: GameState | undefined;
  const shadowCoordinator: ShadowRunCoordinator = {
    start: () => ({ envelope: prepared.envelope, wave: Promise.resolve({} as never) }),
    complete: async () => { completeCalls += 1; },
  };
  const lowRiskTakeoverService: LowRiskTakeoverService & {
    legacyMainPathExitEnabled: boolean;
  } = {
    legacyMainPathExitEnabled: withLegacyMainPathExit,
    prepare: async () => ({
      status: 'prepared',
      prepared,
      recommendedActions: withRecommendations
        ? [{
            id: 'recommendation.accepted',
            label: 'Photograph the package label.',
            rationale: 'Preserve visible evidence before taking another action.',
          }, {
            id: 'recommendation.stale-after-commit',
            label: 'Use stale pre-commit advice.',
            rationale: 'This must be removed when its cited fact changes.',
          }]
        : [],
    }),
    commit: async (_turnId, candidateState) => {
      committedFinalState = candidateState;
      const committedState = withHighRiskProjection
        ? {
            ...structuredClone(prepared.playerResult.state),
            player: {
              ...prepared.playerResult.state.player,
              injury: 'critical' as const,
            },
            log: [
              ...prepared.playerResult.state.log,
              {
                id: 'log-phase5-confirmed-injury',
                run: prepared.playerResult.state.run,
                minute: prepared.playerResult.state.minute,
                title: 'Injury confirmed',
                text: 'A critical injury was confirmed, but no death or ending was confirmed.',
                tone: 'threat' as const,
                channel: 'ambient' as const,
              },
            ],
          }
        : candidateState;
      return {
        outcome: {
          result: {
            loopId: prepared.envelope.loopId,
            turnId: prepared.envelope.turnId,
            inputStateVersion: prepared.envelope.inputStateVersion,
            outputStateVersion: commitStatus === 'committed' ? prepared.envelope.inputStateVersion + 1 : null,
            commitStatus,
            confirmedEventIds: commitStatus === 'committed'
              ? prepared.eventCandidates.map((candidate) => candidate.event.id)
              : [],
          },
          confirmedEvents: [],
          displayFragments: commitStatus === 'committed'
            ? [
                ...prepared.displayFragments,
                ...(withHighRiskProjection ? [{
                  id: 'display.phase5.confirmed-injury',
                  text: 'A critical injury was confirmed, but no death or ending was confirmed.',
                  eventRefs: ['event.phase5.confirmed-injury'],
                  claimRefs: ['injury:critical'],
                }] : []),
              ]
            : [],
          ...(commitStatus === 'conflict'
            ? { discardReason: 'state_version_conflict' as const }
            : commitStatus === 'failed'
              ? { discardReason: 'persistence_failed' as const }
              : {}),
        },
        state: commitStatus === 'committed' ? committedState : undefined,
        recommendedActions: commitStatus === 'committed' && withRecommendations
          ? [{
              id: 'recommendation.accepted',
              label: 'Photograph the package label.',
              rationale: 'Preserve visible evidence before taking another action.',
            }]
          : [],
        ...(commitStatus === 'committed' && withKnowledgeClueProjection ? {
          knowledgeClueProjection: {
            addedObservationIds: ['observation.route.package'],
            addedKnowledgeFactIds: ['player:package_exterior_label_ambiguous'],
            addedClueIds: ['wrong_package'],
          },
        } : {}),
        ...(commitStatus === 'committed' && withHighRiskProjection ? {
          highRiskProjection: {
            acceptedEventIds: ['event.phase5.confirmed-injury'],
            correctedEventIds: [],
            deferredEventIds: ['event.phase5.unconfirmed-death'],
            rejectedEventIds: [],
            highRiskDecisions: [{
              eventId: 'event.phase5.confirmed-injury',
              riskClass: 'high_impact' as const,
              evidenceRefs: ['invariant.injury.requires_landed_attack'],
              decision: 'pass' as const,
              reasonCodes: ['causal_chain_complete', 'deterministic_evidence_present'],
            }],
          },
        } : {}),
      };
    },
    discard: () => undefined,
  };
  const aiAdapters: AiAdapters = {
    parseAction: async () => {
      parserCalls += 1;
      return resolution.plan;
    },
    chooseKillerStrategy: async () => {
      killerStrategyCalls += 1;
      return {
        id: 'killer-spare-key-takeover-route',
        type: 'spare_key_entry',
        title: 'Spare key attempt',
        rationale: 'Verify that route continuation uses the prepared door state.',
        visibleToPlayer: true,
        risk: 'high',
      } as const;
    },
    narrateAction: async () => {
      actionNarrationCalls += 1;
      return { title: 'Door secured', text: 'The door is locked, chained, and blocked.' };
    },
    narrateAmbient: async () => {
      ambientNarrationCalls += 1;
      return { title: 'Key stopped', text: 'The spare key cannot open the barricaded door.' };
    },
  };
  return {
    prepared,
    shadowCoordinator,
    lowRiskTakeoverService,
    aiAdapters,
    calls: () => ({
      parserCalls,
      killerStrategyCalls,
      actionNarrationCalls,
      ambientNarrationCalls,
      completeCalls,
      committedFinalState,
    }),
  };
}

async function testLowRiskTakeoverCommitsBeforePublishingResponse() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture();
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(fixture.calls().parserCalls, 0, 'legacy player parser/rule path must be skipped');
  assert.equal(fixture.calls().completeCalls, 1);
  assert.equal(fixture.calls().committedFinalState?.room.front_door.state.barricaded, true);
  assert.equal(body.coreState.room.front_door.state.barricaded, true);
  assert.equal(body.coreState.ending, null);
  assert.equal(body.coordination.lowRiskTakeover.status, 'committed');
  assert.equal(body.coordination.lowRiskTakeover.outputStateVersion, baseState.log.length + 1);
  assert.equal(typeof body.coordination.lowRiskTakeover.durationMs, 'number');
  assert(body.coordination.lowRiskTakeover.durationMs >= 0);
  await app.close();
}

async function testLowRiskTakeoverConflictPublishesNoStateOrStory() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('conflict');
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 409);
  const body = response.json();
  assert.equal(body.error, 'low_risk_takeover_conflict');
  assert.equal('coreState' in body, false);
  assert.equal('storyLog' in body, false);
  assert.equal(body.coordination.lowRiskTakeover.status, 'conflict');
  await app.close();
}

async function testLowRiskTakeoverPersistenceFailurePublishesNoStateOrStory() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('failed');
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 503);
  const body = response.json();
  assert.equal(body.error, 'low_risk_takeover_failed');
  assert.equal('coreState' in body, false);
  assert.equal('storyLog' in body, false);
  assert.equal(body.coordination.lowRiskTakeover.status, 'failed');
  await app.close();
}

async function testKnowledgeClueTakeoverDisablesNarratorClueAuthority() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', true);
  fixture.aiAdapters.narrateAction = async () => ({
    title: 'Invented clue',
    text: 'The narration explicitly mentions a secret note.',
    clue: {
      id: 'narrator_secret_note',
      title: 'Secret note',
      detail: 'The narration explicitly mentions a secret note.',
      weight: 99,
    },
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.coreState.clues.some((clue: { id: string }) => clue.id === 'narrator_secret_note'), false);
  assert.equal(body.coordination.knowledgeClueTakeover.status, 'committed');
  assert.equal(body.coordination.knowledgeClueTakeover.observationCount, 1);
  assert.equal(body.coordination.knowledgeClueTakeover.knowledgeUpdateCount, 1);
  assert.equal(body.coordination.knowledgeClueTakeover.clueCount, 1);
  assert.equal(body.coordination.knowledgeClueTakeover.narratorClueAuthority, 'disabled');
  await app.close();
}

async function testHighRiskTakeoverPublishesOnlyConfirmedOutcome() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, true);
  fixture.aiAdapters.narrateAmbient = async () => ({
    title: 'Untrusted fatal narration',
    text: 'Untrusted narration says the player died and the killer destroyed the package.',
    ending: 'death',
    isFatal: true,
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.coreState.player.injury, 'critical');
  assert.equal(body.coreState.ending, null, 'Narrator must not promote an unconfirmed ending after commit');
  assert.equal(body.coordination.highRiskTakeover.status, 'committed');
  assert.equal(body.coordination.highRiskTakeover.acceptedEventCount, 1);
  assert.equal(body.coordination.highRiskTakeover.deferredEventCount, 1);
  assert.equal(body.coordination.highRiskTakeover.narratorHighRiskAuthority, 'disabled');
  assert.equal(body.turn.killerStrategy.type, 'confirmed_shadow_result');
  assert.equal(body.turn.ambientNarration.text.includes('Untrusted'), false);
  assert.deepEqual(body.turn.npcReply, null);
  assert.deepEqual(body.worldTickTrace, []);
  assert.equal(
    body.storyLog.some((node: { content?: string }) => node.content?.includes('Untrusted')),
    false,
  );
  await app.close();
}

async function testLegacyMainPathExitSkipsLegacyStateStagesBeforePostCommitNarration() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, true, true);
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(fixture.calls().parserCalls, 0);
  assert.equal(fixture.calls().killerStrategyCalls, 0);
  assert.equal(fixture.calls().actionNarrationCalls, 1);
  assert.equal(fixture.calls().ambientNarrationCalls, 1);
  assert.equal(body.coreState.player.injury, 'critical');
  assert.equal(body.turn.killerStrategy.type, 'confirmed_shadow_result');
  assert.equal(body.coordination.legacyMainPathExit.status, 'committed');
  assert.equal(body.coordination.legacyMainPathExit.storyNodeAuthority, 'confirmed_facts_narrator');
  assert.equal(body.coordination.legacyMainPathExit.keywordFallbackAuthority, 'disabled');
  await app.close();
}

async function testLegacyMainPathExitPublishesAcceptedRecommendations() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, false, true, true);
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const actionResult = body.storyLog.find(
    (node: { type: string }) => node.type === 'action_result',
  );
  assert.deepEqual(actionResult?.recommendedActions, [{
    id: 'recommendation.accepted',
    label: 'Photograph the package label.',
    rationale: 'Preserve visible evidence before taking another action.',
  }]);
  await app.close();
}

async function testLegacyMainPathExitRendersReadOnlyPostCommitNarration() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, false, true, true);
  fixture.aiAdapters.narrateAction = async (context) => {
    assert.equal(
      context.stateSnapshot.phase,
      fixture.prepared.playerResult.state.phase,
      'post-commit narration should receive the committed state snapshot',
    );
    assert.ok(
      context.confirmedFacts.some((fact) => fact.summary.includes('Locked')),
      'post-commit narration should receive confirmed player facts',
    );
    return {
      title: 'Door secured',
      text: 'The deadbolt slides home and the chain settles against the door.',
    };
  };
  fixture.aiAdapters.narrateAmbient = async () => ({
    title: 'Hallway response',
    text: 'A muted footstep stops beyond the door, then the corridor falls quiet again.',
    ending: 'death',
    isFatal: true,
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const actionIndex = body.storyLog.findIndex(
    (node: { type: string; content: string }) => (
      node.type === 'action_result'
      && node.content.includes('The deadbolt slides home')
    ),
  );
  const ambientIndex = body.storyLog.findIndex(
    (node: { type: string; content: string }) => (
      node.type === 'narrative'
      && node.content.includes('A muted footstep stops')
    ),
  );
  assert.ok(actionIndex >= 0, 'Narrator action prose should replace the material-only action result');
  assert.ok(ambientIndex > actionIndex, 'ambient narration should follow the action result and its recommendations');
  assert.deepEqual(body.storyLog[actionIndex].recommendedActions, [{
    id: 'recommendation.accepted',
    label: 'Photograph the package label.',
    rationale: 'Preserve visible evidence before taking another action.',
  }]);
  assert.equal(
    body.coreState.log.some((entry: { text: string }) => entry.text.includes('The deadbolt slides home')),
    false,
    'post-commit prose must not mutate the authoritative state log',
  );
  assert.equal(body.coreState.ending, null);
  assert.equal(body.turn.ambientNarration.ending, undefined);
  assert.equal(body.turn.ambientNarration.isFatal, undefined);
  assert.ok(
    body.coordination.warnings.some((warning: string) => warning.includes('authority fields ignored')),
  );
  assert.equal(body.coordination.legacyMainPathExit.storyNodeAuthority, 'confirmed_facts_narrator');
  await app.close();
}

async function testLegacyMainPathExitRejectsUngroundedActionNarration() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, false, true);
  fixture.aiAdapters.narrateAction = async () => ({
    title: '错误的包裹动作',
    text: '我撕开封口，翻开包裹里的旧书和药板。',
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const actionResult = body.storyLog.find((node: { type: string }) => node.type === 'action_result');
  assert.match(actionResult?.content ?? '', /你锁好并加固了门/);
  assert.doesNotMatch(actionResult?.content ?? '', /撕开封口|翻开包裹/);
  assert.ok(
    body.coordination.warnings.some((warning: string) => warning.includes('not grounded')),
  );
  await app.close();
}

async function testLegacyMainPathExitPublishesConfirmedNpcReply() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture(
    'committed',
    false,
    false,
    true,
    false,
    takeoverPhotoShareBrief(),
  );
  let npcReplyCalls = 0;
  fixture.aiAdapters.narrateAction = async () => ({
    title: '错误的包裹动作',
    text: '我撕开封口，翻开包裹里的旧书和药板。',
  });
  fixture.aiAdapters.npcReply = async (speaker, input) => {
    npcReplyCalls += 1;
    assert.equal(speaker, 'linyue');
    assert.match(input, /林越|包裹/);
    return {
      speaker: 'linyue',
      text: '这不是我的包裹。你别开门，把照片留好。',
      intent: 'deny_package_and_assist',
      riskWarning: '不要让林越上楼。',
      suggestedExternalAction: '让林越在楼下报警。',
    };
  };
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '给包裹拍张照片，并发给林越，询问这个包裹是不是他的',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(npcReplyCalls, 1);
  assert.equal(body.turn.npcReply?.speaker, 'linyue');
  assert.match(body.turn.npcReply?.text ?? '', /不是我的包裹/);
  const actionResult = body.storyLog.find((node: { type: string }) => node.type === 'action_result');
  assert.match(actionResult?.content ?? '', /你拍下了包裹的照片/);
  assert.match(actionResult?.content ?? '', /发送给林越/);
  assert.doesNotMatch(actionResult?.content ?? '', /撕开封口|翻开包裹/);
  assert.match(actionResult?.content ?? '', /林越回复|不是我的包裹/);
  await app.close();
}

async function testLegacyMainPathExitKeepsConfirmedMaterialWhenNarratorFails() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, true, true);
  fixture.aiAdapters.narrateAction = async () => {
    throw new Error('action narrator unavailable');
  };
  fixture.aiAdapters.narrateAmbient = async () => {
    throw new Error('ambient narrator unavailable');
  };
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'lock and barricade the door', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.storyLog.some((node: { type: string; content: string }) => (
      node.type === 'action_result'
      && node.content.includes('Locked, chained, and barricaded the front door.')
    )),
    'confirmed action material should remain visible when action narration fails',
  );
  assert.ok(
    body.storyLog.some((node: { type: string; content: string }) => (
      node.type === 'narrative'
      && node.content.includes('A critical injury was confirmed')
    )),
    'confirmed external material should remain visible when ambient narration fails',
  );
  assert.equal(body.coordination.legacyMainPathExit.storyNodeAuthority, 'material_only');
  assert.ok(
    body.coordination.warnings.some((warning: string) => warning.includes('confirmed material remains visible')),
  );
  await app.close();
}

async function testLegacyMainPathExitUsesMinimumFallbackOnlyWhenAiIsUnavailable() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, true, true);
  fixture.lowRiskTakeoverService.prepare = async () => ({
    status: 'bypassed',
    reason: 'shadow_incomplete',
    fallbackMode: 'ai_unavailable',
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: '打开包裹然后冲出门', state: baseState },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(fixture.calls().parserCalls, 0);
  assert.equal(fixture.calls().killerStrategyCalls, 0);
  assert.equal(fixture.calls().actionNarrationCalls, 0);
  assert.equal(fixture.calls().ambientNarrationCalls, 0);
  assert.equal(body.coreState.minute, baseState.minute);
  assert.equal(body.coreState.room.package.state.opened, false);
  assert.equal(body.coreState.room.front_door.state.opened, false);
  assert.equal(body.turn.killerStrategy.type, 'minimum_playable_hold');
  assert.equal(body.coordination.legacyMainPathExit.status, 'offline_fallback');
  await app.close();
}

async function testLegacyMainPathExitRejectsInvalidFormalTurnWithoutLegacyFallback() {
  const app = Fastify({ logger: false });
  const fixture = takeoverFixture('committed', false, true, true);
  fixture.lowRiskTakeoverService.prepare = async () => ({
    status: 'bypassed',
    reason: 'arbitration_not_clean',
    fallbackMode: 'formal_rejection',
  });
  await registerTestHarnessRoute(app, {
    shadowCoordinator: fixture.shadowCoordinator,
    lowRiskTakeoverService: fixture.lowRiskTakeoverService,
    createAiAdapters: () => ({ aiAdapters: fixture.aiAdapters }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: { input: 'open the package', state: baseState },
  });

  assert.equal(response.statusCode, 503);
  const body = response.json();
  assert.equal(body.error, 'ai_first_turn_rejected');
  assert.equal('coreState' in body, false);
  assert.equal(fixture.calls().parserCalls, 0);
  assert.equal(fixture.calls().killerStrategyCalls, 0);
  assert.equal(fixture.calls().actionNarrationCalls, 0);
  assert.equal(fixture.calls().ambientNarrationCalls, 0);
  assert.equal(body.coordination.legacyMainPathExit.status, 'not_committed');
  await app.close();
}

async function testDefaultHarnessRouteReturnsDispatcherTrace() {
  const app = Fastify({ logger: false });

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({ aiAdapters: {} }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'look around',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');
  assert.notEqual(body.coordination.trace[0].source, 'game-core-harness');
  assert.equal(body.agentTrace[0].agent, 'parser');
  assert.ok(['ai', 'fallback'].includes(body.agentTrace[0].mode));
  assert.deepEqual(
    body.coordination.warnings,
    body.coordination.trace.flatMap((entry: { warnings: string[] }) => entry.warnings),
  );

  await app.close();
}

async function testDefaultHarnessRouteInjectsAiAdapters() {
  const app = Fastify({ logger: false });
  const aiPlan: ActionPlan = {
    id: 'ai-plan',
    raw: 'check head injury',
    summary: 'Check the back of my head for an injury',
    actions: [
      {
        id: 'ai-action',
        raw: 'check head injury',
        intent: 'self_care',
        target: 'self',
        method: 'touch the back of my head and check for bleeding',
        confidence: 0.93,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.93,
    warnings: [],
  };
  const aiStrategy: KillerStrategy = {
    id: 'ai-strategy',
    type: 'wait_for_fatigue',
    title: 'Wait outside',
    rationale: 'The player has not exposed new information.',
    visibleToPlayer: true,
    risk: 'low',
  };
  const actionNarration: Narration = {
    title: 'Checked wound',
    text: 'Your fingers find the sore spot behind your head.',
  };
  const ambientNarration: Narration = {
    title: 'Hallway pause',
    text: 'The hallway stays quiet for another breath.',
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => aiPlan,
        chooseKillerStrategy: async () => aiStrategy,
        narrateAction: async () => actionNarration,
        narrateAmbient: async () => ambientNarration,
      },
      coordination: {
        warnings: ['adapter factory used'],
        judgements: {
          facts: { source: 'test' },
        },
      },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'check head injury',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.turn.plan.actions[0].intent, 'self_care');
  assert.equal(body.turn.actionNarration.title, 'Checked wound');
  assert.equal(body.turn.ambientNarration.title, 'Hallway pause');
  assert.equal(body.coordination.trace[0].source, 'ai');
  assert.ok(body.coordination.warnings.includes('adapter factory used'));

  await app.close();
}

async function testWorldTickRunsAsProductCapabilityForRoute() {
  const app = Fastify({ logger: false });
  const createState = (): GameState => {
    const worldState = createInitialWorldState();
    worldState.characters.chen_huaimin.location = 'corridor_5f';
    worldState.characters.lin_yue.location = 'corridor_5f';

    return {
      ...baseState,
      world: worldState,
    };
  };
  const aiPlan: ActionPlan = {
    id: 'world-tick-plan',
    raw: 'photograph the package and send it to Lin Yue',
    summary: 'Preserve package evidence and tell Lin Yue',
    actions: [
      {
        id: 'photo-package',
        raw: 'photograph the package',
        intent: 'preserve_evidence',
        target: 'package',
        method: 'take a clear photo of the package contents',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
      {
        id: 'send-linyue',
        raw: 'send it to Lin Yue',
        intent: 'communicate',
        target: 'linyue',
        method: 'send Lin Yue the package photo',
        confidence: 0.95,
        timeCost: 1,
        noise: 0,
        risk: 'medium',
      },
    ],
    confidence: 0.95,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => aiPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-wait',
          type: 'wait_for_fatigue',
          title: 'Wait outside',
          rationale: 'Keep watching for what the player does with the evidence.',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: 'Evidence sent',
          text: 'The package photo leaves the phone and reaches Lin Yue.',
        }),
        narrateAmbient: async () => ({
          title: 'Hallway pressure',
          text: 'The corridor outside tightens around the new evidence.',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const defaultResponse = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'photograph the package and send it to Lin Yue',
      state: createState(),
    },
  });

  assert.equal(defaultResponse.statusCode, 200);
  const defaultBody = defaultResponse.json();
  assert.equal(
    defaultBody.coreState.world.events.some((event: { id: string }) => event.id === 'conflict.chen_intercepts_linyue'),
    true,
    'World tick should advance as a normal product capability',
  );
  assert.ok(defaultBody.worldTickTrace.some((event: { id: string }) => event.id === 'conflict.chen_intercepts_linyue'));

  const tickEventIds = defaultBody.worldTickTrace.map((event: { id: string }) => event.id);
  assert.ok(tickEventIds.includes('conflict.chen_intercepts_linyue'));
  assert.equal(tickEventIds.some((id: string) => id.startsWith('input.')), false);
  assert.notEqual(
    defaultBody.coreState.linYuePhase,
    'endangered',
    'World tick should not write back into legacy GameState fields yet',
  );

  await app.close();
}

async function testFatalNarrationIsOnlyAProposal() {
  const app = Fastify({ logger: false });
  const aiPlan: ActionPlan = {
    id: 'ai-plan',
    raw: 'check head injury',
    summary: 'Check the back of my head for an injury',
    actions: [
      {
        id: 'ai-action',
        raw: 'check head injury',
        intent: 'self_care',
        target: 'self',
        method: 'touch the back of my head and check for bleeding',
        confidence: 0.93,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.93,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => aiPlan,
        chooseKillerStrategy: async () => ({
          id: 'ai-strategy',
          type: 'wait_for_fatigue',
          title: 'Wait outside',
          rationale: 'The player has not exposed new information.',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: 'Checked wound',
          text: 'Your fingers find a sore spot, but nothing in the rule events says this is fatal.',
          isFatal: true,
        }),
        narrateAmbient: async () => ({
          title: 'Hallway pause',
          text: 'The hallway stays quiet for another breath.',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'check head injury',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.notEqual(body.coreState.phase, 'death');
  assert.ok(
    body.coordination.warnings.some((warning: string) => warning.includes('fatal narration proposal ignored')),
    'fatal narration should be reported but not applied directly',
  );
  assert.equal(body.deathMethod, null);

  await app.close();
}

async function testNarratedEscapeEndingIsOnlyAProposalEvenWhenPlausible() {
  const app = Fastify({ logger: false });
  const escapePlan: ActionPlan = {
    id: 'escape-plan',
    raw: '冲出门跑去楼下手机店',
    summary: '冲出门逃离 503',
    actions: [
      {
        id: 'escape-action',
        raw: '冲出门跑去楼下手机店',
        intent: 'escape',
        target: 'front_door',
        method: '冲出门一路跑下楼',
        confidence: 0.96,
        timeCost: 1,
        noise: 2,
        risk: 'high',
      },
    ],
    confidence: 0.96,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => escapePlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-retreat',
          type: 'retreat',
          title: '脚步慢了一拍',
          rationale: '玩家已经脱离门口位置。',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: '便利店白光',
          text: '你一口气冲下楼，街角手机店还亮着灯。自动门滑开时，503 和门外那串脚步声终于被你甩在雨夜后面。',
          ending: 'escaped_no_evidence',
        }),
        narrateAmbient: async () => ({
          title: '楼道被抛在身后',
          text: '雨点追着你落下去，楼上的声控灯没有再亮。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '冲出门跑去楼下手机店',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.notEqual(body.coreState.ending, 'escaped_no_evidence');
  assert.ok(body.coordination.warnings.some((warning: string) => warning.includes('narrated ending proposal ignored')));

  await app.close();
}

async function testNarratedEscapeEndingIsRejectedWhenOnlyPlayerClaimsIt() {
  const app = Fastify({ logger: false });
  const bluffPlan: ActionPlan = {
    id: 'bluff-plan',
    raw: '我已经逃到手机店了',
    summary: '检查自己是否受伤',
    actions: [
      {
        id: 'bluff-action',
        raw: '我已经逃到手机店了',
        intent: 'self_care',
        target: 'self',
        method: '摸了一下后脑勺',
        confidence: 0.9,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.9,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => bluffPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-wait',
          type: 'wait_for_fatigue',
          title: '门外没动',
          rationale: '没有发生足以结局化的位移。',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: '只是一个念头',
          text: '你嘴里挤出那句“我已经逃到手机店了”，可手指摸到的还是后脑勺的钝痛，房间和门锁都还在原地。',
          ending: 'escaped_no_evidence',
        }),
        narrateAmbient: async () => ({
          title: '门外没走',
          text: '楼道里没有传来你期待中的远离声，只有雨声贴着窗。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '我已经逃到手机店了',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.notEqual(body.coreState.ending, 'escaped_no_evidence');
  assert.ok(body.coordination.warnings.some((warning: string) => warning.includes('narrated ending proposal ignored')));

  await app.close();
}

async function testThreatEventsDoNotBecomeDynamicCluesWithoutExplicitEvidence() {
  const app = Fastify({ logger: false });
  const inspectPlan: ActionPlan = {
    id: 'inspect-plan',
    raw: '贴在门边听外面的动静',
    summary: '贴在门边听外面的动静',
    actions: [
      {
        id: 'inspect-action',
        raw: '贴在门边听外面的动静',
        intent: 'inspect',
        target: 'front_door',
        method: '靠近门边听外面的声音',
        confidence: 0.9,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.9,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => inspectPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-soft',
          type: 'landlord_excuse',
          title: '门外的试探',
          rationale: '继续在门外试探开门反应。',
          visibleToPlayer: true,
          risk: 'medium',
        }),
        narrateAction: async () => ({
          title: '贴门听动静',
          text: '门外的脚步声若有若无，楼道里像有人停了一下。',
        }),
        narrateAmbient: async () => ({
          title: '楼道回音',
          text: '楼道声控灯灭了又亮，雨声盖住了更多细节。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '贴在门边听外面的动静',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    !body.clues.some((clue: { description?: string; name?: string }) =>
      `${clue.name ?? ''}${clue.description ?? ''}`.includes('漏水检查')),
    'generic threat events should not be promoted into dynamic clues',
  );

  await app.close();
}

async function testNarrationClueIsAcceptedOnlyWhenVisibleTextExplicitlyMentionsIt() {
  const app = Fastify({ logger: false });
  const inspectPlan: ActionPlan = {
    id: 'explicit-clue-plan',
    raw: '重新看看包裹里的旧书',
    summary: '重新检查包裹里的旧书和药板',
    actions: [
      {
        id: 'inspect-explicit-clue',
        raw: '重新看看包裹里的旧书',
        intent: 'inspect',
        target: 'package',
        method: '翻看包裹里的旧书和药板',
        confidence: 0.94,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.94,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => inspectPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-wait',
          type: 'wait_for_fatigue',
          title: '门外停住了',
          rationale: '玩家在屋内继续检查包裹，门外暂时保持观察。',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: '旧书内侧的字',
          text: '我把旧书封皮掀开，看到内侧有一行铅笔写的字：“货在书脊”。旁边那板药片上还排着一串数字：7-14-21-28-35。',
          clue: {
            id: 'book_spine_note',
            title: '书脊内铅笔字',
            detail: '旧书封皮内侧有一行铅笔写的字：“货在书脊”。药板上的数字 7-14-21-28-35 像一串编号。',
            weight: 12,
          },
        }),
        narrateAmbient: async () => ({
          title: '雨声压低了走廊',
          text: '门外没有再敲，只有雨声贴着窗沿滑下去。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '重新看看包裹里的旧书',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.clues.some((clue: { name?: string }) => clue.name === '书脊内铅笔字'),
    'explicitly narrated observable facts should become dynamic clues',
  );

  await app.close();
}

async function testNarrationClueIsRejectedWhenVisibleTextDoesNotExplicitlyMentionIt() {
  const app = Fastify({ logger: false });
  const inspectPlan: ActionPlan = {
    id: 'implicit-clue-plan',
    raw: '贴在门边听外面的动静',
    summary: '贴在门边听外面的动静',
    actions: [
      {
        id: 'inspect-implicit-clue',
        raw: '贴在门边听外面的动静',
        intent: 'inspect',
        target: 'front_door',
        method: '靠近门边听外面的声音',
        confidence: 0.9,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.9,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => inspectPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-wait',
          type: 'wait_for_fatigue',
          title: '门外没动',
          rationale: '没有发生新的可观察接触。',
          visibleToPlayer: true,
          risk: 'low',
        }),
        narrateAction: async () => ({
          title: '门板后的安静',
          text: '我贴在门边，只听到雨声压着楼道底噪，没有更具体的声音。',
          clue: {
            id: 'fake_leak_excuse',
            title: '漏水检查借口',
            detail: '门外的人用“漏水检查”作为开门理由。',
            weight: 10,
          },
        }),
        narrateAmbient: async () => ({
          title: '灯又灭了',
          text: '声控灯暗下去，门外那层楼像重新沉进黑里。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '贴在门边听外面的动静',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    !body.clues.some((clue: { name?: string }) => clue.name === '漏水检查借口'),
    'non-explicit facts should not become dynamic clues',
  );

  await app.close();
}

async function testContradictoryPaperNoteCluesAreDeduped() {
  const app = Fastify({ logger: false });
  const inspectPlan: ActionPlan = {
    id: 'paper-note-plan',
    raw: '看门缝下面塞进来的纸条',
    summary: '查看门缝下面塞进来的纸条',
    actions: [
      {
        id: 'inspect-paper-note',
        raw: '看门缝下面塞进来的纸条',
        intent: 'inspect',
        target: 'front_door',
        method: '捡起门缝下的纸条查看',
        confidence: 0.93,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.93,
    warnings: [],
  };

  await registerTestHarnessRoute(app, {
    createAiAdapters: () => ({
      aiAdapters: {
        parseAction: async () => inspectPlan,
        chooseKillerStrategy: async () => ({
          id: 'killer-note',
          type: 'paper_note',
          title: '门外塞入纸条',
          rationale: '门外的人继续用纸条试探。',
          visibleToPlayer: true,
          risk: 'medium',
        }),
        narrateAction: async () => ({
          title: '门缝里的纸条',
          text: '我把门缝下的纸条捡起来，上面歪歪扭扭写着：“我老婆病了，那药是她的，别报警，我们私了。”',
          clue: {
            id: 'paper_note_content',
            title: '门缝塞进的纸条',
            detail: '纸条写字：“我老婆病了，那药是她的，别报警，我们私了。”纸片有折痕，边缘整齐，像是事先写好带在身上的。',
            weight: 9,
          },
        }),
        narrateAmbient: async () => ({
          title: '门外塞入的纸条',
          text: '门外塞入的纸条还在地上，尚未展开查看。',
          clue: {
            id: 'paper_note_unopened',
            title: '门外塞入的纸条',
            detail: '一张对折的白纸条从门缝下被塞入，边缘湿润，折痕处有钢笔洇开的墨迹，尚未展开查看。',
            weight: 7,
          },
        }),
      },
      coordination: { warnings: [], judgements: { facts: {} } },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: '看门缝下面塞进来的纸条',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const paperNoteClues = body.clues.filter((clue: { name?: string; description?: string }) =>
    `${clue.name ?? ''}${clue.description ?? ''}`.includes('纸条'));

  assert.equal(paperNoteClues.length, 1, 'same-turn paper note clues should be deduped');
  assert.ok(
    paperNoteClues[0].description.includes('我老婆病了'),
    'revealed paper note content should be kept over unopened-note wording',
  );
  assert.ok(
    !paperNoteClues[0].description.includes('尚未展开查看'),
    'unopened-note wording should not survive once content is visible',
  );

  await app.close();
}

function testActionPlanVerifierDoesNotRewriteAiOutput() {
  const plan: ActionPlan = {
    id: 'bad-ai-plan',
    raw: 'check the wound on the back of my head',
    summary: 'Wait and observe',
    actions: [
      {
        id: 'bad-ai-action',
        raw: 'check the wound on the back of my head',
        intent: 'wait',
        target: 'self',
        method: 'stay still and observe',
        confidence: 0.72,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 0.72,
    warnings: [],
  };
  const blackboard = createTurnBlackboard('check the wound on the back of my head', baseState);

  const verified = verifyActionPlan('check the wound on the back of my head', plan, blackboard);

  assert.equal(verified, plan);
  assert.equal(verified.actions[0].intent, 'wait');
}

function testKillerStrategyVerifierDoesNotDowngradeAiOutput() {
  const barricadedState: GameState = {
    ...baseState,
    room: {
      ...baseState.room,
      front_door: {
        ...baseState.room.front_door,
        state: {
          ...baseState.room.front_door.state,
          barricaded: true,
        },
      },
    },
  };
  const strategy: KillerStrategy = {
    id: 'killer-direct-entry',
    type: 'spare_key_entry',
    title: 'Spare key turns',
    rationale: 'AI proposed a direct entry despite the barricade.',
    visibleToPlayer: true,
    risk: 'high',
  };
  const blackboard = createTurnBlackboard('', barricadedState);

  const verified = verifyKillerStrategy(barricadedState, strategy, blackboard);

  assert.equal(verified, strategy);
  assert.equal(verified.type, 'spare_key_entry');
  assert.ok(blackboard.warnings.some((warning) => warning.includes('did not rewrite')));
}
await testHarnessTurnRouteReturnsFrontendPackage();
await testHarnessTurnDoesNotWaitForShadowCompletion();
await testLowRiskTakeoverCommitsBeforePublishingResponse();
await testLowRiskTakeoverConflictPublishesNoStateOrStory();
await testLowRiskTakeoverPersistenceFailurePublishesNoStateOrStory();
await testKnowledgeClueTakeoverDisablesNarratorClueAuthority();
await testHighRiskTakeoverPublishesOnlyConfirmedOutcome();
await testLegacyMainPathExitSkipsLegacyStateStagesBeforePostCommitNarration();
await testLegacyMainPathExitPublishesAcceptedRecommendations();
await testLegacyMainPathExitRendersReadOnlyPostCommitNarration();
await testLegacyMainPathExitRejectsUngroundedActionNarration();
await testLegacyMainPathExitPublishesConfirmedNpcReply();
await testLegacyMainPathExitKeepsConfirmedMaterialWhenNarratorFails();
await testLegacyMainPathExitUsesMinimumFallbackOnlyWhenAiIsUnavailable();
await testLegacyMainPathExitRejectsInvalidFormalTurnWithoutLegacyFallback();
await testDefaultHarnessRouteReturnsDispatcherTrace();
await testDefaultHarnessRouteInjectsAiAdapters();
await testWorldTickRunsAsProductCapabilityForRoute();
await testFatalNarrationIsOnlyAProposal();
await testNarratedEscapeEndingIsOnlyAProposalEvenWhenPlausible();
await testNarratedEscapeEndingIsRejectedWhenOnlyPlayerClaimsIt();
await testThreatEventsDoNotBecomeDynamicCluesWithoutExplicitEvidence();
await testNarrationClueIsAcceptedOnlyWhenVisibleTextExplicitlyMentionsIt();
await testNarrationClueIsRejectedWhenVisibleTextDoesNotExplicitlyMentionIt();
await testContradictoryPaperNoteCluesAreDeduped();
testActionPlanVerifierDoesNotRewriteAiOutput();
testKillerStrategyVerifierDoesNotDowngradeAiOutput();
