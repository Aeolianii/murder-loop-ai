import assert from 'node:assert/strict';
import {
  META_PROGRESS_SAVE_KEY,
  createEmptyPlayerProgress,
  loadPlayerProgress,
  persistPlayerProgress,
  unlockEnding,
} from './playerProgress';

const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};

const empty = createEmptyPlayerProgress();
const firstUnlock = unlockEnding(empty, 'B', 58, '2026-07-23T08:00:00.000Z');
const improved = unlockEnding(firstUnlock, 'B', 64, '2026-07-24T08:00:00.000Z');
const secondUnlock = unlockEnding(improved, 'S', 96, '2026-07-25T08:00:00.000Z');

assert.equal(improved.unlockedEndings.B?.unlockedAt, '2026-07-23T08:00:00.000Z');
assert.equal(improved.unlockedEndings.B?.bestScore, 64);
assert.equal(Object.keys(secondUnlock.unlockedEndings).length, 2);

persistPlayerProgress(secondUnlock, fakeStorage);
assert.deepEqual(loadPlayerProgress(fakeStorage), secondUnlock);

storage.set(META_PROGRESS_SAVE_KEY, '{broken');
assert.deepEqual(loadPlayerProgress(fakeStorage), createEmptyPlayerProgress());
