import type { HarnessTurnResponse } from '../api/harnessTurnClient';
import { freshFrontendState } from '../frontendState';
import { useGameStore } from './gameStore';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function resetStore() {
  useGameStore.setState({
    frontendState: freshFrontendState(),
    busy: false,
    inputBusy: false,
    serverStatus: 'unknown',
    lastTurnDebug: null,
  });
}

function mockHarnessResponse(response: HarnessTurnResponse, requests: unknown[] = []) {
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function mockHarnessError(status: number, error: string) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
}

resetStore();
const gameSessionId = useGameStore.getState().frontendState.gameSessionId;

const turnResponse: HarnessTurnResponse = {
  gameSessionId,
  inputStateVersion: 0,
  outputStateVersion: 1,
  time: '23:08',
  phase: 'investigating',
  storyLog: [
    { id: 'server-input', type: 'player_input', content: '我拍下包裹' },
    { id: 'server-narration', type: 'narrative', content: '屏幕亮了一下。', timestamp: '23:08' },
  ],
  clues: [
    { id: 'wrong_package', name: '标记模糊的包裹', description: '旧标记。', status: 'known' },
    { id: 'package_photo', name: '包裹照片', description: '照片已经存在手机里。', status: 'new' },
  ],
  coreState: { minute: 1388 },
  recap: '第 1 次循环。',
};

const submitRequests: unknown[] = [];
mockHarnessResponse(turnResponse, submitRequests);
const submitted = await useGameStore.getState().submitAction(' 我拍下包裹 ');
const afterSubmit = useGameStore.getState();

assert(submitted?.time === turnResponse.time, 'submitAction should return the harness response');
assert((submitRequests[0] as { debug?: unknown }).debug === undefined, 'submitAction should not send a World Tick debug switch');
assert((submitRequests[0] as { gameSessionId?: unknown }).gameSessionId === gameSessionId, 'submitAction should send the persisted game session id');
assert((submitRequests[0] as { inputStateVersion?: unknown }).inputStateVersion === 0, 'submitAction should send the current state version');
assert((submitRequests[0] as { recommendationId?: unknown }).recommendationId === undefined, 'natural-language input must not impersonate a recommendation click');
assert(afterSubmit.frontendState.time === '23:08', 'submitAction should merge response into frontendState');
assert(afterSubmit.frontendState.stateVersion === 1, 'submitAction should advance to the committed output version');
assert((afterSubmit.frontendState.coreState as { minute: number }).minute === 1388, 'submitAction should preserve returned coreState');
assert(afterSubmit.frontendState.storyLog.filter(node => node.type === 'player_input').length === 1, 'submitAction should not duplicate server player_input nodes');
assert(afterSubmit.frontendState.storyLog.at(-1)?.id === 'server-narration', 'submitAction should append server narration');
assert(afterSubmit.busy === false && afterSubmit.inputBusy === false, 'submitAction should clear busy flags');
assert(afterSubmit.serverStatus === 'online', 'submitAction should mark server online');
assert((afterSubmit.lastTurnDebug as HarnessTurnResponse).time === turnResponse.time, 'submitAction should store the last turn response for debugging');

const recommendationRequests: unknown[] = [];
mockHarnessResponse({
  ...turnResponse,
  inputStateVersion: 1,
  outputStateVersion: 2,
}, recommendationRequests);
const recommendation = {
  id: 'recommendation.photo-package',
  label: '拍下包裹上的标签',
  rationale: '先保留肉眼可见的证据。',
};
const recommended = await useGameStore.getState().submitRecommendedAction(recommendation);

assert(recommended?.time === turnResponse.time, 'submitRecommendedAction should return the harness response');
assert((recommendationRequests[0] as { input?: unknown }).input === recommendation.label, 'recommendation clicks must retain the Chinese label as fallback input');
assert((recommendationRequests[0] as { recommendationId?: unknown }).recommendationId === recommendation.id, 'recommendation clicks must send the stable recommendation id');
assert((recommendationRequests[0] as { inputStateVersion?: unknown }).inputStateVersion === 1, 'recommendation clicks must bind the prefetch lookup to the current state version');

