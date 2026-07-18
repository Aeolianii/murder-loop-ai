import { strict as assert } from 'node:assert';
import type { GameState, MemoryFragment } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  buildVisibleMemoryForAgent,
  createEmptyLoopMemory,
  getConversationCheckpoint,
  normalizeLoopMemory,
  recordDeathMemory,
  recordTurnMemory,
  rewindMemoryAfterDeath,
} from './loopMemory';

function fragment(id: string, run = 1): MemoryFragment {
  return {
    id,
    run,
    minute: 1380,
    title: id,
    text: `${id} text`,
    kind: 'observation',
    scope: 'current_run',
    importance: 5,
    source: 'rule',
  };
}

{
  const memory = createEmptyLoopMemory();
  assert.deepEqual(memory.shortTerm, []);
  assert.deepEqual(memory.currentRun, []);
  assert.deepEqual(memory.crossRun, []);
  assert.deepEqual(memory.characters.player, []);
  assert.deepEqual(memory.characters.linYue, []);
  assert.deepEqual(memory.characters.killer, []);
}

{
  const legacy = [
    { id: 'checkpoint-call-1', run: 1, title: 'call', text: 'called Lin Yue' },
    { id: 'memory-1', run: 1, title: 'death', text: 'door opened' },
  ];
  const memory = normalizeLoopMemory(legacy);
  assert.equal(memory.currentRun[0]?.id, 'checkpoint-call-1');
  assert.equal(memory.crossRun[0]?.id, 'memory-1');
}

{
  const state = createInitialGameState();
  for (let index = 0; index < 7; index += 1) {
    recordTurnMemory(state, {
      playerInput: `action ${index}`,
      summary: `summary ${index}`,
    });
  }

  assert.equal(state.memory.shortTerm.length, 5);
  assert.equal(state.memory.shortTerm[0]?.title, 'summary 2');
  assert.equal(state.memory.currentRun.length, 7);
}

{
  const state = createInitialGameState();
  state.log.push({
    id: 'death-log',
    run: 1,
    minute: 1427,
    title: '23:47',
    text: 'The last sound was the lock.',
    tone: 'death',
    channel: 'action',
  });

  recordDeathMemory(state);

  assert.equal(state.memory.crossRun.at(-1)?.kind, 'death');
  assert.equal(state.memory.characters.player.at(-1)?.id, state.memory.crossRun.at(-1)?.id);
}

{
  const state = createInitialGameState();
  state.memory.currentRun.push({
    ...fragment('checkpoint-call-1'),
    kind: 'checkpoint',
  });

  assert.equal(getConversationCheckpoint(state.memory)?.id, 'checkpoint-call-1');
}

{
  const state = createInitialGameState();
  state.memory.shortTerm.push(fragment('private-short'));
  state.memory.currentRun.push(fragment('run-action'));
  state.memory.crossRun.push({ ...fragment('previous-death'), scope: 'cross_run', kind: 'death' });
  state.memory.characters.killer.push({ ...fragment('killer-saw-door'), owner: 'killer', scope: 'character' });

  const nextMemory = rewindMemoryAfterDeath(state);

  assert.equal(nextMemory.shortTerm.length, 0);
  assert.equal(nextMemory.currentRun.length, 0);
  assert.equal(nextMemory.crossRun.some((item) => item.id === 'previous-death'), true);
  assert.equal(nextMemory.characters.player.some((item) => item.id.startsWith('memory-1')), true);
  assert.equal(nextMemory.characters.killer.length, 0);
}

{
  const state = createInitialGameState();
  state.memory.crossRun.push({ ...fragment('player-remembers-death'), scope: 'cross_run', kind: 'death' });
  state.memory.characters.killer.push({ ...fragment('killer-visible-fact'), owner: 'killer', scope: 'character' });

  const narratorMemory = buildVisibleMemoryForAgent(state.memory, 'narrator');
  const killerMemory = buildVisibleMemoryForAgent(state.memory, 'killer');

  assert(narratorMemory.some((line) => line.includes('player-remembers-death')));
  assert(!killerMemory.some((line) => line.includes('player-remembers-death')));
  assert(killerMemory.some((line) => line.includes('killer-visible-fact')));
}
