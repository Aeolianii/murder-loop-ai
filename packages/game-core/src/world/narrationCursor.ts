import type { WorldEvent, WorldState } from '@murder-loop-ai/shared';

export interface WorldNarrationBatch {
  fromCursor: number;
  toCursor: number;
  events: WorldEvent[];
  scannedEventIds: string[];
}

function clampCursor(cursor: number, eventCount: number) {
  return Math.max(0, Math.min(eventCount, Math.floor(cursor)));
}

export function resolveWorldNarrationCursor(world: WorldState): number {
  const runtimeCursor = (world as WorldState & { narrationCursor?: number }).narrationCursor;
  if (Number.isFinite(runtimeCursor)) {
    return clampCursor(runtimeCursor as number, world.events.length);
  }

  const pendingIds = new Set((world.pendingNarration ?? []).map((event) => event.id));
  const firstPendingIndex = world.events.findIndex((event) => pendingIds.has(event.id));
  if (firstPendingIndex >= 0) return firstPendingIndex;

  const consumedIds = new Set(world.consumedNarrationEventIds ?? []);
  let lastConsumedIndex = -1;
  world.events.forEach((event, index) => {
    if (consumedIds.has(event.id)) lastConsumedIndex = index;
  });
  if (lastConsumedIndex >= 0) return lastConsumedIndex + 1;

  // A world without cursor metadata is a legacy save. Its event log is history,
  // not a fresh narration outbox.
  return world.events.length;
}

export function readWorldNarrationBatch(world: WorldState): WorldNarrationBatch {
  const fromCursor = resolveWorldNarrationCursor(world);
  const toCursor = world.events.length;
  const scannedEvents = world.events.slice(fromCursor, toCursor);
  const consumedIds = new Set(world.consumedNarrationEventIds ?? []);
  const events = scannedEvents.filter((event) =>
    (event.visibility === 'player' || event.visibility === 'public')
    && !consumedIds.has(event.id)
  );

  return {
    fromCursor,
    toCursor,
    events,
    scannedEventIds: scannedEvents.map((event) => event.id),
  };
}

export function commitWorldNarrationBatch(
  current: WorldState,
  batch: WorldNarrationBatch,
): WorldState {
  const world = structuredClone(current) as WorldState;
  const currentCursor = resolveWorldNarrationCursor(world);
  world.narrationCursor = Math.max(currentCursor, clampCursor(batch.toCursor, world.events.length));

  const scannedIds = new Set(batch.scannedEventIds);
  world.pendingNarration = (world.pendingNarration ?? []).filter((event) => !scannedIds.has(event.id));
  world.consumedNarrationEventIds = [...new Set([
    ...(world.consumedNarrationEventIds ?? []),
    ...batch.events.map((event) => event.id),
  ])];
  return world;
}
