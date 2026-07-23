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
assert.doesNotMatch(html, /雨停之后/);
assert.match(html, /未解锁结局/);
assert.match(html, /剧本浏览/);
