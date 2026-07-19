import assert from 'node:assert/strict';
import type { TurnBrief } from '@murder-loop-ai/ai-contracts';
import { validateTurnBrief, type SemanticCompiler } from './turnBriefValidator';

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

const compiler: SemanticCompiler = {
  async compile(request) {
    return { status: 'compiled', brief: { ...brief, ...request } };
  },
};
assert.equal(typeof compiler.compile, 'function');
