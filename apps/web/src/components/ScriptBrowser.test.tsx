import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptBrowser } from './ScriptBrowser';

const warningHtml = renderToStaticMarkup(
  <ScriptBrowser onClose={() => undefined} />,
);
assert.match(warningHtml, /完整剧透/);

const contentHtml = renderToStaticMarkup(
  <ScriptBrowser onClose={() => undefined} skipWarning />,
);
assert.match(contentHtml, /第一次死亡/);
assert.match(contentHtml, /真相被解开/);
assert.match(contentHtml, /玩家视角/);
assert.match(contentHtml, /幕后真相/);