const truthRequests: unknown[] = [];
mockHarnessResponse({
  gameSessionId,
  inputStateVersion: 2,
  outputStateVersion: 2,
  deduction: {
    claims: [],
    confirmedCount: 10,
    totalAsked: 10,
    passed: true,
    consecutiveFailures: 0,
  },
}, truthRequests);
const truthResult = await useGameStore.getState().submitTruth();

assert(truthResult?.deduction?.confirmedCount === 10, 'submitTruth should return the deduction result');
assert((truthRequests[0] as { operation?: unknown }).operation === 'deduction', 'submitTruth should use the dedicated deduction operation');
assert((truthRequests[0] as { input?: unknown }).input === '', 'submitTruth must not depend on a fabricated natural-language action');

useGameStore.setState({
  frontendState: {
    ...useGameStore.getState().frontendState,
    playMode: 'hard',
  },
});
const hardModeRequests: unknown[] = [];
mockHarnessResponse({
  ...turnResponse,
  inputStateVersion: 2,
  outputStateVersion: 3,
}, hardModeRequests);
await useGameStore.getState().submitAction('检查房门');
assert(
  (hardModeRequests[0] as { recommendationsEnabled?: unknown }).recommendationsEnabled === false,
  'hard mode requests must disable recommended actions at the server boundary',
);

useGameStore.setState({
  frontendState: afterSubmit.frontendState,
  busy: false,
  inputBusy: false,
  serverStatus: 'online',
  lastTurnDebug: turnResponse,
});

const rewindResponse: HarnessTurnResponse = {
  gameSessionId,
  inputStateVersion: 1,
  outputStateVersion: 0,
  time: '23:00',
  phase: 'loop_started',
  coreState: { minute: 1380 },
  recap: '第 2 次循环。',
};
useGameStore.setState({
  frontendState: {
    ...useGameStore.getState().frontendState,
    phase: 'death',
    ending: 'death',
    deathTitle: '23:47',
    deathSummary: '黑暗落下。',
    deathMethod: 'spare_key_entry',
  },
});
const rewindRequests: unknown[] = [];
mockHarnessResponse(rewindResponse, rewindRequests);
const rewound = await useGameStore.getState().rewind();
const afterRewind = useGameStore.getState();

assert(rewound?.time === rewindResponse.time, 'rewind should return the harness response');
assert((rewindRequests[0] as { debug?: unknown }).debug === undefined, 'rewind should not send debug controls');
assert((rewindRequests[0] as { gameSessionId?: unknown }).gameSessionId === gameSessionId, 'rewind should keep the same game session id');
assert((rewindRequests[0] as { inputStateVersion?: unknown }).inputStateVersion === 1, 'rewind should send the last committed state version');
assert((rewindRequests[0] as { operation?: unknown }).operation === 'reset_loop', 'rewind should explicitly request a loop reset');
assert(afterRewind.frontendState.phase === 'loop_started', 'rewind should merge the rewound phase');
assert(afterRewind.frontendState.stateVersion === 0, 'rewind should accept the reset loop version');
assert(afterRewind.frontendState.storyLog.length === 0, 'rewind should clear the previous loop dialogue');
assert(afterRewind.frontendState.ending === null, 'rewind should clear ending state');
assert(afterRewind.frontendState.deathTitle === null, 'rewind should clear death title');

useGameStore.getState().reset();
const afterReset = useGameStore.getState();

assert(afterReset.frontendState.time === '23:00', 'reset should restore opening time');
assert(afterReset.frontendState.phase === 'intro', 'reset should restore intro phase');
assert(afterReset.frontendState.gameSessionId !== gameSessionId, 'reset should start a new authoritative game session');
assert(afterReset.lastTurnDebug === null, 'reset should clear lastTurnDebug');

resetStore();
mockHarnessError(422, 'ai_first_clarification_required');
const clarificationResult = await useGameStore.getState().submitAction('这个那个');
const afterClarification = useGameStore.getState();
assert(clarificationResult === null, 'clarification responses should not commit a turn');
assert(afterClarification.serverStatus === 'online', 'an HTTP clarification proves that the server is online');
assert(
  afterClarification.frontendState.storyLog.at(-1)?.content === '行动含义还不够明确，请换一种更具体的说法。',
  'the store should preserve the semantic clarification message',
);
