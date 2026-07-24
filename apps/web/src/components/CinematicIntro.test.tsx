import assert from 'node:assert/strict';
import {
  CINEMATIC_INTRO_FINAL_DURATION_SECONDS,
  CINEMATIC_INTRO_SCENES,
  CINEMATIC_INTRO_TEXT_DURATION_SECONDS,
} from './CinematicIntro';

assert.deepEqual(CINEMATIC_INTRO_SCENES, [
  'death',
  'sensory-memory',
  'awakening',
]);
assert.ok(CINEMATIC_INTRO_TEXT_DURATION_SECONDS < 1.5);
assert.ok(CINEMATIC_INTRO_FINAL_DURATION_SECONDS < 2);
