import { FRONTEND_SAVE_KEY, loadFrontendState, resetFrontendProgress } from './frontendState';
import { getClueAsset } from './clueAssets';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

fakeStorage.setItem(FRONTEND_SAVE_KEY, JSON.stringify({
  time: '23:31',
  clues: [{ id: 'wrong_package', name: '旧线索', description: '应该被清除', status: 'known' }],
  isParsing: true,
}));

const resetState = resetFrontendProgress(fakeStorage);
assert(!storage.has(FRONTEND_SAVE_KEY), 'resetFrontendProgress should clear persisted frontend state');
assert(resetState.time === '23:00', 'resetFrontendProgress should return the opening time');
assert(resetState.phase === 'intro', 'resetFrontendProgress should return the opening phase');
assert(resetState.isParsing === false, 'resetFrontendProgress should not leave parsing state active');
assert(resetState.clues[0]?.id === 'wrong_package', 'opening package clue should use the canonical clue id');
assert(Boolean(getClueAsset(resetState.clues[0].id)), 'opening package clue should have an image asset');
assert(Boolean(getClueAsset('c1')), 'legacy opening package clue id should still resolve to an image asset');

fakeStorage.setItem(FRONTEND_SAVE_KEY, JSON.stringify({ time: '23:12', isParsing: true }));
const loadedState = loadFrontendState(fakeStorage);
assert(loadedState.time === '23:12', 'loadFrontendState should load persisted fields');
assert(loadedState.isParsing === false, 'loadFrontendState should sanitize transient parsing state');
