import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import type { ActionPlan, GameState, KillerStrategy, Narration } from '@murder-loop-ai/shared';
import { frontendAdapterRoute } from './frontendAdapter';

const baseState = createInitialGameState();

const plan: ActionPlan = {
  id: 'frontend-plan',
  raw: 'check the package',
  summary: 'Check the package',
  actions: [
    {
      id: 'frontend-action',
      raw: 'check the package',
      intent: 'inspect',
      target: 'package',
      method: 'inspect the package on the table',
      confidence: 0.95,
      timeCost: 1,
      noise: 0,
      risk: 'low',
    },
  ],
  confidence: 0.95,
  warnings: [],
};

const strategy: KillerStrategy = {
  id: 'frontend-killer',
  type: 'wait_for_fatigue',
  title: 'Hallway pause',
  rationale: 'No new visible pressure point was exposed.',
  visibleToPlayer: true,
  risk: 'low',
};

const actionNarration: Narration = {
  title: 'Package checked',
  text: 'The box sits where it was, its damp corner soft under your thumb.',
};

const ambientNarration: Narration = {
  title: 'Rain at the window',
  text: 'Rain keeps ticking against the window while the hallway holds still.',
};

async function testFrontendAdapterUsesHarnessResolver() {
  const app = Fastify({ logger: false });
  let parseCalledWith: { input: string; minute: number } | null = null;

  await app.register(frontendAdapterRoute, {
    createAiAdapters: (input: string, state: GameState) => ({
      aiAdapters: {
        parseAction: async () => {
          parseCalledWith = { input, minute: state.minute };
          return plan;
        },
        chooseKillerStrategy: async () => strategy,
        narrateAction: async () => actionNarration,
        narrateAmbient: async () => ambientNarration,
      },
      coordination: {
        warnings: ['frontend adapter harness path'],
        judgements: {
          facts: { source: 'test' },
          directorScores: [],
        },
      },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/frontend/resolve-action',
    payload: {
      actionText: 'check the package',
      coreState: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(parseCalledWith, { input: 'check the package', minute: baseState.minute });

  const body = response.json();
  assert.equal(body.storyLog[0].type, 'player_input');
  assert.equal(body.storyLog[1].type, 'action_result');
  assert.equal(body.storyLog[1].content, 'Package checked。The box sits where it was, its damp corner soft under your thumb.');
  assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');
  assert.equal(body.coordination.trace[0].source, 'ai');
  assert.ok(body.coordination.warnings.includes('frontend adapter harness path'));

  await app.close();
}

await testFrontendAdapterUsesHarnessResolver();
