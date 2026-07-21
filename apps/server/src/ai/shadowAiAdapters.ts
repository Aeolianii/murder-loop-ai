import {
  SemanticCompilerResultSchema,
  WORLD_MODEL_SCHEMA_VERSION,
  type SemanticCompilerRequest,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import type {
  ShadowCandidateAdapter,
  ShadowRunAdapters,
  ShadowSpecialistRegistration,
} from '@murder-loop-ai/game-core';
import { validateTurnBriefTargetContract } from '@murder-loop-ai/game-core';
import { completeRoleJson, type CompletionOptions } from './openaiClient';
import type { AiRole } from './roleConfig';

export type ShadowCompletion = (
  role: AiRole,
  system: string,
  user: unknown,
  options: Omit<CompletionOptions, 'modelOverride'>,
) => Promise<unknown>;

const completeShadowJson: ShadowCompletion = (role, system, user, options) => (
  completeRoleJson(role, system, user, options)
);

export function createAiShadowAdapters(
  complete: ShadowCompletion = completeShadowJson,
): ShadowRunAdapters {
  const semanticCompiler = {
    async compile(request: SemanticCompilerRequest, context?: { signal: AbortSignal }) {
      const system = semanticCompilerPrompt();
      const options = {
        temperature: 0.1,
        maxTokens: 1200,
        signal: context?.signal,
        thinking: 'disabled' as const,
      };
      let raw = await complete(
        'semantic_compiler',
        system,
        request,
        options,
      );
      if (!raw) throw new Error('Semantic Compiler returned no JSON.');
      let parsed = SemanticCompilerResultSchema.safeParse(raw);
      const validationIssues = parsed.success
        ? parsed.data.status === 'compiled'
          ? validateTurnBriefTargetContract(parsed.data.brief, request.playerContext)
          : []
        : parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
      if (validationIssues.length > 0) {
        raw = await complete(
          'semantic_compiler',
          semanticCompilerRepairPrompt(system),
          {
            ...request,
            repair: {
              invalidOutput: raw,
              validationIssues,
            },
          },
          options,
        );
        if (!raw) throw new Error('Semantic Compiler repair returned no JSON.');
        parsed = SemanticCompilerResultSchema.safeParse(raw);
      }
      if (!parsed.success) throw new Error(`Semantic Compiler schema: ${parsed.error.message}`);
      if (parsed.data.status === 'compiled') {
        const remainingIssues = validateTurnBriefTargetContract(
          parsed.data.brief,
          request.playerContext,
        );
        if (remainingIssues.length > 0) {
          throw new Error(`Semantic Compiler target contract: ${remainingIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; ')}`);
        }
      }
      return parsed.data;
    },
  };

  const mainWorldModel: ShadowCandidateAdapter = async (projection, context) => {
    const raw = await complete(
      'world_model',
      proposalPrompt('main-world-model', 'all authorized domains'),
      { envelope: projectEnvelope(context.envelope), projection },
      { temperature: 0.45, maxTokens: 3600, signal: context.signal, thinking: 'disabled' },
    );
    if (!raw) throw new Error('Main World Model returned no JSON.');
    return raw;
  };

  return {
    semanticCompiler,
    mainWorldModel,
    specialists: createSpecialists(complete),
  };
}

function createSpecialists(complete: ShadowCompletion): ShadowSpecialistRegistration[] {
  return [
    specialist('player-specialist', 'player', 'player_specialist', complete),
    specialist('killer-specialist', 'killer', 'killer_specialist', complete),
    specialist('npc-specialist:lin_yue', 'npc', 'npc_specialist', complete, 'lin_yue'),
    specialist('npc-specialist:police_dispatch', 'npc', 'npc_specialist', complete, 'police_dispatch'),
    specialist('environment-specialist', 'environment', 'environment_specialist', complete),
    specialist('clue-specialist', 'clue', 'clue_specialist', complete),
    specialist('recommendation-specialist', 'recommendation', 'recommendation_specialist', complete),
  ];
}

function specialist(
  id: string,
  domain: ShadowSpecialistRegistration['domain'],
  role: AiRole,
  complete: ShadowCompletion,
  npcId?: string,
): ShadowSpecialistRegistration {
  return {
    id,
    domain,
    npcId,
    generate: async (projection, context) => {
      const raw = await complete(
        role,
        proposalPrompt(id, domain),
        { envelope: projectEnvelope(context.envelope), projection },
        { temperature: 0.35, maxTokens: 2200, signal: context.signal, thinking: 'disabled' },
      );
      if (!raw) throw new Error(`${id} returned no JSON.`);
      return raw;
    },
  };
}

function projectEnvelope(envelope: TurnEnvelope): TurnEnvelope {
  return {
    loopId: envelope.loopId,
    turnId: envelope.turnId,
    inputStateVersion: envelope.inputStateVersion,
    deadlineAt: envelope.deadlineAt,
  };
}

function semanticCompilerPrompt(): string {
  return [
    'You are the fast Semantic Compiler for a turn-based mystery game.',
    'Read only rawInput and compact playerContext from the request. Do not infer success, time, battery, observations, clues, killer/NPC decisions, state patches, death, or endings.',
    'Preserve atomic action order, dependencies, negation, scope-only restrictions, conditionals, references, communications, candidate handles, intended audience, and exact source spans.',
    'Resolve pronouns and deictic references to the nearest compatible explicit entity in the same action or communication, then use playerContext aliases and recent reference candidates. Request clarification only when two or more compatible candidates remain and choosing between them would change state.',
    'An unknown answer or future outcome is not an input ambiguity. Preserve it as communication content or desiredOutcome; do not ask the player to supply the answer that another actor is being asked to provide.',
    'Canonical executable operation IDs: inspect, photograph, communicate, secure_entry, pick_up, use_item, wait, act. Use a specific canonical operation whenever its meaning matches. For any other ordinary, nonviolent, reversible player behavior, use operation="act" instead of inventing an application-specific operation. Preserve only genuinely high-impact or irreversible unsupported intents with a concise snake_case operation.',
    'When a requested behavior requires a physical resource absent from playerContext.accessibleEntityIds, do not invent an inaccessible entity ID or discard the request. Use operation="act" with targetIds=["player"], preserve the requested resource and attempted behavior in method and originalSpan, and let the Player Specialist adjudicate a blocked or failed outcome.',
    'All outgoing speech, questions, replies, calls, and messages use operation="communicate"; use operation="photograph" for image capture. A question carried by a message is communication content, not a separate action. Put its recipients, channel, attachments, audience, and contentSummary in one communications item tied to that actionId.',
    'targetIds must contain every accessible entity whose state or location the action changes. Physical target IDs must come from playerContext.accessibleEntityIds; communication recipients must come from playerContext.activeCommunicationActorIds.',
    'method describes technique only and must never be the only place where a state-changing entity appears.',
    'Every secure_entry action must include "front_door" in targetIds. Barricading with chair must use operation="secure_entry" and targetIds=["front_door","chair"]. Never encode furniture barricading as use_item.',
    'For sequential "lock, then barricade" input, emit two secure_entry actions in source order. The barricade action depends on the lock action and includes both front_door and the furniture entity in targetIds.',
    'When the player explicitly asks to inspect, open, or view package contents, set scope="interior.contents". Preserve equivalent Chinese phrases such as “检查包裹内容”“打开包裹”“看看包裹里面” as the same interior scope; never reduce them to an exterior-only package inspection.',
    `Echo loopId, turnId, inputStateVersion, and deadlineAt exactly. Use compilerVersion="semantic-compiler-v1" and schemaVersion="${WORLD_MODEL_SCHEMA_VERSION}".`,
    'Return valid json only.',
    'Every object is strict. Every key shown below is required unless explicitly marked optional. Use [] for every array field that has no grounded items. Do not add keys that are not shown in the contract.',
    'Do not copy sample IDs or text. Replace them with values grounded in the current request. Omit optional keys instead of returning null.',
    'COMPILED OUTPUT CONTRACT:',
    JSON.stringify({
      status: 'compiled',
      brief: {
        loopId: 'COPY_REQUEST_LOOP_ID',
        turnId: 'COPY_REQUEST_TURN_ID',
        inputStateVersion: 0,
        deadlineAt: 'COPY_REQUEST_DEADLINE_AT',
        compilerVersion: 'semantic-compiler-v1',
        schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
        utteranceMode: 'command',
        resolvedReferences: [],
        orderedActions: [],
        globalConstraints: [],
        scopedConstraints: [],
        communications: [],
        candidateHandles: [],
        ambiguities: [],
      },
    }),
    'The labels before each colon below are documentation only. Never emit those labels as JSON keys.',
    `resolvedReferences item: ${JSON.stringify({
      referenceId: 'reference-1',
      originalSpan: { start: 0, end: 1, text: 'exact source text' },
      entityIds: ['entity-id'],
      confidence: 1,
    })}`,
    `orderedActions item: ${JSON.stringify({
      actionId: 'action-1',
      actorId: 'player',
      operation: 'operation-id',
      targetIds: ['entity-id'],
      scope: 'optional scope; omit when absent',
      method: 'optional method; omit when absent',
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: 1, text: 'exact source text' },
      stealthIntent: false,
      intendedAudience: [],
      desiredOutcome: 'optional desired outcome; omit when absent',
    })}`,
    'In an orderedActions item, scope, method, and desiredOutcome are optional; when absent, omit the key entirely and never output null.',
    `globalConstraints or scopedConstraints item: ${JSON.stringify({
      id: 'constraint-1',
      type: 'must_not',
      actionIds: ['action-1'],
      value: true,
      originalSpan: { start: 0, end: 1, text: 'exact source text' },
    })}`,
    `communications item: ${JSON.stringify({
      id: 'communication-1',
      actionId: 'action-1',
      senderId: 'player',
      recipientIds: ['recipient-id'],
      channel: 'channel-id',
      contentSummary: 'content explicitly requested by the player',
      attachmentHandleIds: [],
      intendedAudience: ['recipient-id'],
    })}`,
    `candidateHandles item: ${JSON.stringify({
      id: 'candidate-handle-1',
      kind: 'artifact-kind',
      producedByActionId: 'action-1',
      dependsOnActionIds: ['action-1'],
    })}`,
    `ambiguities item: ${JSON.stringify({
      id: 'ambiguity-1',
      originalSpan: { start: 0, end: 1, text: 'exact source text' },
      description: 'what cannot be safely resolved',
      impact: 'state',
      requiresClarification: true,
    })}`,
    'Allowed utteranceMode values: command, question, hypothetical, mixed, clarification_required. Allowed constraint type values: must_not, scope_only, conditional, sequence, visibility. Allowed ambiguity impact values: state, display, low.',
    'All dependsOnActionIds must point only to earlier orderedActions. Every handle reference must have a matching candidateHandles item. A communication actionId must exist in orderedActions.',
    'If there is no ambiguity, return ambiguities=[]. Never invent a generic ambiguity. If a state-changing ambiguity truly requires clarification, use this exact top-level contract:',
    JSON.stringify({
      status: 'clarification_required',
      loopId: 'COPY_REQUEST_LOOP_ID',
      turnId: 'COPY_REQUEST_TURN_ID',
      inputStateVersion: 0,
      deadlineAt: 'COPY_REQUEST_DEADLINE_AT',
      compilerVersion: 'semantic-compiler-v1',
      schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
      questions: ['one precise clarification question'],
      ambiguities: [{
        id: 'ambiguity-1',
        originalSpan: { start: 0, end: 1, text: 'exact source text' },
        description: 'what cannot be safely resolved',
        impact: 'state',
        requiresClarification: true,
      }],
    }),
    'If compilation itself is unavailable, use this exact top-level contract:',
    JSON.stringify({
      status: 'fallback_to_world_model',
      loopId: 'COPY_REQUEST_LOOP_ID',
      turnId: 'COPY_REQUEST_TURN_ID',
      inputStateVersion: 0,
      deadlineAt: 'COPY_REQUEST_DEADLINE_AT',
      compilerVersion: 'semantic-compiler-v1',
      schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
      reasonCode: 'compiler_unavailable',
    }),
    'Never include Canonical Truth, Killer/NPC knowledge, narration, recommendations, or free-form analysis.',
  ].join('\n');
}

function semanticCompilerRepairPrompt(basePrompt: string): string {
  return [
    basePrompt,
    'REPAIR MODE: the previous output failed schema or target-contract validation.',
    'Use repair.validationIssues only to locate contract violations. Fix only the invalid structure; do not add, remove, merge, split, or reorder player actions.',
    'Preserve the original request meaning, exact source spans, references, communication content, envelope, and versions. For target-contract issues, change only operation, targetIds, and dependencies required by the listed violation.',
    'Return one complete replacement json object, not a patch. Add every required key, including required arrays when empty. Omit absent optional keys instead of using null. Do not add any key outside the documented contract.',
  ].join('\n');
}

function proposalPrompt(sourceAgent: string, domain: string): string {
  const specialistContract = sourceAgent === 'main-world-model'
    ? {}
    : {
        candidateType: 'specialist',
        specialistId: sourceAgent,
      };
  const factAuthorizationRule = sourceAgent === 'main-world-model'
    ? 'projection.proposalAuthority is the deterministic authority manifest derived from the proposal domain without story-specific names. For a Main player candidate, basedOnFactIds and fact-kind preconditions must use only projection.proposalAuthority.authorizedFactIds, and actor-controlled operations must use only projection.proposalAuthority.authorizedOperations.'
    : 'projection.factIds is the complete authorized fact set for this specialist. Cite only fact IDs from that set.';
  return [
    `You are ${sourceAgent}, generating Shadow Run candidates for domain ${domain}.`,
    proposalRoleDirective(sourceAgent, domain),
    'The output is a proposal only. It has zero authority and must never claim that state was committed.',
    'Use only projection.facts, projection.conditionalSignals, conditional communications, and the TurnBrief fields present in this projection.',
    'Actor actions must cite basedOnFactIds that the actor is authorized to know. Candidate communications and handles remain conditional until their prerequisite events are confirmed.',
    'For every actor-controlled action, information transfer, movement, or destruction event, operation must match a capability value exposed to that actor in projection.facts. Capability data is scenario policy; never infer an operation from an actor name.',
    factAuthorizationRule,
    'Choose proposal actorId from the subject of that actor capability facts in projection.facts. Viewer or communication aliases are not world entity IDs.',
    'A fact merely being present in projection.facts does not authorize the candidate to cite it. basedOnFactIds and fact-kind precondition refs must be subsets of the authorized fact IDs.',
    'Never use narration as evidence. Every new world claim must be a structured event assertion with subject, predicate, value, and visibility. Observations, clues, and display fragments cite proposal-local assertion IDs; they never invent canonical Fact IDs or use predicate text as a foreign key.',
    'Classify riskClass from the direct proposed effect, not from possible downstream consequences or the surrounding threat.',
    'For this contract, an authorized inspect, photograph, communicate, secure_entry, pick_up, use_item, wait, or act event is reversible when its direct effect causes no injury, coercion, destruction, ending, external authority decision, or hidden-state mutation.',
    'For operation="act", first judge feasibility from the supplied facts and ordinary real-world causality. Use status="completed" when feasible, or status="blocked"/"failed" when infeasible. The event summary must be a complete Simplified Chinese player-facing consequence; an infeasible summary must clearly say what cannot be done and why. Do not invent an unstated blocker merely because the behavior is not a named game mechanic.',
    'If the required physical resource is absent from the accessible entity IDs and grounded facts, resolve the act as blocked or failed and explain the unavailable resource in Simplified Chinese. The event must not create or materialize the missing resource.',
    'For a blocked or failed act caused by a missing resource, proposedEffects, observations, clueCandidates, recommendations, and displayFragments must all be empty; communicate the result only through the proposedEvents summary.',
    'Locking or barricading an entry with an accessible ordinary object is reversible; do not upgrade it merely because it may change a later NPC route.',
    'Echo the envelope and contract versions exactly. riskClass is reversible, high_impact, or irreversible. High-risk events must include deterministic evidenceRefs and causalParentIds.',
    'Use only these mechanism-level event kinds: action, state_transition, information_transfer, observation, timer, ending. Story entities and outcomes belong in actorId, targetIds, operation, and structured assertions; never create a story-specific event kind.',
    'Every proposed event actorId must equal the proposal actorId. Describe attempted, completed, blocked, or failed outcomes with status. Use operation for the reusable mechanic, such as move, enter, attack, change_status, communicate, observe, destroy, advance_time, or resolve_ending.',
    'Every proposed event must list the TurnBrief actions it resolves in sourceActionIds. sourceActionIds must be a subset of the candidate turnBriefActionIds. Autonomous specialist events use []. For a player candidate, every TurnBrief action must be covered by at least one completed, blocked, or failed event; attempted alone does not resolve an action.',
    'A recommendation must cite at least one authorized basedOnFactIds item or one confirmed visible basedOnEventIds item. Current-state advice should cite exact IDs from projection.factIds; never fabricate an event ID merely to satisfy provenance.',
    'Never jump directly to a high-impact result. A resolved action cites its attempted causal parent when applicable; a state transition cites the action or prior transition that caused it; an ending cites a terminal parent. Every high-risk event must cite at least one causal ancestor and at least one independent fact, capability, or invariant from projection.facts or projection.canonicalConstraints.',
    'Every candidate object is strict. Every key in the following contract is required. Use [] for every array field that has no grounded items. Do not add keys that are not shown in the contract.',
    'Do not copy sample IDs or facts. Copy envelope values from user.envelope and compilerVersion/schemaVersion from user.projection. confidence must be between 0 and 1.',
    'CANDIDATE OBJECT CONTRACT:',
    JSON.stringify({
      loopId: 'COPY_ENVELOPE_LOOP_ID',
      turnId: 'COPY_ENVELOPE_TURN_ID',
      inputStateVersion: 0,
      deadlineAt: 'COPY_ENVELOPE_DEADLINE_AT',
      id: 'unique-candidate-id',
      compilerVersion: 'COPY_PROJECTION_COMPILER_VERSION',
      schemaVersion: 'COPY_PROJECTION_SCHEMA_VERSION',
      sourceAgent,
      domain: sourceAgent === 'main-world-model' ? 'player' : domain,
      candidateRank: 0,
      turnBriefActionIds: [],
      replacementFor: [],
      actorId: domain === 'player' ? 'player' : 'authorized-actor-id',
      operation: 'no_op',
      targetIds: [],
      basedOnFactIds: [],
      preconditions: [],
      forbiddenScopes: [],
      proposedEffects: [],
      observations: [],
      visibility: [],
      confidence: 1,
      riskClass: 'reversible',
      evidenceRefs: [],
      causalParentIds: [],
      proposedEvents: [],
      clueCandidates: [],
      recommendations: [],
      displayFragments: [],
      ...specialistContract,
    }),
    'Every field whose contract value is an array of IDs, references, scopes, or viewers must contain strings only, never objects. In particular, visibility must be an array of string IDs only, never an array of objects. assertions is the only structured claim array. The string-only rule applies to turnBriefActionIds, sourceActionIds, replacementFor, targetIds, basedOnFactIds, forbiddenScopes, evidenceRefs, causalParentIds, eventRefs, claimRefs, basedOnEffectIds, basedOnObservationIds, visibleAssertionIds, claimAssertionIds, and basedOnEventIds.',
    'The labels before each colon below are documentation only. Never emit those labels as JSON keys.',
    `preconditions item: ${JSON.stringify({
      id: 'precondition-1',
      kind: 'fact',
      ref: 'authorized-fact-id',
      expected: true,
    })}`,
    `proposedEffects item: ${JSON.stringify({
      id: 'effect-1',
      targetType: 'entity-type',
      targetId: 'entity-id',
      operation: 'set',
      path: 'state.path',
      value: true,
      causalParentIds: [],
    })}`,
    `observations item: ${JSON.stringify({
      id: 'observation-1',
      subject: 'entity-id',
      predicate: 'observed-predicate',
      value: 'observed-value',
      scope: 'visible-scope',
      basedOnEffectIds: ['effect-1'],
      basedOnEventIds: ['event-1'],
      visibleAssertionIds: ['assertion-1'],
    })}`,
    `proposedEvents item: ${JSON.stringify({
      id: 'event-1',
      kind: 'action',
      sourceActionIds: ['action-id'],
      actorId: 'authorized-actor-id',
      operation: 'mechanic-operation',
      targetIds: ['entity-id'],
      status: 'completed',
      summary: 'short factual summary',
      assertions: [{
        id: 'assertion-1',
        subject: 'entity-id',
        predicate: 'state-property',
        value: 'structured-value',
        visibleTo: ['player'],
      }],
      visibility: ['player'],
      riskClass: 'reversible',
      evidenceRefs: ['authorized-fact-id'],
      causalParentIds: [],
    })}`,
    `clueCandidates item: ${JSON.stringify({
      id: 'clue-1',
      claimAssertionIds: ['assertion-1'],
      basedOnObservationIds: ['observation-1'],
      visibleAssertionIds: ['assertion-1'],
      confidence: 1,
    })}`,
    `recommendations item: ${JSON.stringify({
      id: 'recommendation-1',
      label: '检查尚未确认的区域',
      rationale: '根据玩家已经确认的事实说明推荐理由。',
      basedOnFactIds: ['authorized-fact-id'],
      basedOnEventIds: [],
    })}`,
    `displayFragments item: ${JSON.stringify({
      id: 'display-1',
      text: 'text containing only confirmed candidate claims',
      eventRefs: ['event-1'],
      claimRefs: ['assertion-1'],
    })}`,
    'Allowed precondition kind values: fact, event, capability, invariant. Allowed riskClass values: reversible, high_impact, irreversible.',
    domain === 'player'
      ? 'For a player candidate, turnBriefActionIds must contain every actionId in projection.turnBrief.orderedActions, in the same order. Use operation="compound_action" when more than one action is covered.'
      : 'Do not copy player TurnBrief actions into this domain. Cite only signals, communications, facts, and constraints visible in this projection.',
    sourceAgent === 'main-world-model'
      ? 'If projection.fallbackMode="raw_input", interpret projection.rawInput conservatively because the Semantic Compiler failed; do not infer hidden facts. Return JSON {"proposals":[...]} with one or more candidate objects. sourceAgent must be "main-world-model". Prefer a player proposal that covers every TurnBrief action when a compiled TurnBrief exists.'
      : `Return JSON {"candidates":[...]} with exactly one candidate object. sourceAgent and specialistId must both be "${sourceAgent}", candidateType must be "specialist", and domain must be "${domain}". Return one schema-valid no_op candidate with empty effect/event/display arrays when this domain has no grounded action; never return an empty candidates array.`,
    'Do not wrap JSON in markdown and do not add commentary.',
  ].join('\n');
}

function proposalRoleDirective(sourceAgent: string, domain: string): string {
  if (sourceAgent === 'main-world-model') {
    return [
      'You are the Main World Model. Convert every compiled player action into a complete candidate event graph in TurnBrief order.',
      'You know projection.facts only for world coherence. projection.proposalAuthority.authorizedFactIds is the exact fact allowlist for basedOnFactIds and fact preconditions, and authorizedOperations is the exact operation allowlist.',
      'Facts outside that allowlist must not be exposed through assertions, observations, summaries, recommendations, or display text.',
      'Follow the TurnBrief, proposal authority, capability, causality, visibility, and risk logic. Output proposed results of the player request; do not invent a different next action.',
    ].join(' ');
  }
  if (domain === 'recommendation') {
    return [
      'You are the Recommendation Specialist. Use only player-visible facts and confirmed visible event anchors to recommend useful player actions.',
      'Recommendations are non-authoritative and must never invent a world-state change.',
      'Recommendations are displayed after projection.turnBrief completes.',
      'Do not recommend the same operation and targetIds already present in projection.turnBrief.orderedActions.',
      'Do not use a fact about a current action target when that action may change the cited fact before the recommendation is displayed.',
      'label 和 rationale 必须使用简体中文，不得输出英文句子、后台字段名或事实 ID；只有 id 继续使用稳定的英文标识。',
      'For this role, recommendations is the only non-empty payload array.',
      'Keep proposedEffects, observations, proposedEvents, clueCandidates, and displayFragments empty.',
      'Also keep turnBriefActionIds, replacementFor, targetIds, basedOnFactIds, preconditions, forbiddenScopes, visibility, evidenceRefs, and causalParentIds empty.',
    ].join(' ');
  }
  if (domain === 'player') {
    return 'You are the Player Specialist. You know the compiled player request and player-visible fact projection. Resolve every ordered player action into grounded candidate events without inventing hidden knowledge. For operation="act", decide whether the behavior is feasible: completed means it succeeds, blocked/failed means it does not. If a required resource is unavailable, preserve the request as a failed outcome instead of dropping it. Write every player-facing event summary in Simplified Chinese and include the direct consequence; when blocked or failed, explicitly state what cannot be done and why.';
  }
  if (domain === 'killer') {
    return 'You are the Killer Specialist. You know only the killer fact projection and observable conditional signals. Propose the actor next behavior from capabilities and causal constraints, never from hidden player intent.';
  }
  if (domain === 'npc') {
    return 'You are an NPC Specialist. You know only this actor fact projection and delivered communications. Propose this actor next behavior from capabilities, knowledge, and visible signals.';
  }
  if (domain === 'environment') {
    return 'You are the Environment Specialist. You know public environment facts and confirmed signals. Propose only grounded environmental transitions.';
  }
  if (domain === 'clue') {
    return [
      'You are the Clue Specialist. You know only player-visible facts, conditional signals, and projection.clueDefinitions.',
      'Use only a canonical clue id from projection.clueDefinitions, and only when a completed reversible observation event exposes assertions matching that clue allowedAssertions entry.',
      'The proposal must be observation-only: keep proposedEffects, recommendations, and state-changing events empty; proposedEvents may contain only kind="observation" events visible to the player.',
      'Every clue claimAssertionIds and visibleAssertionIds item must be exposed by its basedOnObservationIds, and every observation must cite its supporting proposed observation event.',
      'If no canonical clue is grounded, return one no_op clue candidate with empty proposedEvents, observations, clueCandidates, and displayFragments.',
    ].join(' ');
  }
  return `You are the ${domain} Specialist. Use only the supplied projection and generic causal rules.`;
}
