import type {
  CharacterId,
  KnowledgeSource,
  WorldEvent,
  WorldState,
} from './worldTypes';

interface GrantKnowledgeOptions {
  id: string;
  minute: number;
  target: CharacterId;
  factId: string;
  source: KnowledgeSource;
  confidence: number;
  reason: string;
  actors?: CharacterId[];
  visibility?: WorldEvent['visibility'];
  facts?: string[];
}

export function createKnowledgeEvent(options: GrantKnowledgeOptions): WorldEvent {
  return {
    id: options.id,
    minute: options.minute,
    type: 'knowledge',
    actors: options.actors ?? [options.target],
    facts: options.facts ?? [options.factId],
    visibility: options.visibility ?? 'hidden',
    effects: [
      {
        target: 'knowledge',
        targetId: options.target,
        op: 'add',
        path: `facts.${options.factId}`,
        value: {
          confidence: options.confidence,
          source: options.source,
          minuteLearned: options.minute,
        },
        reason: options.reason,
      },
    ],
  };
}

export function createInformantPoliceCallEvent(world: WorldState): WorldEvent {
  return createKnowledgeEvent({
    id: `informant.chen_knows_police_call.${world.minute}`,
    minute: world.minute,
    target: 'chen_huaimin',
    factId: 'player_called_police',
    source: 'informant',
    confidence: 0.9,
    reason: 'A police informant tells Chen Huaimin that Room 503 has called police.',
    actors: ['real_police', 'chen_huaimin'],
    visibility: 'hidden',
    facts: ['chen_informant_reported_503_police_call', 'player_called_police'],
  });
}

export function chenKnowsPoliceCalled(world?: WorldState): boolean {
  const fact = world?.knowledge.chen_huaimin.facts.player_called_police;
  return Boolean(fact && fact.confidence >= 0.5);
}
