import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import type { ActionAudioCue, ActionPlan, GameState, KillerStrategy, Narration, TurnResolution } from '@murder-loop-ai/shared';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy } from '../ai/turnCoordinator';
import { harnessTurnRoute } from './harnessTurn';

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

  await app.register(harnessTurnRoute, {
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

async function testDefaultHarnessRouteReturnsDispatcherTrace() {
  const app = Fastify({ logger: false });

  await app.register(harnessTurnRoute, {
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

  await app.register(harnessTurnRoute, {
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
          directorScores: [],
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

  await app.register(harnessTurnRoute, {
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
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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

  await app.register(harnessTurnRoute, {
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
          ending: 'escaped_without_truth',
        }),
        narrateAmbient: async () => ({
          title: '楼道被抛在身后',
          text: '雨点追着你落下去，楼上的声控灯没有再亮。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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
  assert.notEqual(body.coreState.ending, 'escaped_without_truth');
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

  await app.register(harnessTurnRoute, {
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
          ending: 'escaped_without_truth',
        }),
        narrateAmbient: async () => ({
          title: '门外没走',
          text: '楼道里没有传来你期待中的远离声，只有雨声贴着窗。',
        }),
      },
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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
  assert.notEqual(body.coreState.ending, 'escaped_without_truth');
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

  await app.register(harnessTurnRoute, {
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
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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

  await app.register(harnessTurnRoute, {
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
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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

  await app.register(harnessTurnRoute, {
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
      coordination: { warnings: [], judgements: { facts: {}, directorScores: [] } },
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
await testDefaultHarnessRouteReturnsDispatcherTrace();
await testDefaultHarnessRouteInjectsAiAdapters();
await testFatalNarrationIsOnlyAProposal();
await testNarratedEscapeEndingIsOnlyAProposalEvenWhenPlausible();
await testNarratedEscapeEndingIsRejectedWhenOnlyPlayerClaimsIt();
await testThreatEventsDoNotBecomeDynamicCluesWithoutExplicitEvidence();
await testNarrationClueIsAcceptedOnlyWhenVisibleTextExplicitlyMentionsIt();
await testNarrationClueIsRejectedWhenVisibleTextDoesNotExplicitlyMentionIt();
testActionPlanVerifierDoesNotRewriteAiOutput();
testKillerStrategyVerifierDoesNotDowngradeAiOutput();
