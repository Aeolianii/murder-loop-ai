import assert from 'node:assert/strict';
import type { RuleEvent } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { updateKillerKnowledgeFromState } from './knowledge';

function event(subject: string, summary: string, visibility: RuleEvent['visibility']): RuleEvent {
  return {
    kind: 'action',
    subject,
    summary,
    sensoryHints: [],
    visibility,
  };
}

{
  const state = createInitialGameState();
  state.room.package.state.opened = true;
  state.room.package.state.photographed = true;

  updateKillerKnowledgeFromState(state);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, 'uncertain');
  assert.equal(state.killerKnowledge.knowsPlayerPhotographedPackage, false);
}

{
  const state = createInitialGameState();

  updateKillerKnowledgeFromState(state, [
    event('package', 'The package was opened within sight of the hallway.', 'killer'),
    event('package', 'The phone camera photographed the package in visible screen glare.', 'killer'),
  ]);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, true);
  assert.equal(state.killerKnowledge.knowsPlayerPhotographedPackage, true);
}

{
  const state = createInitialGameState();

  updateKillerKnowledgeFromState(state, [
    event('package', 'The package was opened privately.', 'player'),
  ]);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, 'uncertain');
}
