import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartMenu } from './StartMenu';

const html = renderToStaticMarkup(
  <StartMenu onStart={() => undefined} onOpenEndings={() => undefined} />,
);

assert.match(html, /简单模式/);
assert.match(html, /困难模式/);
assert.match(html, /结局一览/);
assert.match(html, /自然语言输入/);
assert.match(html, /无推荐行动/);
assert.match(html, /耗时可能较长/);
