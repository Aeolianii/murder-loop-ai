import { HarnessTurnRequestError, type HarnessTurnResponse } from './api/harnessTurnClient';
import { INITIAL_STATE } from './constants';
import { applyHarnessTurnResponse, beginHarnessTurn, rewindFrontendStateFromResponse } from './turnViewModel';
import type { GameState } from './types';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function cloneInitialState(): GameState {
  return structuredClone(INITIAL_STATE);
}

const response: HarnessTurnResponse = {
  time: '23:06',
  location: '青荷公寓 503 室',
  phase: 'investigating',
  storyLog: [
    { id: 'input-from-server', type: 'player_input', content: '我检查包裹' },
    { id: 'narration-1', type: 'narrative', content: '纸箱边缘有潮湿的压痕。', timestamp: '23:06' },
  ],
  clues: [
    { id: 'wrong_package', name: '标记模糊的包裹', description: '5-03 的手写标记很旧。', status: 'known' },
    { id: 'package_label', name: '快递标签', description: '寄件信息被撕掉了一半。', status: 'new' },
  ],
  coreState: { minute: 1386 },
  ending: null,
  deathTitle: null,
  deathSummary: null,
  deathMethod: null,
  coordination: { warnings: ['trace warning'] },
  recap: '第 1 次循环。',
  sidebar: {
    phone: { battery: 41, recording: false, muted: false, newMessages: [] },
    threat: { level: 22, trend: 'rising', label: '低压' },
    timeLabel: '23:06',
    phaseLabel: '调查',
    npcStatus: [],
    roomStatus: [],
    newClues: [],
  },
};

const pending = beginHarnessTurn(cloneInitialState(), '我检查包裹', 'turn-1');
assert(pending.isParsing === true, 'beginHarnessTurn should mark the state as parsing');
assert(pending.storyLog.at(-1)?.id === 'input-turn-1', 'beginHarnessTurn should append a stable player input id');

const next = applyHarnessTurnResponse(pending, response);
assert(next.isParsing === false, 'applyHarnessTurnResponse should clear parsing state');
assert(next.time === '23:06', 'applyHarnessTurnResponse should merge returned time');
assert(next.phase === 'investigating', 'applyHarnessTurnResponse should merge returned phase');
assert(next.clues.length === 2, 'applyHarnessTurnResponse should merge returned clues');
assert(next.coreState === response.coreState, 'applyHarnessTurnResponse should merge returned coreState');
assert(next.coordination?.warnings[0] === 'trace warning', 'applyHarnessTurnResponse should merge coordination');
assert(next.sidebar?.timeLabel === '23:06', 'applyHarnessTurnResponse should merge sidebar payload');
assert(next.storyLog.filter(node => node.type === 'player_input').length === 1, 'applyHarnessTurnResponse should not duplicate server player_input nodes');
assert(next.storyLog.at(-1)?.id === 'narration-1', 'applyHarnessTurnResponse should append non-input story nodes');

const errorState = applyHarnessTurnResponse(pending, response, new Error('backend failed badly'));
assert(errorState.isParsing === false, 'applyHarnessTurnResponse should clear parsing state on error');
assert(errorState.storyLog.at(-1)?.type === 'system', 'applyHarnessTurnResponse should append system message on error');
assert(errorState.storyLog.at(-1)?.content === '后端暂时没有回应，行动未写入循环。', 'error message should remain player-facing Chinese copy');
assert(!/[A-Za-z]/.test(errorState.storyLog.at(-1)?.content ?? ''), 'technical English errors must not leak into the UI');

const clarificationState = applyHarnessTurnResponse(
  pending,
  response,
  new HarnessTurnRequestError(422, 'ai_first_clarification_required'),
);
assert(
  clarificationState.storyLog.at(-1)?.content === '行动含义还不够明确，请换一种更具体的说法。',
  'semantic clarification should not be presented as a disconnected backend',
);

const rejectedState = applyHarnessTurnResponse(
  pending,
  response,
  new HarnessTurnRequestError(503, 'ai_first_turn_rejected'),
);
assert(
  rejectedState.storyLog.at(-1)?.content === '行动解析暂时失败，本次行动没有写入循环。',
  'a server-side semantic rejection should remain distinct from a network failure',
);

const rewindState = rewindFrontendStateFromResponse({
  ...next,
  ending: 'death',
  phase: 'death',
  actionConfirmation: '确认执行上一轮动作',
  deathTitle: '23:47',
  deathSummary: '黑暗落下。',
  deathMethod: 'spare_key_entry',
}, {
  time: '23:00',
  phase: 'loop_started',
  coreState: { minute: 1380 },
  clues: response.clues,
  recap: '第 2 次循环。',
  sidebar: response.sidebar,
});

assert(rewindState.isParsing === false, 'rewindFrontendStateFromResponse should clear parsing state');
assert(rewindState.isParsingAction === false, 'rewindFrontendStateFromResponse should clear action parsing state');
assert(rewindState.actionConfirmation === null, 'rewindFrontendStateFromResponse should clear pending confirmation');
assert(rewindState.storyLog.length === 0, 'rewindFrontendStateFromResponse should clear the previous loop dialogue');
assert(rewindState.ending === null, 'rewindFrontendStateFromResponse should clear ending');
assert(rewindState.deathTitle === null, 'rewindFrontendStateFromResponse should clear death title');
assert(rewindState.recap === '第 2 次循环。', 'rewindFrontendStateFromResponse should merge recap');
