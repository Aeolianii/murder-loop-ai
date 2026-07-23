import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import type { ClueRecord } from '@murder-loop-ai/shared';
import { harnessTurnRoute } from './harnessTurn';

const app = Fastify();
await app.register(harnessTurnRoute, {
  selectActionAudioCue: async () => null,
  shadowCoordinator: null,
  lowRiskTakeoverService: null,
  semanticPrefetchService: null,
});

const state = createInitialGameState();
const clueIds = [
  'package_label_fragment',
  'no_matching_order',
  'vacuum_packaging',
  'usb_locked_0724',
  'missed_call_4s',
  'voip_callback_dead',
];
state.clues = clueIds.map((id): ClueRecord => ({
  id,
  title: id,
  detail: id,
  source: 'player_discovered',
  weight: 1,
  discoveredAt: { run: state.run, minute: state.minute },
  isPersistent: true,
}));

const response = await app.inject({
  method: 'POST',
  url: '/api/harness/turn',
  payload: {
    input: [
      '推导真相：包裹不是沈知夏订购的快递',
      '包裹在刻意隐藏数字资料',
      '匿名来电是在确认 503 是否有人',
    ].join('。'),
    state,
    gameSessionId: 'deduction-route-test',
    inputStateVersion: 0,
  },
});

assert.equal(response.statusCode, 200);
const body = response.json();
assert.equal(body.deduction.passed, true);
assert.equal(typeof body.deductionEnding.totalScore, 'number');
assert.equal('ending' in body, false);

await app.close();
