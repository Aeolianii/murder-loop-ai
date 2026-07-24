import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EndingArchive } from './EndingArchive';
import { createEmptyPlayerProgress, unlockEnding } from '../playerProgress';

const progress = unlockEnding(
  createEmptyPlayerProgress(),
  'A',
  78,
  '2026-07-23T08:00:00.000Z',
);
const html = renderToStaticMarkup(
  <EndingArchive progress={progress} onClose={() => undefined} />,
);

assert.equal((html.match(/data-ending-tier=/g) ?? []).length, 5);
assert.match(html, /迟到的正义/);
assert.match(html, /最佳评分 78/);
assert.match(html, /剧本浏览/);
assert.equal((html.match(/>封存档案</g) ?? []).length, 4);
assert.doesNotMatch(html, /未解锁结局/);
assert.doesNotMatch(html, /lucide-archive/);

for (const endingTitle of ['雨停之后', '迟到的正义', '断尾', '匿名者', '无人知晓的 503']) {
  assert.match(html, new RegExp(`data-ending-visual="${endingTitle}"`));
  assert.match(html, new RegExp(`>${endingTitle}<`));
}
assert.doesNotMatch(html, />完整案卷<|>调查报告<|>断裂证据链<|>匿名举报信<|>503 房门</);

const allUnlockedProgress = (['S', 'A', 'B', 'C', 'D'] as const).reduce(
  (currentProgress, tier, index) =>
    unlockEnding(
      currentProgress,
      tier,
      100 - index * 10,
      `2026-07-${String(19 + index).padStart(2, '0')}T08:00:00.000Z`,
    ),
  createEmptyPlayerProgress(),
);
const allUnlockedHtml = renderToStaticMarkup(
  <EndingArchive progress={allUnlockedProgress} onClose={() => undefined} />,
);

for (const endingTitle of ['雨停之后', '迟到的正义', '断尾', '匿名者', '无人知晓的 503']) {
  assert.match(allUnlockedHtml, new RegExp(`data-ending-visual="${endingTitle}"`));
  assert.match(allUnlockedHtml, new RegExp(`>${endingTitle}<`));
}
assert.doesNotMatch(allUnlockedHtml, /封存档案/);
