import {
  TurnBriefSchema,
  type SemanticCompilerRequest,
  type SemanticCompilerResult,
  type TurnBrief,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';

export interface SemanticCompiler {
  compile(
    request: SemanticCompilerRequest,
    context?: { signal: AbortSignal },
  ): Promise<SemanticCompilerResult>;
}

export interface TurnBriefValidationResult {
  valid: boolean;
  brief?: TurnBrief;
  issues: string[];
}

export function validateTurnBrief(
  input: unknown,
  expectedEnvelope: Pick<TurnEnvelope, 'loopId' | 'turnId' | 'inputStateVersion' | 'deadlineAt'>,
): TurnBriefValidationResult {
  const parsed = TurnBriefSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'turnBrief'}: ${issue.message}`),
    };
  }

  const brief = parsed.data;
  const issues: string[] = [];
  validateEnvelope(brief, expectedEnvelope, issues);
  validateActionGraph(brief, issues);
  validateCandidateHandles(brief, issues);
  validateReferences(brief, issues);

  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, brief, issues: [] };
}

function validateEnvelope(
  brief: TurnBrief,
  expected: Pick<TurnEnvelope, 'loopId' | 'turnId' | 'inputStateVersion' | 'deadlineAt'>,
  issues: string[],
) {
  for (const field of ['loopId', 'turnId', 'inputStateVersion', 'deadlineAt'] as const) {
    if (brief[field] !== expected[field]) {
      issues.push(`${field} does not match the active turn envelope.`);
    }
  }
}

function validateActionGraph(brief: TurnBrief, issues: string[]) {
  const actionPositions = new Map<string, number>();
  brief.orderedActions.forEach((action, index) => {
    if (actionPositions.has(action.actionId)) {
      issues.push(`Duplicate actionId: ${action.actionId}.`);
      return;
    }
    actionPositions.set(action.actionId, index);
  });

  brief.orderedActions.forEach((action, index) => {
    for (const dependencyId of action.dependsOnActionIds) {
      const dependencyIndex = actionPositions.get(dependencyId);
      if (dependencyIndex === undefined || dependencyIndex >= index) {
        issues.push(`Action ${action.actionId} must depend only on an earlier action: ${dependencyId}.`);
      }
    }
  });
}

function validateCandidateHandles(brief: TurnBrief, issues: string[]) {
  const actionIds = new Set(brief.orderedActions.map((action) => action.actionId));
  const handles = new Map<string, string>();

  for (const handle of brief.candidateHandles) {
    if (handles.has(handle.id)) {
      issues.push(`Duplicate candidate handle: ${handle.id}.`);
    }
    handles.set(handle.id, handle.producedByActionId);
    if (!actionIds.has(handle.producedByActionId)) {
      issues.push(`Candidate handle ${handle.id} references an unknown producing action.`);
    }
    for (const dependencyId of handle.dependsOnActionIds) {
      if (!actionIds.has(dependencyId)) {
        issues.push(`Candidate handle ${handle.id} references an unknown dependency action: ${dependencyId}.`);
      }
    }
  }

  for (const action of brief.orderedActions) {
    for (const handleId of [...action.inputHandleIds, ...action.outputHandleIds]) {
      if (!handles.has(handleId)) {
        issues.push(`Action ${action.actionId} references an unknown candidate handle: ${handleId}.`);
      }
    }
  }

  for (const communication of brief.communications) {
    for (const handleId of communication.attachmentHandleIds) {
      if (!handles.has(handleId)) {
        issues.push(`Communication ${communication.id} references an unknown candidate handle: ${handleId}.`);
      }
    }
  }
}

function validateReferences(brief: TurnBrief, issues: string[]) {
  const actionIds = new Set(brief.orderedActions.map((action) => action.actionId));

  for (const constraint of [...brief.globalConstraints, ...brief.scopedConstraints]) {
    for (const actionId of constraint.actionIds) {
      if (!actionIds.has(actionId)) {
        issues.push(`Constraint ${constraint.id} references an unknown action: ${actionId}.`);
      }
    }
  }

  for (const communication of brief.communications) {
    if (!actionIds.has(communication.actionId)) {
      issues.push(`Communication ${communication.id} references an unknown action: ${communication.actionId}.`);
    }
  }
}
