import assert from 'node:assert/strict';
import type { TurnBrief } from '@murder-loop-ai/ai-contracts';
import {
  validateTurnBrief,
  validateTurnBriefTargetContract,
  type SemanticCompiler,
} from './turnBriefValidator';

const brief: TurnBrief = {
  loopId: 'loop-1',
  turnId: 'turn-2',
  inputStateVersion: 1,
  deadlineAt: '2026-07-20T12:00:01.000Z',
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: 'world-model-v1',
  utteranceMode: 'command',
  resolvedReferences: [],
  orderedActions: [
    {
      actionId: 'action-1',
      actorId: 'player',
      operation: 'photograph',
      targetIds: ['package'],
      scope: 'exterior.label',
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: ['candidate.photo.action-1'],
      originalSpan: { start: 0, end: 5, text: '拍摄包裹' },
    },
    {
      actionId: 'action-2',
      actorId: 'player',
      operation: 'send_message',
      targetIds: ['lin_yue'],
      dependsOnActionIds: ['action-1'],
      inputHandleIds: ['candidate.photo.action-1'],
      outputHandleIds: [],
      originalSpan: { start: 6, end: 11, text: '发给林越' },
    },
  ],
  globalConstraints: [],
  scopedConstraints: [],
  communications: [{
    id: 'communication-1',
    actionId: 'action-2',
    senderId: 'player',
    recipientIds: ['lin_yue'],
    channel: 'phone',
    contentSummary: 'Package photo.',
    attachmentHandleIds: ['candidate.photo.action-1'],
    intendedAudience: ['lin_yue'],
  }],
  candidateHandles: [{
    id: 'candidate.photo.action-1',
    kind: 'photo',
    producedByActionId: 'action-1',
    dependsOnActionIds: ['action-1'],
  }],
  ambiguities: [],
};

{
  const result = validateTurnBrief(brief, {
    loopId: 'loop-1',
    turnId: 'turn-2',
    inputStateVersion: 1,
    deadlineAt: '2026-07-20T12:00:01.000Z',
  });
  assert.equal(result.valid, true);
}

{
  const invalid = structuredClone(brief);
  invalid.orderedActions[0].dependsOnActionIds = ['action-2'];
  const result = validateTurnBrief(invalid, invalid);
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.includes('earlier action')));
}

{
  const invalid = structuredClone(brief);
  invalid.orderedActions[1].inputHandleIds = ['candidate.missing'];
  const result = validateTurnBrief(invalid, invalid);
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.includes('unknown candidate handle')));
}

{
  const result = validateTurnBrief(brief, { ...brief, loopId: 'loop-new' });
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.includes('loopId')));
}

{
  const nonAction: TurnBrief = {
    ...brief,
    utteranceMode: 'non_action',
    resolvedReferences: [],
    orderedActions: [],
    communications: [],
    candidateHandles: [],
  };
  assert.equal(validateTurnBrief(nonAction, nonAction).valid, true);

  const invalid = { ...nonAction, orderedActions: brief.orderedActions };
  const result = validateTurnBrief(invalid, invalid);
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.includes('non_action')));
}

const targetContext = {
  facts: [],
  accessibleEntityIds: ['player', 'front_door', 'chair'],
  capabilities: ['secure_entry'],
  activeCommunicationActorIds: [],
  recentConfirmedEventIds: [],
  entityAliasIndex: {
    front_door: ['front_door'],
    chair: ['chair'],
    椅子: ['chair'],
  },
  recentReferenceCandidates: [],
  phaseSummary: 'investigation at minute 2',
};
const barricadeBrief: TurnBrief = {
  ...brief,
  orderedActions: [{
    actionId: 'action-barricade',
    actorId: 'player',
    operation: 'secure_entry',
    targetIds: ['front_door'],
    method: 'block_with_chair',
    dependsOnActionIds: [],
    inputHandleIds: [],
    outputHandleIds: [],
    originalSpan: { start: 0, end: 7, text: '用椅子堵住门' },
  }],
  communications: [],
  candidateHandles: [],
};

