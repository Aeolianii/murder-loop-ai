import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoryPanel } from './StoryPanel';

const html = renderToStaticMarkup(
  <StoryPanel
    log={[{
      id: 'action-result-1',
      type: 'action_result',
      content: 'Action completed.',
      recommendedActions: [{
        id: 'recommendation-1',
        label: 'Photograph the package label.',
        rationale: 'Preserve visible evidence.',
      }],
    }]}
    onRecommendedAction={() => undefined}
    recommendationsDisabled={false}
  />,
);

assert.match(
  html,
  /<button[^>]*>[\s\S]*Photograph the package label\.[\s\S]*<\/button>/,
  'accepted recommendations must render as actionable buttons',
);
assert.match(
  html,
  /aria-label="执行建议：Photograph the package label\."/,
  'recommendation buttons must expose an accessible action label',
);

const staleHtml = renderToStaticMarkup(
  <StoryPanel
    log={[
      {
        id: 'old-action-result',
        type: 'action_result',
        content: 'Old action completed.',
        recommendedActions: [{
          id: 'old-recommendation',
          label: 'Old recommendation.',
          rationale: 'This was grounded in an earlier state.',
        }],
      },
      {
        id: 'latest-action-result',
        type: 'action_result',
        content: 'Latest action completed.',
      },
    ]}
    onRecommendedAction={() => undefined}
    recommendationsDisabled={false}
  />,
);

assert.match(
  staleHtml,
  /<button[^>]*aria-label="执行建议：Old recommendation\."[^>]*disabled=""/,
  'recommendations from older world-state snapshots must be disabled',
);
