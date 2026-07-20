import assert from 'node:assert/strict';
import { createHarness, createInitialGameState } from '@murder-loop-ai/game-core';
import { buildSidebarPayload } from './frontendTurnPresenter';

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
