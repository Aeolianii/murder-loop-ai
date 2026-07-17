import type { HarnessTurnResponse } from '../api/harnessTurnClient';
import { INITIAL_STATE } from '../constants';
import { useGameStore } from './gameStore';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function resetStore() {
  useGameStore.setState({
    frontendState: structuredClone(INITIAL_STATE),
    busy: false,
    inputBusy: false,
    serverStatus: 'unknown',
    lastTurnDebug: null,
  });
}

function mockHarnessResponse(response: HarnessTurnResponse) {
  globalThis.fetch = (async () => new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
}

resetStore();

const turnResponse: HarnessTurnResponse = {
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

mockHarnessResponse(turnResponse);
const submitted = await useGameStore.getState().submitAction(' 我拍下包裹 ');
const afterSubmit = useGameStore.getState();

assert(submitted?.time === turnResponse.time, 'submitAction should return the harness response');
assert(afterSubmit.frontendState.time === '23:08', 'submitAction should merge response into frontendState');
assert((afterSubmit.frontendState.coreState as { minute: number }).minute === 1388, 'submitAction should preserve returned coreState');
assert(afterSubmit.frontendState.storyLog.filter(node => node.type === 'player_input').length === 1, 'submitAction should not duplicate server player_input nodes');
assert(afterSubmit.frontendState.storyLog.at(-1)?.id === 'server-narration', 'submitAction should append server narration');
assert(afterSubmit.busy === false && afterSubmit.inputBusy === false, 'submitAction should clear busy flags');
assert(afterSubmit.serverStatus === 'online', 'submitAction should mark server online');
assert((afterSubmit.lastTurnDebug as HarnessTurnResponse).time === turnResponse.time, 'submitAction should store the last turn response for debugging');

const rewindResponse: HarnessTurnResponse = {
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
mockHarnessResponse(rewindResponse);
const rewound = await useGameStore.getState().rewind();
const afterRewind = useGameStore.getState();

assert(rewound?.time === rewindResponse.time, 'rewind should return the harness response');
assert(afterRewind.frontendState.phase === 'loop_started', 'rewind should merge the rewound phase');
assert(afterRewind.frontendState.ending === null, 'rewind should clear ending state');
assert(afterRewind.frontendState.deathTitle === null, 'rewind should clear death title');

useGameStore.getState().reset();
const afterReset = useGameStore.getState();

assert(afterReset.frontendState.time === '23:00', 'reset should restore opening time');
assert(afterReset.frontendState.phase === 'intro', 'reset should restore intro phase');
assert(afterReset.lastTurnDebug === null, 'reset should clear lastTurnDebug');
