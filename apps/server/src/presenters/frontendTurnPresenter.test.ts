import assert from 'node:assert/strict';
import { createHarness, createInitialGameState } from '@murder-loop-ai/game-core';
import {
  buildDisplayedRecommendedActions,
  buildSidebarPayload,
  presentRecommendedActionsInChinese,
} from './frontendTurnPresenter';

const harness = createHarness();
const state = createInitialGameState();
state.room.package.state.photographed = true;
state.phoneBattery = 67;
state.room.phone.state.battery = 67;
state.linYuePhase = 'received_photo';

const first = await buildSidebarPayload(harness, state);
assert(first, 'Sidebar payload must be generated when no TurnCompleted artifact exists');
assert.equal(first.phone.battery, 67);
assert.equal(
  first.roomStatus.find((item) => item.item === state.room.package.name)?.state.includes('photographed'),
  true,
);
assert.equal(
  first.npcStatus.find((item) => item.name === '林越')?.status,
  'received_photo',
);

const second = await buildSidebarPayload(harness, state);
assert.deepEqual(second, first);
assert.equal(
  harness.dispatcher.getTrace().filter((entry) => (
    entry.eventType === 'TurnCompleted' && entry.agentId === 'sidebar'
  )).length,
  1,
  'reading Sidebar twice from one turn Harness must not dispatch TurnCompleted twice',
);

const presentedRecommendations = presentRecommendedActionsInChinese([
  {
    id: 'photograph-package',
    label: 'Photograph the package label',
    rationale: 'Preserve visible evidence before taking another action.',
  },
  {
    id: 'inspect-package',
    label: 'Inspect the package on the desk',
    rationale: 'The package may contain useful evidence.',
  },
  {
    id: 'check-window',
    label: 'Check the window',
    rationale: 'The window may provide an escape route.',
  },
  {
    id: 'check-bed',
    label: 'Check under the bed',
    rationale: 'Something may be hidden underneath.',
  },
  {
    id: 'check-closet',
    label: 'Check the closet',
    rationale: 'The closet has not been searched.',
  },
  {
    id: 'check-bathroom',
    label: 'Check the bathroom water tank',
    rationale: 'Items are sometimes hidden there.',
  },
  {
    id: 'unknown-action',
    label: 'Review the latest situation',
    rationale: 'Choose a safe next step.',
  },
]);

assert.deepEqual(
  presentedRecommendations.map((action) => action.label),
  ['拍摄并保存包裹标签', '检查桌上的包裹', '检查窗户'],
  'the UI must publish at most three recommendations even when the Specialist returns more',
);
for (const action of presentedRecommendations) {
  assert.doesNotMatch(action.label, /[A-Za-z]/);
  assert.doesNotMatch(action.rationale, /[A-Za-z]/);
}

const fallbackRecommendations = buildDisplayedRecommendedActions([], createInitialGameState());
assert.deepEqual(
  fallbackRecommendations.map((action) => action.id),
  ['fallback.inspect-package', 'fallback.secure-front-door', 'fallback.inspect-window'],
  'an active turn with no accepted AI recommendations must receive grounded visible-state fallbacks',
);
assert.ok(fallbackRecommendations.length >= 1 && fallbackRecommendations.length <= 3);

const alreadyChinese = [{
  id: 'secure-door',
  label: '锁好前门',
  rationale: '门锁尚未确认，先确保入口安全。',
}];
assert.deepEqual(
  presentRecommendedActionsInChinese(alreadyChinese),
  alreadyChinese,
  'valid Chinese recommendation copy must remain unchanged',
);