{
  const issues = validateTurnBriefTargetContract(barricadeBrief, targetContext);
  assert(
    issues.some((issue) => (
      issue.path === 'brief.orderedActions.0.targetIds'
      && issue.message.includes('chair')
    )),
    'Furniture that changes state must be present in targetIds.',
  );
}

{
  const repaired = structuredClone(barricadeBrief);
  repaired.orderedActions[0].targetIds.push('chair');
  assert.deepEqual(validateTurnBriefTargetContract(repaired, targetContext), []);
}

{
  const invalid = structuredClone(barricadeBrief);
  invalid.orderedActions[0].operation = 'use_item';
  invalid.orderedActions[0].targetIds = ['chair'];
  const issues = validateTurnBriefTargetContract(invalid, targetContext);
  assert(
    issues.some((issue) => issue.message.includes('secure_entry')),
    'Barricading with furniture must use the secure_entry operation.',
  );
}

{
  const unsupported = structuredClone(barricadeBrief);
  unsupported.orderedActions[0].operation = 'use_item';
  unsupported.orderedActions[0].targetIds = ['chair'];
  unsupported.orderedActions[0].method = 'hold_as_weapon';
  unsupported.orderedActions[0].originalSpan.text = '拿椅子当武器';
  const issues = validateTurnBriefTargetContract(unsupported, targetContext);
  assert.equal(
    issues.some((issue) => issue.message.includes('secure_entry')),
    false,
    'Repair guidance must not reinterpret unrelated chair use as barricading.',
  );
  assert(
    issues.some((issue) => issue.message.includes('supported item')),
    'Unsupported chair use must remain a target-contract failure without changing intent.',
  );
}

{
  const invalid = structuredClone(barricadeBrief);
  invalid.orderedActions[0].targetIds = ['front_door', 'window'];
  const issues = validateTurnBriefTargetContract(invalid, {
    ...targetContext,
    accessibleEntityIds: [...targetContext.accessibleEntityIds, 'window'],
  });
  assert(
    issues.some((issue) => issue.message.includes('secure_entry targetIds')),
    'secure_entry must reject accessible targets that are not entrance barriers.',
  );
}

{
  const invalid = structuredClone(barricadeBrief);
  invalid.orderedActions[0].operation = 'communicate';
  invalid.orderedActions[0].targetIds = ['lin_yue', 'chen_huaimin'];
  const issues = validateTurnBriefTargetContract(invalid, {
    ...targetContext,
    accessibleEntityIds: ['player'],
    activeCommunicationActorIds: ['lin_yue', 'chen_huaimin'],
  });
  assert(
    issues.some((issue) => issue.message.includes('matching communication intent')),
    'Each communication action must carry structured recipient or situated-audience semantics.',
  );
}

{
  const invalid = structuredClone(barricadeBrief);
  invalid.orderedActions[0].operation = 'inspect';
  invalid.orderedActions[0].targetIds = ['player'];
  invalid.orderedActions[0].method = 'inspect';
  invalid.orderedActions[0].originalSpan.text = '检查自己';
  const issues = validateTurnBriefTargetContract(invalid, targetContext);
  assert(
    issues.some((issue) => issue.message.includes('visible room object')),
    'inspect must not accept a generally accessible entity that the reducer cannot inspect.',
  );
}

{
  const invalid = structuredClone(barricadeBrief);
  invalid.orderedActions[0].operation = 'use_item';
  invalid.orderedActions[0].targetIds = ['phone_charger', 'tape'];
  invalid.orderedActions[0].method = 'connect';
  invalid.orderedActions[0].originalSpan.text = 'use charger and tape';
  const issues = validateTurnBriefTargetContract(invalid, {
    ...targetContext,
    accessibleEntityIds: ['player', 'phone_charger', 'tape'],
  });
  assert(
    issues.some((issue) => issue.message.includes('exactly one supported item')),
    'use_item must use the same target cardinality as the low-risk reducer.',
  );
}

const compiler: SemanticCompiler = {
  async compile(request) {
    return { status: 'compiled', brief: { ...brief, ...request } };
  },
};
assert.equal(typeof compiler.compile, 'function');
