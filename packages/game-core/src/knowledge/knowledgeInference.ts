import type {
  KnowledgeDefinition,
  KnowledgeRequirement,
  PlayerKnowledge,
  TruthDerivation,
  TruthStage,
} from '@murder-loop-ai/shared';
import { KNOWLEDGE_DEFINITIONS } from './knowledgeDefinitions';

export interface KnowledgeSupport {
  directClueIds: string[];
  directKnowledgeIds: string[];
  sourceClueIds: string[];
}

export interface InferredKnowledgeConclusion {
  id: string;
  label: string;
  category: KnowledgeDefinition['category'];
  stage: KnowledgeDefinition['stage'];
  truthLayerContribution: number;
  excludes: string[];
  unlocksDirection: string;
  ruleVersion: number;
  support: KnowledgeSupport;
}

export interface KnowledgeInferenceInput {
  clueIds: Iterable<string>;
  alreadyActivatedKnowledgeIds?: Iterable<string>;
  definitions?: KnowledgeDefinition[];
}

export interface KnowledgeInferenceResult {
  activeConclusions: InferredKnowledgeConclusion[];
  newlyActivated: InferredKnowledgeConclusion[];
  invalidatedKnowledgeIds: string[];
}

interface RequirementMatch {
  matched: boolean;
  directClueIds: string[];
  directKnowledgeIds: string[];
}

function unique(values: Iterable<string>) {
  return [...new Set(values)];
}

function matchRequirement(
  requirement: KnowledgeRequirement,
  clueIds: Set<string>,
  conclusions: ReadonlyMap<string, InferredKnowledgeConclusion>,
): RequirementMatch {
  switch (requirement.kind) {
    case 'clue':
      return {
        matched: clueIds.has(requirement.id),
        directClueIds: clueIds.has(requirement.id) ? [requirement.id] : [],
        directKnowledgeIds: [],
      };
    case 'knowledge':
      return {
        matched: conclusions.has(requirement.id),
        directClueIds: [],
        directKnowledgeIds: conclusions.has(requirement.id) ? [requirement.id] : [],
      };
    case 'all': {
      const matches = requirement.requirements.map((item) =>
        matchRequirement(item, clueIds, conclusions),
      );
      if (matches.some((item) => !item.matched)) {
        return { matched: false, directClueIds: [], directKnowledgeIds: [] };
      }
      return {
        matched: true,
        directClueIds: unique(matches.flatMap((item) => item.directClueIds)),
        directKnowledgeIds: unique(matches.flatMap((item) => item.directKnowledgeIds)),
      };
    }
    case 'any': {
      const minimum = requirement.minimum ?? 1;
      const matches = requirement.requirements
        .map((item) => matchRequirement(item, clueIds, conclusions))
        .filter((item) => item.matched);
      if (matches.length < minimum) {
        return { matched: false, directClueIds: [], directKnowledgeIds: [] };
      }
      const selected = matches.slice(0, minimum);
      return {
        matched: true,
        directClueIds: unique(selected.flatMap((item) => item.directClueIds)),
        directKnowledgeIds: unique(selected.flatMap((item) => item.directKnowledgeIds)),
      };
    }
  }
}

function collectKnowledgeReferences(requirement: KnowledgeRequirement): string[] {
  switch (requirement.kind) {
    case 'clue':
      return [];
    case 'knowledge':
      return [requirement.id];
    case 'all':
    case 'any':
      return unique(requirement.requirements.flatMap(collectKnowledgeReferences));
  }
}

function collectRequirementErrors(
  ownerId: string,
  requirement: KnowledgeRequirement,
  knownIds: Set<string>,
): string[] {
  const errors: string[] = [];
  if (
    requirement.kind === 'any'
    && ((requirement.minimum ?? 1) < 1
      || (requirement.minimum ?? 1) > requirement.requirements.length)
  ) {
    errors.push(`knowledge "${ownerId}" has an invalid any minimum`);
  }
  if (requirement.kind === 'knowledge' && !knownIds.has(requirement.id)) {
    errors.push(`knowledge "${ownerId}" references unknown knowledge "${requirement.id}"`);
  }
  if (requirement.kind === 'all' || requirement.kind === 'any') {
    for (const nested of requirement.requirements) {
      errors.push(...collectRequirementErrors(ownerId, nested, knownIds));
    }
  }
  return errors;
}

export function validateKnowledgeGraph(
  definitions: KnowledgeDefinition[] = KNOWLEDGE_DEFINITIONS,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      errors.push(`duplicate knowledge id "${definition.id}"`);
    }
    ids.add(definition.id);
  }

  for (const definition of definitions) {
    errors.push(...collectRequirementErrors(definition.id, definition.requirement, ids));
    if (definition.invalidatedBy) {
      errors.push(...collectRequirementErrors(definition.id, definition.invalidatedBy, ids));
    }
  }

  const graph = new Map(
    definitions.map((definition) => [
      definition.id,
      collectKnowledgeReferences(definition.requirement),
    ]),
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      errors.push(`knowledge dependency cycle: ${cycle.join(' -> ')}`);
      return;
    }

    visiting.add(id);
    path.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (ids.has(dependency)) visit(dependency);
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of ids) visit(id);
  return unique(errors);
}

