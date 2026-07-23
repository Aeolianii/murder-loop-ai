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

export interface TurnBriefTargetContractIssue {
  path: string;
  message: string;
}

const BARRICADE_TARGET_IDS = ['chair', 'luggage', 'suitcase'] as const;
const NON_PHYSICAL_TARGET_IDS = new Set(['room', 'player', 'self']);
const ORDINARY_ITEM_TARGET_IDS = new Set([
  'phone_charger',
  'chair',
  'tape',
  'flashlight',
  'hanger',
  'mirror',
  'newspaper',
  'belt',
  'screwdriver',
  'lighter',
  'bleach',
  'pen_paper',
]);
const USE_ITEM_TARGET_IDS = new Set(['phone_charger', 'tape']);
const INSPECTION_OPERATIONS = new Set(['inspect', 'observe']);
const EVIDENCE_OPERATIONS = new Set([
  'photograph',
  'take_photo',
  'preserve_evidence',
]);
const COMMUNICATION_OPERATIONS = new Set(['communicate', 'send_message']);
const SECURE_ENTRY_OPERATIONS = new Set(['secure_entry', 'secure', 'lock']);

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
  validateUtteranceMode(brief, issues);
  validateActionGraph(brief, issues);
  validateCandidateHandles(brief, issues);
  validateReferences(brief, issues);

  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, brief, issues: [] };
}

function validateUtteranceMode(brief: TurnBrief, issues: string[]): void {
  if (brief.utteranceMode !== 'non_action') return;
  const populatedFields = [
    ['resolvedReferences', brief.resolvedReferences],
    ['orderedActions', brief.orderedActions],
    ['globalConstraints', brief.globalConstraints],
    ['scopedConstraints', brief.scopedConstraints],
    ['communications', brief.communications],
    ['candidateHandles', brief.candidateHandles],
    ['ambiguities', brief.ambiguities],
  ] as const;
  for (const [field, values] of populatedFields) {
    if (values.length > 0) issues.push(`non_action TurnBrief must keep ${field} empty.`);
  }
}

