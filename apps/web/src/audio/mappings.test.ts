import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  actionSfxMap,
  ambientByPhase,
  getHeartbeatByThreat,
  killerSfxMap,
} from './mappings';

assert.deepEqual(
  actionSfxMap.inspect,
  ['investigate'],
  'inspect must use the fixed investigate sound',
);
assert.deepEqual(
  actionSfxMap.secure_entry,
  ['defense'],
  'secure_entry must use the fixed defense sound',
);
assert.deepEqual(
  actionSfxMap.preserve_evidence,
  ['evidence'],
  'preserve_evidence must use the fixed evidence sound',
);
assert.deepEqual(
  actionSfxMap.unknown,
  ['default'],
  'unknown free-form actions must use the fixed default sound',
);

const manifestUrl = new URL('../../public/audio/repository/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
  bgm: string;
  sounds: Record<string, string[]>;
};
const configuredSoundIds = new Set(Object.keys(manifest.sounds));
const mappedSoundIds = [
  ...Object.values(actionSfxMap).flat(),
  ...Object.values(killerSfxMap).flat(),
  ...Object.values(ambientByPhase).flatMap(value => value ? [value] : []),
  getHeartbeatByThreat(45),
  'submit',
  'danger',
].filter((value): value is string => Boolean(value));

for (const soundId of mappedSoundIds) {
  assert(
    configuredSoundIds.has(soundId),
    `fixed sound "${soundId}" must exist in the generated audio manifest`,
  );
}
assert(
  existsSync(new URL(`../../public/audio/repository/${manifest.bgm}`, import.meta.url)),
  'the generated background music file must exist',
);