export function inferKnowledgeConclusions(
  input: KnowledgeInferenceInput,
): KnowledgeInferenceResult {
  const definitions = input.definitions ?? KNOWLEDGE_DEFINITIONS;
  const graphErrors = validateKnowledgeGraph(definitions);
  if (graphErrors.length > 0) {
    throw new Error(`Invalid knowledge graph: ${graphErrors.join('; ')}`);
  }

  const clueIds = new Set(input.clueIds);
  const alreadyActivated = new Set(input.alreadyActivatedKnowledgeIds ?? []);
  const resolved = new Map<string, InferredKnowledgeConclusion>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (resolved.has(definition.id)) continue;
      const match = matchRequirement(definition.requirement, clueIds, resolved);
      if (!match.matched) continue;

      const inheritedClues = match.directKnowledgeIds.flatMap(
        (id) => resolved.get(id)?.support.sourceClueIds ?? [],
      );
      resolved.set(definition.id, {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        stage: definition.stage,
        truthLayerContribution: definition.truthLayerContribution,
        excludes: [...definition.excludes],
        unlocksDirection: definition.unlocksDirection,
        ruleVersion: definition.ruleVersion ?? 1,
        support: {
          directClueIds: match.directClueIds,
          directKnowledgeIds: match.directKnowledgeIds,
          sourceClueIds: unique([...match.directClueIds, ...inheritedClues]),
        },
      });
      changed = true;
    }
  }

  const invalidated = new Set<string>();
  for (const definition of definitions) {
    if (!resolved.has(definition.id)) continue;
    const invalidatedByRule = definition.invalidatedBy
      ? matchRequirement(definition.invalidatedBy, clueIds, resolved).matched
      : false;
    const invalidatedByExclusion = definition.excludes.some((id) => resolved.has(id));
    if (invalidatedByRule || invalidatedByExclusion) invalidated.add(definition.id);
  }

  const activeConclusions = definitions.flatMap((definition) => {
    const result = resolved.get(definition.id);
    return result && !invalidated.has(definition.id) ? [result] : [];
  });
  const newlyActivated = activeConclusions.filter(
    (item) => !alreadyActivated.has(item.id),
  );
  const invalidatedKnowledgeIds = [...alreadyActivated].filter((id) =>
    invalidated.has(id),
  );

  return {
    activeConclusions,
    newlyActivated,
    invalidatedKnowledgeIds,
  };
}

type DerivableKnowledge = Pick<
  PlayerKnowledge,
  'id' | 'sourceClueIds' | 'truthLayerContribution'
> & Partial<Pick<PlayerKnowledge, 'category' | 'stage' | 'sourceKnowledgeIds'>>;

const TRUTH_STAGE_LABELS: Record<number, TruthStage> = {
  0: 'L0',
  1: 'L1',
  2: 'L2',
  3: 'L3',
  4: 'L4',
};

export function deriveTruth(
  activatedKnowledge: ReadonlyArray<DerivableKnowledge | InferredKnowledgeConclusion>,
  definitions: KnowledgeDefinition[] = KNOWLEDGE_DEFINITIONS,
): TruthDerivation {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const uniqueItems = new Map(
    activatedKnowledge.map((item) => [item.id, item]),
  );
  const confirmedKnowledgeIds = definitions
    .filter(
      (definition) =>
        definition.category === 'conclusion' && uniqueItems.has(definition.id),
    )
    .map((definition) => definition.id);
  const confirmedSet = new Set(confirmedKnowledgeIds);
  const hypothesisIds = definitions
    .filter(
      (definition) =>
        definition.category === 'hypothesis' && uniqueItems.has(definition.id),
    )
    .map((definition) => definition.id);
  const truthLayer = Math.min(
    100,
    confirmedKnowledgeIds.reduce(
      (sum, id) => sum + (definitionsById.get(id)?.truthLayerContribution ?? 0),
      0,
    ),
  );
  const stageNumber = confirmedKnowledgeIds.reduce(
    (highest, id) => Math.max(highest, definitionsById.get(id)?.stage ?? 0),
    0,
  );
  const referencedKnowledgeIds = new Set(
    confirmedKnowledgeIds.flatMap((id) =>
      collectKnowledgeReferences(definitionsById.get(id)!.requirement),
    ),
  );
  const topLevelKnowledgeIds = confirmedKnowledgeIds.filter(
    (id) => !referencedKnowledgeIds.has(id),
  );
  const supportingClueIds = unique(
    confirmedKnowledgeIds.flatMap((id) => {
      const item = uniqueItems.get(id);
      return 'support' in (item ?? {})
        ? (item as InferredKnowledgeConclusion).support.sourceClueIds
        : (item as DerivableKnowledge | undefined)?.sourceClueIds ?? [];
    }),
  );
  const unlockedDirections = unique(
    confirmedKnowledgeIds
      .map((id) => definitionsById.get(id)?.unlocksDirection ?? '')
      .filter(Boolean),
  );

  return {
    truthLayer,
    stage: TRUTH_STAGE_LABELS[stageNumber] ?? 'L0',
    confirmedKnowledgeIds: [...confirmedSet],
    hypothesisIds,
    topLevelKnowledgeIds,
    supportingClueIds,
    unlockedDirections,
  };
}

/** Compatibility helper for callers that only need newly activatable definitions. */
export function getActivatableKnowledge(
  ownedClueIds: string[],
  alreadyActivated: string[],
): KnowledgeDefinition[] {
  const newlyActivatedIds = new Set(
    inferKnowledgeConclusions({
      clueIds: ownedClueIds,
      alreadyActivatedKnowledgeIds: alreadyActivated,
    }).newlyActivated.map((item) => item.id),
  );
  return KNOWLEDGE_DEFINITIONS.filter((definition) =>
    newlyActivatedIds.has(definition.id),
  );
}