export function validateTurnBriefTargetContract(
  brief: TurnBrief,
  context: SemanticCompilerRequest['playerContext'],
): TurnBriefTargetContractIssue[] {
  const issues: TurnBriefTargetContractIssue[] = [];
  const communicationsByActionId = new Map(
    brief.communications.map((communication) => [communication.actionId, communication]),
  );
  const accessibleTargets = new Set([
    ...context.accessibleEntityIds,
    ...context.activeCommunicationActorIds,
    ...NON_PHYSICAL_TARGET_IDS,
  ]);
  const accessibleRoomObjectIds = new Set(
    Object.values(context.entityAliasIndex)
      .flat()
      .filter((targetId) => context.accessibleEntityIds.includes(targetId)),
  );

  brief.orderedActions.forEach((action, index) => {
    const path = `brief.orderedActions.${index}`;
    for (const targetId of action.targetIds) {
      if (!accessibleTargets.has(targetId)) {
        issues.push({
          path: `${path}.targetIds`,
          message: `Target "${targetId}" is not accessible in playerContext.`,
        });
      }
    }

    const mentionedBarriers = mentionedBarrierTargets(action, context);
    if (INSPECTION_OPERATIONS.has(action.operation)) {
      if (
        action.targetIds.length === 0
        || action.targetIds.some((targetId) => (
          targetId !== 'room' && !accessibleRoomObjectIds.has(targetId)
        ))
      ) {
        issues.push({
          path: `${path}.targetIds`,
          message: `${action.operation} must target at least one visible room object or "room".`,
        });
      }
    }

    if (
      EVIDENCE_OPERATIONS.has(action.operation)
      && (
        action.targetIds.length === 0
        || action.targetIds.some((targetId) => !accessibleRoomObjectIds.has(targetId))
      )
    ) {
      issues.push({
        path: `${path}.targetIds`,
        message: `${action.operation} must target at least one visible room object.`,
      });
    }

    if (COMMUNICATION_OPERATIONS.has(action.operation)) {
      const communication = communicationsByActionId.get(action.actionId);
      if (!communication) {
        issues.push({
          path: 'brief.communications',
          message: `${action.operation} must have one matching communication intent.`,
        });
      } else if (communication.situatedAudience) {
        const anchorIds = communication.situatedAudience.anchorEntityIds;
        if (
          action.targetIds.length !== anchorIds.length
          || anchorIds.some((anchorId) => !action.targetIds.includes(anchorId))
        ) {
          issues.push({
            path: `${path}.targetIds`,
            message: `${action.operation} targetIds must match its situated audience anchors.`,
          });
        }
      } else if (
        action.targetIds.length !== communication.recipientIds.length
        || communication.recipientIds.some((recipientId) => (
          !context.activeCommunicationActorIds.includes(recipientId)
          || !action.targetIds.includes(recipientId)
        ))
      ) {
        issues.push({
          path: `${path}.targetIds`,
          message: `${action.operation} targetIds must match active communication recipients.`,
        });
      }
    }

    if (SECURE_ENTRY_OPERATIONS.has(action.operation)) {
      if (!action.targetIds.includes('front_door')) {
        issues.push({
          path: `${path}.targetIds`,
          message: 'secure_entry must include "front_door" in targetIds.',
        });
      }
      if (action.targetIds.some((targetId) => (
        targetId !== 'front_door'
        && !BARRICADE_TARGET_IDS.includes(targetId as typeof BARRICADE_TARGET_IDS[number])
      ))) {
        issues.push({
          path: `${path}.targetIds`,
          message: 'secure_entry targetIds may contain only "front_door" and an accessible barricade entity.',
        });
      }
      for (const barrierId of mentionedBarriers) {
        if (!action.targetIds.includes(barrierId)) {
          issues.push({
            path: `${path}.targetIds`,
            message: `Action ${action.actionId} changes barrier entity "${barrierId}"; add it to targetIds.`,
          });
        }
      }
    }

    if (
      action.operation === 'use_item'
      && mentionedBarriers.length > 0
    ) {
      issues.push({
        path: `${path}.operation`,
        message: 'Barricading an entrance with furniture must use "secure_entry" and include "front_door" plus the furniture entity in targetIds.',
      });
    }

    if (
      action.operation === 'pick_up'
      && (
        action.targetIds.length !== 1
        || !ORDINARY_ITEM_TARGET_IDS.has(action.targetIds[0])
      )
    ) {
      issues.push({
        path: `${path}.targetIds`,
        message: 'pick_up must target exactly one supported ordinary item.',
      });
    }

    if (
      action.operation === 'use_item'
      && (
        action.targetIds.length !== 1
        || !USE_ITEM_TARGET_IDS.has(action.targetIds[0])
      )
    ) {
      issues.push({
        path: `${path}.targetIds`,
        message: 'use_item must target exactly one supported item: "phone_charger" or "tape".',
      });
    }

    if (
      action.operation === 'wait'
      && action.targetIds.some((targetId) => !NON_PHYSICAL_TARGET_IDS.has(targetId))
    ) {
      issues.push({
        path: `${path}.targetIds`,
        message: 'wait targetIds may contain only "room", "player", or "self".',
      });
    }
  });

  return issues;
}

function mentionedBarrierTargets(
  action: TurnBrief['orderedActions'][number],
  context: SemanticCompilerRequest['playerContext'],
): string[] {
  const text = [
    action.originalSpan.text,
    action.method,
    action.scope,
    action.desiredOutcome,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
  if (!mentionsBarricadeIntent(text)) return [];

  return BARRICADE_TARGET_IDS.filter((targetId) => {
    if (!context.accessibleEntityIds.includes(targetId)) return false;
    const aliases = Object.entries(context.entityAliasIndex)
      .filter(([, entityIds]) => entityIds.includes(targetId))
      .map(([alias]) => alias);
    return [targetId, ...aliases].some((alias) => (
      alias.length > 0 && text.includes(alias.toLocaleLowerCase())
    ));
  });
}

function mentionsBarricadeIntent(text: string): boolean {
  return /barricad|block_with_|block.{0,20}(door|entry)|(door|entry).{0,20}block|(?:堵|顶|抵|挡).{0,8}门|门.{0,8}(?:堵|顶|抵|挡)/i
    .test(text);
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
