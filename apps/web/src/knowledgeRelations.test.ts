import assert from 'node:assert/strict';
import type {
  KnowledgeDefinition,
  KnowledgeRequirement,
} from '@murder-loop-ai/shared';
import {
  buildClueRelationMap,
  findRelatedDiscoveredClueIds,
} from './knowledgeRelations';

const clue = (id: string): KnowledgeRequirement => ({ kind: 'clue', id });
const knowledge = (id: string): KnowledgeRequirement => ({ kind: 'knowledge', id });
const all = (...requirements: KnowledgeRequirement[]): KnowledgeRequirement => ({
  kind: 'all',
  requirements,
});
const any = (...requirements: KnowledgeRequirement[]): KnowledgeRequirement => ({
  kind: 'any',
  minimum: 1,
  requirements,
});
const definition = (
  id: string,
  requirement: KnowledgeRequirement,
): KnowledgeDefinition => ({
  id,
  label: id,
  category: 'conclusion',
  stage: 1,
  requirement,
  excludes: [],
  truthLayerContribution: 1,
  unlocksDirection: '',
});

const definitions = [
  definition('base', all(clue('a'), any(clue('b'), clue('c')))),
  definition('recursive', all(knowledge('base'), clue('d'))),
  definition('cycle-a', all(knowledge('cycle-b'), clue('e'))),
  definition('cycle-b', all(knowledge('cycle-a'), clue('f'))),
];
const relations = buildClueRelationMap(definitions);

assert.deepEqual(
  [...(relations.get('a') ?? [])].sort(),
  ['b', 'c', 'd'],
  'all and any branches should guide toward every clue in the same inference family',
);
assert.deepEqual(
  [...(relations.get('d') ?? [])].sort(),
  ['a', 'b', 'c'],
  'knowledge prerequisites should expand to their leaf clues',
);
assert.deepEqual(
  [...(relations.get('e') ?? [])],
  ['f'],
  'cyclic knowledge references must settle without recursion failure',
);

assert.deepEqual(
  [...findRelatedDiscoveredClueIds({
    selectedClueIds: ['a'],
    discoveredClueIds: ['a', 'b', 'd'],
    relations,
  })].sort(),
  ['b', 'd'],
  'only discovered related clues should be exposed',
);

assert.deepEqual(
  [...findRelatedDiscoveredClueIds({
    selectedClueIds: ['a', 'e'],
    discoveredClueIds: ['a', 'b', 'e', 'f'],
    relations,
  })].sort(),
  ['b', 'f'],
  'multiple selections should union their related discovered clues',
);
