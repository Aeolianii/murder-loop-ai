import type { CharacterId, WorldState } from './worldTypes';
import type { AtomicTask, TaskPlan } from './npcTypes';

export function fallbackReplanAll(state: WorldState, affected: CharacterId[]): WorldState {
  for (const id of affected) {
    const actor = state.characters[id];
    if (!actor) continue;
    if (id === 'fake_police' && actor.risk > actor.riskTolerance && actor.goalStack.includes('retreat_or_switch_route')) {
      actor.currentAction = 'retreat_or_switch_route'; actor.destination = 'parking_lot'; actor.status = 'moving'; continue;
    }
    if (id === 'chen_huaimin' && actor.status === 'active' && !actor.destination) {
      actor.destination = actor.location === 'room_501' ? 'corridor_5f' : 'corridor_5f'; actor.status = 'moving'; continue;
    }
    if (id === 'lin_yue' && actor.status === 'active' && !actor.destination) {
      actor.destination = actor.location === 'parking_lot' ? 'lobby' : actor.location === 'lobby' ? 'stairwell' : undefined; actor.status = actor.destination ? 'moving' : 'waiting'; continue;
    }
    if (id === 'real_police' && actor.goalStack.some((g) => g.includes('respond') || g.includes('verify'))) {
      if (!actor.destination && actor.location !== 'corridor_5f') { actor.destination = actor.location === 'parking_lot' ? 'lobby' : actor.location === 'lobby' ? 'stairwell' : 'corridor_5f'; actor.status = 'moving'; } continue;
    }
    if (!actor.destination && actor.status === 'active') actor.status = 'waiting';
  }
  return state;
}

export function fallbackForNpc(state: WorldState, npcId: CharacterId): TaskPlan | null {
  const actor = state.characters[npcId];
  if (!actor) return null;
  return { tick: state.minute, intent: 'fallback_wait', tasks: [{ action: 'wait', target: actor.location, reason: 'fallback: LLM not available', priority: 1 }], destination: undefined, newStatus: 'waiting' };
}
