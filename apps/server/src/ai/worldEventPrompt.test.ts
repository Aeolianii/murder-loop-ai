import assert from 'node:assert/strict';
import { formatConfirmedWorldEventsPromptBlock } from './worldEventPrompt';

{
  const block = formatConfirmedWorldEventsPromptBlock([
    {
      id: 'conflict.chen_intercepts_linyue',
      minute: 1381,
      type: 'conflict',
      actors: ['chen_huaimin', 'lin_yue'],
      location: 'corridor_5f',
      facts: ['chen_intercepts_linyue', 'linyue_has_external_evidence'],
      visibility: 'player',
      narrationHint: 'Narrate only the confirmed corridor encounter.',
    },
  ]);

  assert.match(block, /Confirmed World Events/);
  assert.match(block, /read-only/);
  assert.match(block, /conflict\.chen_intercepts_linyue/);
  assert.match(block, /actors: chen_huaimin, lin_yue/);
  assert.match(block, /location: corridor_5f/);
  assert.match(block, /facts: chen_intercepts_linyue; linyue_has_external_evidence/);
  assert.match(block, /hint: Narrate only the confirmed corridor encounter/);
  assert.match(block, /must not add facts/);
}

assert.equal(formatConfirmedWorldEventsPromptBlock([]), '');
assert.equal(formatConfirmedWorldEventsPromptBlock(undefined), '');
