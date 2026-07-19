import type { Fact } from '@murder-loop-ai/ai-contracts';
import type { GameState } from '@murder-loop-ai/shared';
import { FactLedger } from './FactLedger';

export interface FactProjection {
  viewerId: string;
  facts: Fact[];
  factIds: string[];
}

export interface KnowledgeProjections {
  player: FactProjection;
  killer: FactProjection;
  npcs: Record<string, FactProjection>;
  worldModel: FactProjection;
}

export interface LegacyStateFactOptions {
  loopId: string;
  turnId: string;
  stateVersion: number;
}

export function buildKnowledgeProjections(
  ledger: FactLedger,
  npcIds: string[],
): KnowledgeProjections {
  return {
    player: projectFor(ledger, 'player'),
    killer: projectFor(ledger, 'killer'),
    npcs: Object.fromEntries(npcIds.map((npcId) => [npcId, projectFor(ledger, npcId)])),
    worldModel: createProjection('world_model', ledger.activeFacts()),
  };
}

export function buildFactLedgerFromGameState(
  state: GameState,
  options: LegacyStateFactOptions,
): FactLedger {
  const facts: Fact[] = [];
  const sourceEventId = `legacy.snapshot.${options.loopId}.${options.stateVersion}`;
  const add = (
    id: string,
    subject: string,
    predicate: string,
    value: Fact['value'],
    visibleTo: string[],
    knownBy: string[],
  ) => {
    facts.push({
      id,
      subject,
      predicate,
      value,
      sourceEventId,
      visibleTo,
      knownBy,
      validFromTurn: options.turnId,
      invalidatedBy: null,
    });
  };

  add('fact.game.run', 'game', 'run', state.run, ['player', 'killer'], ['system']);
  add('fact.game.minute', 'game', 'minute', state.minute, ['player', 'killer'], ['system']);
  add('fact.game.phase', 'game', 'phase', state.phase, ['player'], ['player', 'system']);
  add('fact.player.injury', 'player', 'injury', state.player.injury, ['player'], ['player', 'system']);
  add('fact.player.phone_functional', 'player', 'phone_functional', state.phoneFunctional, ['player'], ['player', 'system']);
  add('fact.player.phone_battery', 'player', 'phone_battery', state.phoneBattery, ['player'], ['player', 'system']);
  add('fact.player.holding', 'player', 'holding', state.playerHolding, ['player'], ['player', 'system']);

  for (const clue of state.clues) {
    add(
      `fact.clue.${clue.id}.discovered`,
      clue.id,
      'discovered',
      true,
      ['player'],
      ['player', 'system'],
    );
  }

  for (const roomObject of Object.values(state.room)) {
    if (!roomObject.visible) continue;
    add(
      `fact.object.${roomObject.id}.location`,
      roomObject.id,
      'location',
      roomObject.location,
      ['player'],
      ['player', 'system'],
    );
    for (const [key, value] of Object.entries(roomObject.state)) {
      add(
        `fact.object.${roomObject.id}.${key}`,
        roomObject.id,
        key,
        value,
        ['player'],
        ['player', 'system'],
      );
    }
  }

  for (const [key, value] of Object.entries(state.killerKnowledge)) {
    add(
      `fact.killer.knowledge.${key}`,
      'killer',
      key,
      value,
      ['system'],
      ['killer', 'system'],
    );
  }

  for (const [characterId, knowledge] of Object.entries(state.world?.knowledge ?? {})) {
    const viewerId = worldCharacterToViewer(characterId);
    for (const [factId, value] of Object.entries(knowledge.facts)) {
      add(
        `fact.world_knowledge.${characterId}.${factId}`,
        characterId,
        factId,
        {
          confidence: value.confidence,
          source: value.source,
          minuteLearned: value.minuteLearned,
        },
        ['system'],
        [viewerId, 'system'],
      );
    }
  }

  return new FactLedger(facts);
}

function projectFor(ledger: FactLedger, viewerId: string): FactProjection {
  return createProjection(viewerId, ledger.factsFor(viewerId));
}

function createProjection(viewerId: string, facts: Fact[]): FactProjection {
  return {
    viewerId,
    facts,
    factIds: facts.map((fact) => fact.id),
  };
}

function worldCharacterToViewer(characterId: string): string {
  if (characterId === 'chen_huaimin') return 'killer';
  if (characterId === 'real_police') return 'police_dispatch';
  return characterId;
}
