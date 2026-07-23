import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnTimingPanel } from './TurnTimingPanel';

const html = renderToStaticMarkup(
  <TurnTimingPanel
    timing={{
      wallClockMs: 12_340,
      totalMs: 20_120,
      slowest: {
        stageId: 'player-specialist',
        durationMs: 8_230,
      },
      entries: [
        { stageId: 'semantic-compiler', durationMs: 1_200 },
        { stageId: 'player-specialist', durationMs: 8_230 },
        { stageId: 'confirmed-narration', durationMs: 3_456 },
      ],
    }}
  />,
);

assert.match(html, /本回合耗时/, 'the panel must have a visible Chinese heading');
assert.match(html, /实际等待/, 'the panel must distinguish wall-clock latency');
assert.match(html, /12\.34 秒/, 'wall-clock latency must be formatted in seconds');
assert.match(html, /环节合计/, 'the panel must show the sum of individual stages');
assert.match(html, /20\.12 秒/, 'stage duration total must be formatted in seconds');
assert.match(html, /最慢环节/, 'the slowest stage must be highlighted');
assert.match(html, /玩家行动裁决/, 'internal stage ids must be localized for players');
assert.match(html, /语义解析/, 'every known stage must render with a Chinese name');
assert.match(html, /行动与环境叙事/, 'narration timing must render with a Chinese name');
assert.doesNotMatch(
  html,
  /player-specialist|semantic-compiler|confirmed-narration/,
  'internal English stage ids must never be visible in the frontend',
);

const emptyHtml = renderToStaticMarkup(<TurnTimingPanel />);
assert.equal(emptyHtml, '', 'the timing panel must stay hidden before the first completed turn');
