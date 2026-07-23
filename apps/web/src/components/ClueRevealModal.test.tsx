import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClueRevealModal } from './ClueRevealModal';

const html = renderToStaticMarkup(
  <ClueRevealModal
    open
    clue={{
      id: 'wrong_package',
      name: '标记模糊的包裹',
      description: '写着模糊的 5-03，里面是一本被掏空的旧书。',
      status: 'known',
    }}
    onClose={() => undefined}
  />,
);

assert.match(html, /data-mobile-layout="stacked"/);
assert.match(
  html,
  /data-clue-section="header"[\s\S]*data-clue-section="media"[\s\S]*data-clue-section="description"/,
  'mobile clue details should flow from header to media to description',
);
