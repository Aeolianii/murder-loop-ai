import { START_MINUTE } from '@murder-loop-ai/shared';
import type {
  CharacterId,
  CharacterState,
  EventEffect,
  KnowledgeState,
  LocationId,
  LocationState,
  ObjectState,
  WorldEvent,
  WorldState,
} from './worldTypes';
import { NpcCoordinator } from './npcCoordinator';
import type { NpcAdapter } from './npcTypes';

function character(
  id: CharacterId,
  name: string,
  faction: CharacterState['faction'],
  location: LocationId,
  riskTolerance: number,
  goalStack: string[] = [],
): CharacterState {
  return {
    id,
    name,
    faction,
    location,
    status: 'active',
    goalStack,
    risk: 0,
    riskTolerance,
    suspicion: 0,
    stress: 0,
    visibility: 'visible',
  };
}

function location(id: LocationId, name: string, neighbors: LocationId[]): LocationState {
  return { id, name, neighbors, risk: 0 };
}

function knowledge(): KnowledgeState {
  return { facts: {} };
}

export function createInitialWorldState(): WorldState {
  const objects: Record<string, ObjectState> = {
    package: { id: 'package', name: 'Suspicious package', location: 'room_503', flags: { opened: false, photographed: false } },
    package_photo: { id: 'package_photo', name: 'Package photo', location: 'phone', flags: { exists: false, backedUp: false } },
    phone: { id: 'phone', name: 'Phone', location: 'player', flags: { recording: false } },
    keys: { id: 'keys', name: 'Spare keys', location: 'chen_huaimin', flags: {} },
    door_lock: { id: 'door_lock', name: 'Room 503 lock', location: 'room_503', flags: { locked: true, barricaded: false } },
    window_lock: { id: 'window_lock', name: 'Room 503 window lock', location: 'room_503', flags: { locked: false, curtainClosed: false } },
  };

  return {
    run: 1,
    minute: START_MINUTE,
    threat: 24,
    locations: {
      room_503: location('room_503', 'Room 503', ['corridor_5f']),
      room_501: location('room_501', 'Room 501', ['corridor_5f']),
      corridor_5f: location('corridor_5f', 'Fifth-floor corridor', ['room_503', 'room_501', 'stairwell']),
      stairwell: location('stairwell', 'Stairwell', ['corridor_5f', 'lobby']),
      lobby: location('lobby', 'Lobby', ['stairwell', 'parking_lot']),
      parking_lot: location('parking_lot', 'Parking lot', ['lobby']),
    },
    characters: {
      player: character('player', 'Shen Zhixia', 'player', 'room_503', 40, ['survive', 'preserve_evidence']),
      chen_huaimin: character('chen_huaimin', 'Chen Huaimin', 'chen_huaimin_side', 'room_501', 45, ['recover_package']),
      lin_yue: character('lin_yue', 'Lin Yue', 'neutral', 'parking_lot', 55, ['confirm_player_safety']),
      real_police: character('real_police', 'Real police', 'police', 'parking_lot', 70, ['verify_report']),
      fake_police: character('fake_police', 'Fake police', 'chen_huaimin_side', 'parking_lot', 30, ['wait_for_order']),
    },
    objects: objects as WorldState['objects'],
    knowledge: {
      player: knowledge(),
      chen_huaimin: knowledge(),
      lin_yue: knowledge(),
      real_police: knowledge(),
      fake_police: knowledge(),
    },
    events: [],
    narrationCursor: 0,
    pendingNarration: [],
    consumedNarrationEventIds: [],
    affectedCharacters: [],
  };
}

function uniqueCharacters(ids: CharacterId[]) {
  return [...new Set(ids)];
}

function resolvePathTarget(state: WorldState, effect: EventEffect): unknown {
  switch (effect.target) {
    case 'character':
      return state.characters[effect.targetId as CharacterId];
    case 'location':
      return state.locations[effect.targetId as LocationId];
    case 'object':
      return state.objects[effect.targetId as keyof WorldState['objects']];
    case 'knowledge':
      return state.knowledge[effect.targetId as CharacterId];
    default:
      return undefined;
  }
}

function getContainer(target: unknown, path: string) {
  const parts = path.split('.');
  let cursor = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  return { container: cursor, key: parts[parts.length - 1] };
}

