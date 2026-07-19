import assert from 'node:assert/strict';
import type { RuleEvent } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { projectKillerVisibleState, updateKillerKnowledgeFromState } from './knowledge';
import { createInformantPoliceCallEvent } from '../world/knowledgeEvents';
import { applyEventEffects, createInitialWorldState } from '../world/worldSimulator';

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
  state.room.front_door.state.barricaded = true;
  state.room.window.state.locked = true;

  updateKillerKnowledgeFromState(state);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, 'uncertain');
  assert.equal(state.killerKnowledge.knowsPlayerPhotographedPackage, false);
  assert.equal(state.killerKnowledge.knowsDoorBarricaded, false);
  assert.equal(state.killerKnowledge.knowsWindowLocked, false);
}

{
  const state = createInitialGameState();

  updateKillerKnowledgeFromState(state, [
    event('package', 'The package was opened within sight of the hallway.', 'killer'),
    event('package', 'The phone camera photographed the package in visible screen glare.', 'killer'),
    event('front door', 'A barricade scraped against the door.', 'killer'),
    event('window', 'The window lock clicked.', 'killer'),
  ]);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, true);
  assert.equal(state.killerKnowledge.knowsPlayerPhotographedPackage, true);
  assert.equal(state.killerKnowledge.knowsDoorBarricaded, true);
  assert.equal(state.killerKnowledge.knowsWindowLocked, true);
}

{
  const state = createInitialGameState();

  updateKillerKnowledgeFromState(state, [
    event('package', 'The package was opened privately.', 'player'),
  ]);

  assert.equal(state.killerKnowledge.knowsPlayerOpenedPackage, 'uncertain');
}

{
  const state = createInitialGameState();
  state.policePhase = 'real_police_en_route';
  state.phase = 'confrontation';
  state.killerKnowledge.knowsPoliceCalled = false;

  assert.equal(projectKillerVisibleState(state).policeActive, false);
  assert.notEqual(projectKillerVisibleState(state).phase, 'confrontation');

  state.killerKnowledge.knowsPoliceCalled = true;

  assert.equal(projectKillerVisibleState(state).policeActive, true);
  assert.equal(projectKillerVisibleState(state).phase, 'confrontation');
}

{
  const state = createInitialGameState();
  state.policePhase = 'dispatch_pending';
  state.phase = 'police_called';
  state.killerKnowledge.knowsPoliceCalled = false;
  const world = createInitialWorldState();
  const informantEvent = createInformantPoliceCallEvent(world);
  world.events.push(informantEvent);
  applyEventEffects(world, informantEvent);
  state.world = world;

  assert.equal(projectKillerVisibleState(state).policeActive, true);
  assert.equal(projectKillerVisibleState(state).phase, 'police_called');
}

{
  const state = createInitialGameState();
  state.linYuePhase = 'received_photo';
  state.clues.push({
    id: 'linyue_has_photo',
    title: 'Lin Yue has the photo',
    detail: 'Private evidence transfer.',
    source: 'player_discovered',
    weight: 5,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });

  const projection = projectKillerVisibleState(state);
  const projectionRecord = projection as unknown as Record<string, unknown>;

  assert.equal(projection.linYuePhase, 'unknown');
  assert.equal('room' in projectionRecord, false);
  assert.equal('player' in projectionRecord, false);
  assert.equal('clues' in projectionRecord, false);
  assert.equal('log' in projectionRecord, false);
  assert.doesNotMatch(JSON.stringify(projection), /linyue_has_photo|Private evidence transfer/);

  projection.knowledge.knowsPlayerContactedLinYue = true;
  assert.equal(state.killerKnowledge.knowsPlayerContactedLinYue, false);
}
