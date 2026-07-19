import {
  SemanticCompilerResultSchema,
  type SemanticCompilerRequest,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import type {
  ShadowCandidateAdapter,
  ShadowRunAdapters,
  ShadowSpecialistRegistration,
} from '@murder-loop-ai/game-core';
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
      const raw = await complete(
        'semantic_compiler',
        semanticCompilerPrompt(),
        request,
        { temperature: 0.1, maxTokens: 1200, signal: context?.signal },
      );
      if (!raw) throw new Error('Semantic Compiler returned no JSON.');
      const parsed = SemanticCompilerResultSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`Semantic Compiler schema: ${parsed.error.message}`);
      return parsed.data;
    },
  };

  const mainWorldModel: ShadowCandidateAdapter = async (projection, context) => {
    const raw = await complete(
      'world_model',
      proposalPrompt('main-world-model', 'all authorized domains'),
      { envelope: projectEnvelope(context.envelope), projection },
      { temperature: 0.45, maxTokens: 3600, signal: context.signal },
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
        { temperature: 0.35, maxTokens: 2200, signal: context.signal },
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
    'Echo loopId, turnId, inputStateVersion, and deadlineAt exactly. Use compilerVersion="semantic-compiler-v1" and schemaVersion="world-model-v1".',
    'Return one JSON object with status="compiled" and a strict TurnBrief in brief. If state-changing ambiguity cannot be safely narrowed, return status="clarification_required" with the same envelope, versions, questions, and ambiguities.',
    'Never include Canonical Truth, Killer/NPC knowledge, narration, recommendations, or free-form analysis.',
  ].join('\n');
}

function proposalPrompt(sourceAgent: string, domain: string): string {
  return [
    `You are ${sourceAgent}, generating Shadow Run candidates for domain ${domain}.`,
    'The output is a proposal only. It has zero authority and must never claim that state was committed.',
    'Use only projection.facts, projection.conditionalSignals, conditional communications, and the TurnBrief fields present in this projection.',
    'Actor actions must cite basedOnFactIds that the actor is authorized to know. Candidate communications and handles remain conditional until their prerequisite events are confirmed.',
    'Never use narration as evidence. Clue candidates must cite observation IDs. Recommendations must cite visible event IDs. Display fragments must cite their atomic eventRefs and claimRefs.',
    'Echo the envelope and contract versions exactly. riskClass is reversible, high_impact, or irreversible. High-risk events must include deterministic evidenceRefs and causalParentIds.',
    sourceAgent === 'main-world-model'
      ? 'If projection.fallbackMode="raw_input", interpret projection.rawInput conservatively because the Semantic Compiler failed; do not infer hidden facts. Return JSON {"proposals":[...]} with one or more strict Proposal objects. sourceAgent must be "main-world-model".'
      : `Return JSON {"candidates":[...]} with strict SpecialistCandidate objects. sourceAgent and specialistId must both be "${sourceAgent}", candidateType must be "specialist", and domain must be "${domain}".`,
    'Do not wrap JSON in markdown and do not add commentary.',
  ].join('\n');
}