export function applyEventEffects(state: WorldState, event: WorldEvent): CharacterId[] {
  const affected: CharacterId[] = [];

  for (const effect of event.effects) {
    const target = resolvePathTarget(state, effect);
    if (!target) continue;

    const { container, key } = getContainer(target, effect.path);
    const current = container[key];

    if (effect.op === 'set') {
      container[key] = effect.value;
    } else if (effect.op === 'inc') {
      container[key] = Number(current ?? 0) + Number(effect.value);
    } else if (effect.op === 'dec') {
      container[key] = Number(current ?? 0) - Number(effect.value);
    } else if (effect.op === 'multiply') {
      container[key] = Number(current ?? 0) * Number(effect.value);
    } else if (effect.op === 'add') {
      if (Array.isArray(current)) {
        if (!current.includes(effect.value)) current.push(effect.value);
      } else {
        container[key] = effect.value;
      }
    } else if (effect.op === 'remove') {
      if (Array.isArray(current)) {
        container[key] = current.filter((item) => item !== effect.value);
      } else {
        delete container[key];
      }
    }

    if (effect.target === 'character' || effect.target === 'knowledge') {
      affected.push(effect.targetId as CharacterId);
    }
  }

  return uniqueCharacters(affected);
}

function movementEvents(state: WorldState): WorldEvent[] {
  const events: WorldEvent[] = [];

  for (const actor of Object.values(state.characters)) {
    if (!actor.destination || actor.location === actor.destination) continue;
    const from = actor.location;
    const canMove = state.locations[from].neighbors.includes(actor.destination);
    if (!canMove) {
      events.push({
        id: `movement.${actor.id}.blocked.${actor.destination}.at.${state.minute}`,
        minute: state.minute,
        type: 'movement',
        actors: [actor.id],
        location: from,
        facts: [`${actor.id}_blocked_from_${actor.destination}`],
        visibility: actor.id === 'player' ? 'player' : 'hidden',
        effects: [{
          target: 'character',
          targetId: actor.id,
          op: 'set',
          path: 'status',
          value: 'blocked',
          reason: 'Destination is not adjacent to the current location.',
        }],
      });
      continue;
    }

    events.push({
      id: `movement.${actor.id}.from.${from}.to.${actor.destination}.at.${state.minute}`,
      minute: state.minute,
      type: 'movement',
      actors: [actor.id],
      location: actor.destination,
      facts: [`${actor.id}_moved_from_${from}_to_${actor.destination}`],
      visibility: actor.id === 'player' ? 'player' : 'hidden',
      effects: [
        {
          target: 'character',
          targetId: actor.id,
          op: 'set',
          path: 'location',
          value: actor.destination,
          reason: 'Character moves one step to the destination.',
        },
        {
          target: 'character',
          targetId: actor.id,
          op: 'set',
          path: 'destination',
          value: undefined,
          reason: 'Destination is cleared after this tick movement.',
        },
      ],
    });
  }

  return events;
}

function realPoliceMeetsFakePolice(state: WorldState): WorldEvent | null {
  if (state.events.some((event) => event.id === 'encounter.real_police_meets_fake_police')) return null;
  const realPolice = state.characters.real_police;
  const fakePolice = state.characters.fake_police;
  if (realPolice.location !== fakePolice.location) return null;

  return {
    id: 'encounter.real_police_meets_fake_police',
    minute: state.minute,
    type: 'encounter',
    actors: ['real_police', 'fake_police'],
    location: realPolice.location,
    facts: ['real_police_met_fake_police', 'fake_police_identity_pressure_increased'],
    visibility: 'hidden',
    effects: [
      {
        target: 'character',
        targetId: 'fake_police',
        op: 'inc',
        path: 'risk',
        value: 60,
        reason: 'The fake police meet real police, sharply increasing impersonation risk.',
      },
      {
        target: 'character',
        targetId: 'fake_police',
        op: 'add',
        path: 'goalStack',
        value: 'retreat_or_switch_route',
        reason: 'Direct entry should be canceled when risk exceeds tolerance.',
      },
      {
        target: 'knowledge',
        targetId: 'real_police',
        op: 'add',
        path: 'facts.fake_police_present',
        value: { confidence: 0.8, source: 'seen', minuteLearned: state.minute },
        reason: 'Real police directly see a suspicious police impersonator.',
      },
    ],
    narrationHint: 'If the player does not know this happened, narration must only imply it later.',
  };
}

