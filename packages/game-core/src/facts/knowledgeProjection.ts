import type { Fact } from '@murder-loop-ai/ai-contracts';
import type { GameState } from '@murder-loop-ai/shared';
import { FactLedger } from './FactLedger';
import { createInitialWorldState } from '../world/worldSimulator';

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
  add('fact.game.police_phase', 'game', 'police_phase', state.policePhase, ['system'], ['system']);
  add('fact.game.evidence_phase', 'game', 'evidence_phase', state.evidencePhase, ['system'], ['system']);
  add('fact.game.killer_status', 'game', 'killer_status', state.killerStatus, ['system'], ['system']);
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

  const world = state.world ?? createInitialWorldState();
  {
    for (const character of Object.values(world.characters)) {
      const viewerId = worldCharacterToViewer(character.id);
      add(
        `fact.world.character.${character.id}.location`,
        character.id,
        'location',
        character.location,
        ['system'],
        [viewerId, 'system'],
      );
      add(
        `fact.world.character.${character.id}.status`,
        character.id,
        'status',
        character.status,
        ['system'],
        [viewerId, 'system'],
      );
      for (const capability of character.capabilities ?? []) {
        add(
          `capability.${character.id}.${capability}`,
          character.id,
          'capability',
          capability,
          ['system'],
          [viewerId, 'system'],
        );
      }
    }
    for (const object of Object.values(world.objects)) {
      add(
        `fact.world.object.${object.id}.location`,
        object.id,
        'location',
        object.location,
        ['system'],
        ['system'],
      );
      for (const [key, value] of Object.entries(object.flags)) {
        add(
          `fact.world.object.${object.id}.${key}`,
          object.id,
          key,
          value,
          ['system'],
          ['system'],
        );
      }
    }

    const killerCanAct = !['incapacitated', 'dead', 'arrested', 'fled'].includes(state.killerStatus);
    if (killerCanAct) {
      add(
        'capability.killer.attack',
        'chen_huaimin',
        'attack_capable',
        true,
        ['system'],
        ['killer', 'system'],
      );
      add(
        'capability.killer.window_route',
        'chen_huaimin',
        'window_route_capable',
        true,
        ['system'],
        ['killer', 'system'],
      );
      if (world.objects.keys.location === 'chen_huaimin') {
        add(
          'capability.killer.spare_key',
          'chen_huaimin',
          'has_spare_key',
          true,
          ['system'],
          ['killer', 'system'],
        );
      }
    }
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
