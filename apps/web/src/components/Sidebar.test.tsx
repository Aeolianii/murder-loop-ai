import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';

const html = renderToStaticMarkup(<Sidebar clues={[]} />);

assert.match(
  html,
  /故事背景/,
  'the story background must be visible when the sidebar first renders',
);
assert.match(
  html,
  /收起/,
  'the memory toggle must indicate that the initially expanded section can be collapsed',
);