function chenInterceptsLinYue(state: WorldState): WorldEvent | null {
  if (state.events.some((event) => event.id === 'conflict.chen_intercepts_linyue')) return null;
  const chen = state.characters.chen_huaimin;
  const linYue = state.characters.lin_yue;
  const linYueHasPhoto = Boolean(state.knowledge.lin_yue.facts.package_photo);
  if (!linYueHasPhoto || chen.location !== linYue.location) return null;

  return {
    id: 'conflict.chen_intercepts_linyue',
    minute: state.minute,
    type: 'conflict',
    actors: ['chen_huaimin', 'lin_yue'],
    location: chen.location,
    facts: ['chen_intercepts_linyue', 'linyue_has_external_evidence'],
    visibility: chen.location === 'corridor_5f' ? 'player' : 'hidden',
    effects: [
      {
        target: 'character',
        targetId: 'lin_yue',
        op: 'inc',
        path: 'stress',
        value: 20,
        reason: 'Lin Yue is intercepted by Chen Huaimin while approaching the scene with evidence.',
      },
      {
        target: 'character',
        targetId: 'lin_yue',
        op: 'add',
        path: 'goalStack',
        value: 'preserve_photo',
        reason: 'After being intercepted, Lin Yue should prioritize preserving external evidence.',
      },
      {
        target: 'character',
        targetId: 'chen_huaimin',
        op: 'add',
        path: 'goalStack',
        value: 'suppress_lin_yue',
        reason: 'Chen Huaimin realizes Lin Yue may have external evidence.',
      },
      {
        target: 'knowledge',
        targetId: 'chen_huaimin',
        op: 'add',
        path: 'facts.linyue_has_external_evidence',
        value: { confidence: 0.75, source: 'inferred', minuteLearned: state.minute },
        reason: 'Lin Yue approaching the scene implies the evidence may have been shared externally.',
      },
      {
        target: 'location',
        targetId: chen.location,
        op: 'inc',
        path: 'risk',
        value: 15,
        reason: 'Witness and suspect goals collide in the same location.',
      },
    ],
    narrationHint: 'Narrate only the confirmed encounter and obstruction; do not add injuries or deaths.',
  };
}

function detectWorldEvents(state: WorldState): WorldEvent[] {
  return [
    realPoliceMeetsFakePolice(state),
    chenInterceptsLinYue(state),
  ].filter((event): event is WorldEvent => Boolean(event));
}

function replanAffectedCharacters(state: WorldState, affectedCharacters: CharacterId[]) {
  for (const id of affectedCharacters) {
    const actor = state.characters[id];
    if (!actor) continue;
    if (id === 'fake_police' && actor.risk > actor.riskTolerance && actor.goalStack.includes('retreat_or_switch_route')) {
      actor.currentAction = 'retreat_or_switch_route';
      actor.destination = 'parking_lot';
      actor.status = 'moving';
    }
  }
}

function applyEvents(state: WorldState, events: WorldEvent[]) {
  for (const event of events) {
    if (state.events.some((existing) => existing.id === event.id)) continue;
    state.events.push(event);
    state.pendingNarration.push(event);
    const affected = applyEventEffects(state, event);
    state.affectedCharacters = uniqueCharacters([...state.affectedCharacters, ...affected]);
  }
}

export async function advanceWorldTick(current: WorldState, npcAdapter?: NpcAdapter): Promise<WorldState> {
  const state = structuredClone(current) as WorldState;
  state.minute += 1;
  state.affectedCharacters = uniqueCharacters(state.affectedCharacters);
  applyEvents(state, movementEvents(state));
  applyEvents(state, detectWorldEvents(state));
  const coordinator = new NpcCoordinator(npcAdapter ?? null);
  return coordinator.runTick(state);
}

export function advanceWorldTickSync(current: WorldState): WorldState {
  const state = structuredClone(current) as WorldState;
  state.minute += 1;
  state.affectedCharacters = uniqueCharacters(state.affectedCharacters);
  applyEvents(state, movementEvents(state));
  applyEvents(state, detectWorldEvents(state));
  replanAffectedCharacters(state, state.affectedCharacters);
  state.affectedCharacters = [];
  return state;
}

export type {
  CharacterId,
  CharacterState,
  EventEffect,
  KnowledgeFact,
  KnowledgeState,
  LocationId,
  LocationState,
  ObjectId,
  ObjectState,
  WorldEvent,
  WorldState,
} from './worldTypes';
