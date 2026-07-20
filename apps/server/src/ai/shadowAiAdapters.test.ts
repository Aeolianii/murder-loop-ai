import assert from 'node:assert/strict';
import {
  WORLD_MODEL_SCHEMA_VERSION,
  type SemanticCompilerRequest,
} from '@murder-loop-ai/ai-contracts';
import { createAiShadowAdapters, type ShadowCompletion } from './shadowAiAdapters';

const request: SemanticCompilerRequest = {
  loopId: 'legacy-run-1',
  turnId: 'shadow-turn-1',
  inputStateVersion: 0,
  deadlineAt: '2026-07-20T12:00:01.000Z',
  rawInput: '等待',
  playerContext: {
    facts: [],
    accessibleEntityIds: ['player'],
    capabilities: ['wait'],
    activeCommunicationActorIds: [],
    recentConfirmedEventIds: [],
    entityAliasIndex: {},
    recentReferenceCandidates: [],
    phaseSummary: 'loop started',
  },
};
const brief = {
  ...request,
  rawInput: undefined,
  playerContext: undefined,
  compilerVersion: 'semantic-compiler-v1',
  schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
  utteranceMode: 'command' as const,
  resolvedReferences: [],
  orderedActions: [],
  globalConstraints: [],
  scopedConstraints: [],
  communications: [],
  candidateHandles: [],
  ambiguities: [],
};
delete (brief as Record<string, unknown>).rawInput;
delete (brief as Record<string, unknown>).playerContext;

const calls: Array<{
  role: string;
  system: string;
  user: unknown;
  signal?: AbortSignal;
  maxTokens?: number;
  thinking?: 'enabled' | 'disabled';
}> = [];
const completion: ShadowCompletion = async (role, system, user, options) => {
  calls.push({
    role,
    system,
    user,
    signal: options.signal,
    maxTokens: options.maxTokens,
    thinking: (options as { thinking?: 'enabled' | 'disabled' }).thinking,
  });
  if (role === 'semantic_compiler') return { status: 'compiled', brief };
  if (role === 'world_model') return { proposals: [] };
  return { candidates: [] };
};
const adapters = createAiShadowAdapters(completion);
const controller = new AbortController();
const semantic = await adapters.semanticCompiler.compile(request, { signal: controller.signal });
assert.equal(semantic.status, 'compiled');
assert.equal(calls[0].role, 'semantic_compiler');
assert.equal(calls[0].signal, controller.signal);
assert((calls[0].maxTokens ?? 0) <= 1400);
assert.equal(calls[0].thinking, 'disabled');
for (const requiredField of [
  'resolvedReferences',
  'orderedActions',
  'globalConstraints',
  'scopedConstraints',
  'communications',
  'candidateHandles',
  'ambiguities',
  'originalSpan',
  'dependsOnActionIds',
  'inputHandleIds',
  'outputHandleIds',
  'attachmentHandleIds',
  'producedByActionId',
  'requiresClarification',
]) {
  assert(
    calls[0].system.includes(`"${requiredField}"`),
    `Semantic Compiler prompt must define the "${requiredField}" contract field.`,
  );
}
assert(calls[0].system.includes('Use [] for every array field that has no grounded items.'));
assert(calls[0].system.includes('Do not add keys that are not shown in the contract.'));
assert(
  calls[0].system.includes(
    'Canonical executable operation IDs: inspect, photograph, communicate, secure_entry, pick_up, use_item, wait.',
  ),
  'Semantic Compiler prompt must align operation IDs with the generic local reducer vocabulary.',
);
assert(
  calls[0].system.includes(
    'A question carried by a message is communication content, not a separate action.',
  ),
  'Semantic Compiler prompt must keep message content inside the communication action.',
);
assert(
  calls[0].system.includes(
    'scope, method, and desiredOutcome are optional; when absent, omit the key entirely and never output null.',
  ),
  'Semantic Compiler prompt must distinguish omitted optional fields from null values.',
);
assert(
  calls[0].system.includes(
    'Resolve pronouns and deictic references to the nearest compatible explicit entity',
  ),
  'Semantic Compiler prompt must define a generic reference-resolution policy.',
);
assert(
  calls[0].system.includes(
    'An unknown answer or future outcome is not an input ambiguity.',
  ),
  'Semantic Compiler prompt must not request clarification merely because an answer is unknown.',
);
assert.match(
  calls[0].system,
  /\bjson\b/,
  'DeepSeek json_object mode requires the lowercase word "json" in the prompt.',
);
assert.equal(
  calls[0].system.includes('{"sourceSpan":'),
  false,
  'Semantic Compiler item examples must not be grouped behind wrapper labels the model can copy.',
);
assert(calls[0].system.includes('resolvedReferences item:'));
assert(calls[0].system.includes('orderedActions item:'));

await adapters.mainWorldModel({ turnBrief: brief, facts: [] }, {
  envelope: request,
  signal: controller.signal,
});
assert.equal(calls.at(-1)?.role, 'world_model');
assert(calls.at(-1)?.system.includes('"proposals"'));
assert(
  calls.at(-1)?.system.includes(
    'derive its authority viewer from the proposal domain, without using story-specific names',
  ),
  'Main World Model prompt must derive actor knowledge from generic domain authority.',
);

