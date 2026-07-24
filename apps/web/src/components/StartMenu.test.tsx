import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartMenu } from './StartMenu';

const html = renderToStaticMarkup(
  <StartMenu
    audioEnabled={false}
    onToggleAudio={() => undefined}
    onStart={() => undefined}
    onOpenEndings={() => undefined}
  />,
);

assert.match(html, /简单模式/);
assert.match(html, /Murder Loop/);
assert.doesNotMatch(html, /lucide-eye/);
assert.match(html, /硬核模式/);
assert.doesNotMatch(html, /困难模式/);
assert.match(html, /结局一览/);
assert.match(html, /自然语言输入/);
assert.match(html, /无推荐行动/);
assert.match(html, /耗时可能较长/);
assert.match(html, /开启雨声/);
assert.match(html, /aria-pressed="false"/);

const audioEnabledHtml = renderToStaticMarkup(
  <StartMenu
    audioEnabled
    onToggleAudio={() => undefined}
    onStart={() => undefined}
    onOpenEndings={() => undefined}
  />,
);
assert.match(audioEnabledHtml, /雨声已开启/);
assert.match(audioEnabledHtml, /aria-pressed="true"/);
assert.doesNotMatch(audioEnabledHtml, /aria-pressed="true" disabled/);
