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

const inferenceHtml = renderToStaticMarkup(
  <Sidebar
    clues={[]}
    knowledge={[{
      id: 'organization_controls_recovery',
      label: '包裹回收由组织统一调度',
      activatedAt: { run: 3, minute: 42 },
      sourceClueIds: ['voice_goods_not_returned_2347', 'chen_phone_upstream_order'],
      directSourceClueIds: [],
      sourceKnowledgeIds: [
        'recovery_deadline_2347',
        'fake_police_coordinated_with_chen',
        'chen_is_field_executor',
      ],
      truthLayerContribution: 6,
      excludes: [],
      category: 'conclusion',
      stage: 3,
      ruleVersion: 2,
    }]}
    truth={{
      truthLayer: 72,
      stage: 'L3',
      confirmedKnowledgeIds: ['organization_controls_recovery'],
      hypothesisIds: [],
      topLevelKnowledgeIds: ['organization_controls_recovery'],
      supportingClueIds: ['voice_goods_not_returned_2347', 'chen_phone_upstream_order'],
      unlockedDirections: ['组织网络'],
    }}
  />,
);

assert.match(inferenceHtml, /推理结论/);
assert.match(inferenceHtml, /真相 L3/);
assert.match(inferenceHtml, /包裹回收由组织统一调度/);
assert.match(inferenceHtml, /3 条前置结论/);