assert.deepEqual(
  adapters.specialists.map((registration) => registration.id),
  [
    'player-specialist',
    'killer-specialist',
    'npc-specialist:lin_yue',
    'npc-specialist:police_dispatch',
    'environment-specialist',
    'clue-specialist',
    'recommendation-specialist',
  ],
);

const killer = adapters.specialists.find((registration) => registration.id === 'killer-specialist');
await killer?.generate({ facts: [], conditionalSignals: [] }, {
  envelope: request,
  signal: controller.signal,
});
assert.equal(calls.at(-1)?.role, 'killer_specialist');
assert.equal(calls.at(-1)?.thinking, 'disabled');
assert.equal(JSON.stringify(calls.at(-1)?.user).includes(request.rawInput), false);
assert(calls.at(-1)?.system.includes('action, state_transition, information_transfer'));
assert(calls.at(-1)?.system.includes('actorId, targetIds, operation, and structured assertions'));
for (const storySpecificToken of [
  'actor_entered',
  'attack_landed',
  'character_killed',
  'package_photographed',
  'room_503',
  'chen_huaimin',
  'lin_yue',
  'real_police',
]) {
  assert.equal(
    calls.at(-1)?.system.includes(storySpecificToken),
    false,
    `Proposal prompt must not hard-code story token "${storySpecificToken}".`,
  );
}
assert(calls.at(-1)?.system.includes('"basedOnEventIds"'));
assert(calls.at(-1)?.system.includes('"visibleAssertionIds"'));
assert(
  calls.at(-1)?.system.includes(
    'Observations, clues, and display fragments cite proposal-local assertion IDs',
  ),
  'Proposal prompt must use structured assertion provenance instead of matching free-form text.',
);
assert(
  calls.at(-1)?.system.includes('"claimAssertionIds":["assertion-1"]'),
  'Clue contract example must cite the assertion exposed by its observation.',
);
for (const requiredField of [
  'candidateRank',
  'turnBriefActionIds',
  'replacementFor',
  'actorId',
  'operation',
  'targetIds',
  'basedOnFactIds',
  'preconditions',
  'forbiddenScopes',
  'proposedEffects',
  'observations',
  'visibility',
  'confidence',
  'riskClass',
  'evidenceRefs',
  'causalParentIds',
  'proposedEvents',
  'clueCandidates',
  'recommendations',
  'displayFragments',
  'candidateType',
  'specialistId',
]) {
  assert(
    calls.at(-1)?.system.includes(`"${requiredField}"`),
    `Specialist prompt must define the "${requiredField}" contract field.`,
  );
}
assert(calls.at(-1)?.system.includes('"candidates"'));
assert(calls.at(-1)?.system.includes('Return one schema-valid no_op candidate'));
assert(calls.at(-1)?.system.includes('Do not add keys that are not shown in the contract.'));
assert(
  calls.at(-1)?.system.includes(
    'A fact merely being present in projection.facts does not authorize the candidate to cite it.',
  ),
  'Proposal prompt must define fact authorization independently of scenario content.',
);
assert(
  calls.at(-1)?.system.includes(
    'projection.factIds is the complete authorized fact set for this specialist',
  ),
  'Specialists must use the local projector authorization set directly.',
);
assert(
  calls.at(-1)?.system.includes(
    'visibility must be an array of string IDs only, never an array of objects.',
  ),
  'Proposal prompt must disambiguate string-ID arrays from structured item arrays.',
);
assert.equal(
  calls.at(-1)?.system.includes('{"precondition":'),
  false,
  'Proposal nested item examples must not be grouped behind wrapper labels the model can copy.',
);
assert(calls.at(-1)?.system.includes('preconditions item:'));
assert(calls.at(-1)?.system.includes('proposedEvents item:'));

const repairCalls: Array<{ system: string; user: unknown }> = [];
const repairAdapters = createAiShadowAdapters(async (role, system, user) => {
  assert.equal(role, 'semantic_compiler');
  repairCalls.push({ system, user });
  if (repairCalls.length === 1) {
    return {
      status: 'compiled',
      brief: {
        ...brief,
        orderedActions: [{
          actionId: 'action-wait',
          actorId: 'player',
          operation: 'wait',
          targetIds: [],
          originalSpan: { start: 0, end: 2, text: request.rawInput },
        }],
      },
    };
  }
  return {
    status: 'compiled',
    brief: {
      ...brief,
      orderedActions: [{
        actionId: 'action-wait',
        actorId: 'player',
        operation: 'wait',
        targetIds: [],
        dependsOnActionIds: [],
        inputHandleIds: [],
        outputHandleIds: [],
        originalSpan: { start: 0, end: 2, text: request.rawInput },
      }],
    },
  };
});
const repairedSemantic = await repairAdapters.semanticCompiler.compile(request, {
  signal: controller.signal,
});
assert.equal(repairedSemantic.status, 'compiled');
assert.equal(repairCalls.length, 2, 'Semantic Compiler must make at most one structural repair call.');
assert(repairCalls[1].system.includes('REPAIR MODE'));
assert(
  JSON.stringify(repairCalls[1].user).includes('dependsOnActionIds'),
  'Structural repair request must identify the exact invalid field path.',
);
