import type {
  KnowledgeDefinition,
  KnowledgeRequirement,
} from '@murder-loop-ai/shared';

export type ClueRelationMap = ReadonlyMap<string, ReadonlySet<string>>;

function collectRequirementInputs(
  requirement: KnowledgeRequirement,
  clueIds: Set<string>,
  knowledgeIds: Set<string>,
) {
  switch (requirement.kind) {
    case 'clue':
      clueIds.add(requirement.id);
      return;
    case 'knowledge':
      knowledgeIds.add(requirement.id);
      return;
    case 'all':
    case 'any':
      requirement.requirements.forEach((item) =>
        collectRequirementInputs(item, clueIds, knowledgeIds),
      );
  }
}

export function buildClueRelationMap(
  definitions: ReadonlyArray<KnowledgeDefinition>,
): ClueRelationMap {
  const expandedClues = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();

  definitions.forEach((definition) => {
    const clueIds = new Set<string>();
    const knowledgeIds = new Set<string>();
    collectRequirementInputs(definition.requirement, clueIds, knowledgeIds);
    expandedClues.set(definition.id, clueIds);
    dependencies.set(definition.id, knowledgeIds);
  });

  // A fixed-point expansion handles nested conclusions and remains safe if
  // content authors accidentally introduce a knowledge dependency cycle.
  for (let pass = 0; pass < definitions.length; pass += 1) {
    let changed = false;
    definitions.forEach((definition) => {
      const target = expandedClues.get(definition.id)!;
      dependencies.get(definition.id)?.forEach((dependencyId) => {
        expandedClues.get(dependencyId)?.forEach((clueId) => {
          if (target.has(clueId)) return;
          target.add(clueId);
          changed = true;
        });
      });
    });
    if (!changed) break;
  }

  const relations = new Map<string, Set<string>>();
  expandedClues.forEach((clueIds) => {
    clueIds.forEach((clueId) => {
      if (!relations.has(clueId)) relations.set(clueId, new Set());
      clueIds.forEach((relatedId) => {
        if (relatedId !== clueId) relations.get(clueId)!.add(relatedId);
      });
    });
  });
  return relations;
}

export function findRelatedDiscoveredClueIds({
  selectedClueIds,
  discoveredClueIds,
  relations,
}: {
  selectedClueIds: ReadonlyArray<string>;
  discoveredClueIds: ReadonlyArray<string>;
  relations: ClueRelationMap;
}): ReadonlySet<string> {
  const selected = new Set(selectedClueIds);
  const discovered = new Set(discoveredClueIds);
  const related = new Set<string>();

  selected.forEach((selectedId) => {
    relations.get(selectedId)?.forEach((relatedId) => {
      if (discovered.has(relatedId) && !selected.has(relatedId)) {
        related.add(relatedId);
      }
    });
  });
  return related;
}
