export type CharacterId =
  | 'player'
  | 'chen_huaimin'
  | 'lin_yue'
  | 'real_police'
  | 'fake_police';

export type LocationId =
  | 'room_503'
  | 'room_501'
  | 'corridor_5f'
  | 'stairwell'
  | 'lobby'
  | 'parking_lot';

export type ObjectId = 'package' | 'package_photo' | 'phone' | 'keys' | 'door_lock' | 'window_lock';
export type GoalId = string;
export type ActionId = string;

export interface LocationState {
  id: LocationId;
  name: string;
  neighbors: LocationId[];
  risk: number;
}

export interface ObjectState {
  id: ObjectId;
  name: string;
  location: LocationId | CharacterId | ObjectId;
  flags: Record<string, boolean | number | string | null>;
}

export interface CharacterState {
  id: CharacterId;
  name: string;
  faction: 'player' | 'chen_huaimin_side' | 'police' | 'neutral';
  location: LocationId;
  destination?: LocationId;
  status: 'active' | 'waiting' | 'moving' | 'blocked' | 'injured' | 'dead' | 'arrested' | 'fled';
  goalStack: GoalId[];
  currentAction?: ActionId;
  risk: number;
  riskTolerance: number;
  suspicion: number;
  stress: number;
  visibility: 'hidden' | 'partially_visible' | 'visible';
}

export type KnowledgeSource = 'seen' | 'heard' | 'message' | 'inferred' | 'lied_by_other' | 'memory';

export interface KnowledgeFact {
  confidence: number;
  source: KnowledgeSource;
  minuteLearned: number;
}

export interface KnowledgeState {
  facts: Record<string, KnowledgeFact>;
}

export interface EventEffect {
  target: 'character' | 'object' | 'location' | 'knowledge' | 'scheduler' | 'relationship';
  targetId: string;
  op: 'set' | 'inc' | 'dec' | 'add' | 'remove' | 'multiply';
  path: string;
  value: unknown;
  reason: string;
}

export interface WorldEvent {
  id: string;
  minute: number;
  type: 'movement' | 'encounter' | 'conflict' | 'knowledge' | 'object' | 'message' | 'ending' | 'threat';
  actors: CharacterId[];
  location?: LocationId;
  facts: string[];
  visibility: 'player' | 'hidden' | 'public';
  effects: EventEffect[];
  narrationHint?: string;
}

export interface WorldState {
  run: number;
  minute: number;
  threat: number;
  locations: Record<LocationId, LocationState>;
  characters: Record<CharacterId, CharacterState>;
  objects: Record<ObjectId, ObjectState>;
  knowledge: Record<CharacterId, KnowledgeState>;
  events: WorldEvent[];
  pendingNarration: WorldEvent[];
  consumedNarrationEventIds: string[];
  affectedCharacters: CharacterId[];
}
