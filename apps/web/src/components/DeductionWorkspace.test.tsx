import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeductionWorkspace } from './DeductionWorkspace';

const inferenceHtml = renderToStaticMarkup(
  <DeductionWorkspace
    mode="inference"
    clues={[{
      id: 'package_label_fragment',
      name: '残缺面单',
      description: '面单只剩下青荷公寓 5-0。',
      status: 'known',
    }]}
    knowledge={[]}
    onClose={() => undefined}
    onSubmitTruth={async () => true}
  />,
);

assert.match(inferenceHtml, /结论推理/);
assert.match(inferenceHtml, /原始线索/);
assert.match(inferenceHtml, /残缺面单/);
assert.match(inferenceHtml, /组合推理/);

const truthKnowledge = Array.from({ length: 10 }, (_, index) => ({
  id: `knowledge-${index}`,
  label: `确认结论${index + 1}`,
  activatedAt: { run: 1, minute: index },
  sourceClueIds: [],
  truthLayerContribution: 3,
  excludes: [],
  category: 'conclusion' as const,
  stage: 1 as const,
}));
const truthHtml = renderToStaticMarkup(
  <DeductionWorkspace
    mode="truth"
    clues={[]}
    knowledge={truthKnowledge}
    truth={{
      truthLayer: 9,
      stage: 'L1',
      confirmedKnowledgeIds: truthKnowledge.map((item) => item.id),
      hypothesisIds: [],
      topLevelKnowledgeIds: truthKnowledge.map((item) => item.id),
      supportingClueIds: [],
      unlockedDirections: [],
    }}
    onClose={() => undefined}
    onSubmitTruth={async () => true}
  />,
);

assert.match(truthHtml, /真相推导/);
assert.match(truthHtml, /全部 10 条结论/);
assert.match(truthHtml, /确认结论10/);
assert.doesNotMatch(truthHtml, /选择三条结论/);
assert.match(truthHtml, /推导全部结论/);
