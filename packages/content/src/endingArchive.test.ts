import assert from 'node:assert/strict';
import { ENDING_CATALOG, FULL_STORY_RECAP } from './endingArchive';

assert.deepEqual(
  ENDING_CATALOG.map((ending) => ending.tier),
  ['S', 'A', 'B', 'C', 'D'],
  'the archive must expose exactly five ordered endings',
);
assert.equal(new Set(ENDING_CATALOG.map((ending) => ending.title)).size, 5);
assert.equal(FULL_STORY_RECAP[0]?.id, 'first-death');
assert.equal(FULL_STORY_RECAP.at(-1)?.id, 'truth-resolved');
assert(
  FULL_STORY_RECAP.every((chapter) =>
    chapter.playerView.trim() && chapter.hiddenTruth.trim(),
  ),
  'every recap chapter must distinguish the player view from hidden truth',
);
