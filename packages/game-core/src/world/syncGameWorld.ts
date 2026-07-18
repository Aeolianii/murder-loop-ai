import type { GameState, WorldState } from '@murder-loop-ai/shared';
import { createInitialWorldState } from './worldSimulator';

function cloneWorld(world: WorldState): WorldState {
  return structuredClone(world) as WorldState;
}

function addGoal(world: WorldState, characterId: keyof WorldState['characters'], goal: string) {
  const goals = world.characters[characterId].goalStack;
  if (!goals.includes(goal)) goals.push(goal);
}

function syncClockAndThreat(state: GameState, world: WorldState) {
  world.run = state.run;
  world.minute = state.minute;
  world.threat = state.threat;
}

function syncEvidence(state: GameState, world: WorldState) {
  const photographed = state.evidencePhase === 'package_photographed'
    || state.evidencePhase === 'evidence_shared'
    || state.evidencePhase === 'evidence_backed_up'
    || state.evidencePhase === 'evidence_hidden'
    || state.evidencePhase === 'evidence_submitted'
    || state.room.package?.state.photographed === true;

  if (!photographed) return;

  world.objects.package.flags.photographed = true;
  world.objects.package_photo.flags.exists = true;
  world.knowledge.player.facts.package_photo = {
    confidence: 1,
    source: 'seen',
    minuteLearned: state.minute,
  };
}

function syncLinYue(state: GameState, world: WorldState) {
  const linYueHasPhoto = state.linYuePhase === 'received_photo'
    || state.linYuePhase === 'calling_police'
    || state.evidencePhase === 'evidence_shared';

  if (!linYueHasPhoto) return;

  world.objects.package_photo.flags.exists = true;
  world.objects.package_photo.flags.sharedWithLinYue = true;
  world.knowledge.lin_yue.facts.package_photo = {
    confidence: 1,
    source: 'message',
    minuteLearned: state.minute,
  };
  addGoal(world, 'lin_yue', 'preserve_photo');
}

function syncPolice(state: GameState, world: WorldState) {
  const policeHasReport = state.policePhase === 'verifying_report'
    || state.policePhase === 'dispatch_pending'
    || state.policePhase === 'real_police_en_route'
    || state.policePhase === 'arrived'
    || state.policePhase === 'misled';

  if (!policeHasReport) return;

  world.knowledge.real_police.facts.report_received = {
    confidence: 1,
    source: 'message',
    minuteLearned: state.minute,
  };
  world.knowledge.real_police.facts.reported_fake_police = {
    confidence: state.policePhase === 'misled' ? 0.45 : 0.9,
    source: 'message',
    minuteLearned: state.minute,
  };
  addGoal(world, 'real_police', 'respond_to_report');
}

function syncDoorAndWindow(state: GameState, world: WorldState) {
  const door = state.room.front_door?.state;
  if (door) {
    world.objects.door_lock.flags.locked = door.locked === true;
    world.objects.door_lock.flags.barricaded = door.barricaded === true;
    world.objects.door_lock.flags.chainLocked = door.chainLocked === true;
    world.objects.door_lock.flags.opened = door.opened === true;
  }

  const window = state.room.window?.state;
  if (window) {
    world.objects.window_lock.flags.locked = window.locked === true;
    world.objects.window_lock.flags.curtainClosed = window.curtainClosed === true;
    world.objects.window_lock.flags.opened = window.opened === true;
  }
}

export function syncGameStateToWorld(state: GameState, current: WorldState): WorldState {
  const world = cloneWorld(current);

  syncClockAndThreat(state, world);
  syncEvidence(state, world);
  syncLinYue(state, world);
  syncPolice(state, world);
  syncDoorAndWindow(state, world);

  return world;
}

export function ensureWorldState(state: GameState): WorldState {
  const base = state.world ? cloneWorld(state.world) : createInitialWorldState();
  base.consumedNarrationEventIds ??= [];
  return syncGameStateToWorld(state, base);
}
