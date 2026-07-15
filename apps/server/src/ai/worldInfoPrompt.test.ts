import assert from 'node:assert/strict';
import { formatWorldInfoPromptBlock } from './worldInfoPrompt';

{
  const block = formatWorldInfoPromptBlock([
    {
      id: 'rule.killer_visibility',
      title: 'Killer visibility boundary',
      content: 'Chen cannot know private player actions by default.',
      priority: 10,
      source: 'manual',
    },
  ], 'killer');

  assert.match(block, /World Info Lite/);
  assert.match(block, /not rule authority/);
  assert.match(block, /Chen Huaimin visible knowledge/);
  assert.match(block, /JSON-only output schema/);
  assert.match(block, /rule\.killer_visibility/);
  assert.match(block, /Chen cannot know private player actions/);
}

{
  const block = formatWorldInfoPromptBlock([
    {
      id: 'rule.narrator_no_rule_change',
      title: 'Narrator cannot change rules',
      content: 'Narrator may express rule results but cannot add deaths or clues.',
    },
  ], 'narrator');

  assert.match(block, /never create rule outcomes/);
  assert.match(block, /rule\.narrator_no_rule_change/);
}

assert.equal(formatWorldInfoPromptBlock([], 'narrator'), '');
