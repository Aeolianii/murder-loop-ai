import assert from 'node:assert/strict';
import type { Fact } from '@murder-loop-ai/ai-contracts';
import { createInitialGameState } from '../state/createInitialState';
import { createInitialWorldState } from '../world/worldSimulator';
import { FactLedger } from './FactLedger';
import { buildFactLedgerFromGameState, buildKnowledgeProjections } from './knowledgeProjection';

const privatePlayerFact: Fact = {
  id: 'fact.player.private_memory',
  subject: 'player',
  predicate: 'remembers_previous_loop',
  value: true,
  sourceEventId: 'event.loop.memory_retained',
  visibleTo: ['player'],
  knownBy: ['player'],
  validFromTurn: 'turn-1',
  invalidatedBy: null,
};

const publicFact: Fact = {
  id: 'fact.corridor.alarm_sounding',
  subject: 'corridor_5f',
  predicate: 'alarm_sounding',
  value: true,
  sourceEventId: 'event.environment.alarm_started',
  visibleTo: ['public'],
  knownBy: ['system'],
  validFromTurn: 'turn-1',
  invalidatedBy: null,
};

const killerFact: Fact = {
  id: 'fact.killer.knows_package_at_503',
  subject: 'killer',
  predicate: 'knows_package_at_503',
  value: true,
  sourceEventId: 'event.canonical.package_assignment',
  visibleTo: ['system'],
  knownBy: ['killer', 'system'],
  validFromTurn: 'turn-1',
  invalidatedBy: null,
};

{
  const ledger = new FactLedger([privatePlayerFact, publicFact, killerFact]);
  assert.throws(() => ledger.add(privatePlayerFact), /already exists/);
  assert.equal(ledger.activeFacts().length, 3);

  ledger.invalidate(publicFact.id, 'event.environment.alarm_stopped');
  assert.equal(ledger.activeFacts().some((fact) => fact.id === publicFact.id), false);
  assert.equal(ledger.get(publicFact.id)?.invalidatedBy, 'event.environment.alarm_stopped');

  const snapshot = ledger.allFacts();
  snapshot[0].knownBy.push('killer');
  assert.equal(ledger.get(privatePlayerFact.id)?.knownBy.includes('killer'), false);
}

{
  const ledger = new FactLedger([privatePlayerFact, publicFact, killerFact]);
  const projections = buildKnowledgeProjections(ledger, ['lin_yue']);

  assert.deepEqual(projections.player.factIds.sort(), [privatePlayerFact.id, publicFact.id].sort());
  assert.deepEqual(projections.killer.factIds.sort(), [killerFact.id, publicFact.id].sort());
  assert.deepEqual(projections.npcs.lin_yue.factIds, [publicFact.id]);
  assert.equal(projections.worldModel.factIds.length, 3);
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  state.killerKnowledge.knowsPlayerOpenedPackage = true;
  state.clues.push({
    id: 'clue-exterior-label',
    title: 'Exterior label',
    detail: 'The label names the recipient.',
    source: 'player_discovered',
    weight: 5,
    discoveredAt: { run: 1, minute: state.minute },
    isPersistent: true,
  });

  const ledger = buildFactLedgerFromGameState(state, {
    loopId: 'loop-1',
    turnId: 'turn-1',
    stateVersion: 0,
  });
  const projections = buildKnowledgeProjections(ledger, ['lin_yue']);

  assert(projections.player.factIds.includes('fact.clue.clue-exterior-label.discovered'));
  assert(!projections.player.factIds.includes('fact.killer.knowledge.knowsPlayerOpenedPackage'));
  assert(projections.killer.factIds.includes('fact.killer.knowledge.knowsPlayerOpenedPackage'));
  assert.equal(ledger.get('fact.game.police_phase')?.value, 'not_contacted');
  assert.equal(ledger.get('fact.game.evidence_phase')?.value, 'package_unnoticed');
  assert.equal(ledger.get('fact.game.killer_status')?.value, 'alive');
  assert.equal(
    ledger.get('fact.world.character.chen_huaimin.location')?.value,
    'room_501',
  );
  assert.equal(
    ledger.get('fact.world.character.chen_huaimin.status')?.value,
    'active',
  );
  assert(ledger.activeFacts().every((fact) => fact.sourceEventId.startsWith('legacy.snapshot.')));
}
