import type { Fact, ProposalDomain, TurnBrief } from '@murder-loop-ai/ai-contracts';
import type { FactProjection, KnowledgeProjections } from '../facts/knowledgeProjection';
import type { CanonicalStoryMaterial } from '../storyMaterial/canonicalStoryMaterial';

export interface ConditionalIntentSignal {
  id: string;
  domain: ProposalDomain;
  visibleTo: string[];
  prerequisiteEventIds: string[];
  signalType: string;
  subjectId: string;
  scope?: string;
  candidateHandleIds?: string[];
}

export interface IntentProjectionInput {
  brief: TurnBrief;
  knowledge: KnowledgeProjections;
  canonicalConstraints: string[];
  canonicalStoryMaterial: CanonicalStoryMaterial[];
  conditionalSignals: ConditionalIntentSignal[];
}

interface ProjectedTurnMetadata {
  loopId: string;
  turnId: string;
  inputStateVersion: number;
  deadlineAt: string;
  compilerVersion: string;
  schemaVersion: string;
}

interface SpecialistProjection extends ProjectedTurnMetadata {
  facts: Fact[];
  factIds: string[];
  canonicalConstraints: string[];
  conditionalSignals: ConditionalIntentSignal[];
}

export interface ConditionalCommunication {
  id: string;
  actionId: string;
  senderId: string;
  recipientIds: string[];
  channel: string;
  contentSummary: string;
  attachmentHandleIds: string[];
  intendedAudience: string[];
  prerequisiteEventId: string;
}

export interface IntentProjections {
  mainWorldModel: ProjectedTurnMetadata & {
    turnBrief: TurnBrief;
    facts: Fact[];
    factIds: string[];
    proposalAuthority: {
      domain: 'player';
      actorId: 'player';
      authorizedFactIds: string[];
      authorizedOperations: string[];
    };
    canonicalConstraints: string[];
    canonicalStoryMaterial: CanonicalStoryMaterial[];
  };
  playerSpecialist: ProjectedTurnMetadata & FactProjection & { turnBrief: TurnBrief };
  killerSpecialist: SpecialistProjection;
  npcSpecialists: Record<string, SpecialistProjection & { communications: ConditionalCommunication[] }>;
  environmentSpecialist: SpecialistProjection;
  clueSpecialist: SpecialistProjection;
  recommendationSpecialist: SpecialistProjection;
}

export function projectTurnIntent(input: IntentProjectionInput): IntentProjections {
  const metadata = projectMetadata(input.brief);
  const publicFacts = input.knowledge.worldModel.facts.filter((fact) => fact.visibleTo.includes('public'));

  return {
    mainWorldModel: {
      ...metadata,
      turnBrief: input.brief,
      facts: input.knowledge.worldModel.facts,
      factIds: input.knowledge.worldModel.factIds,
      proposalAuthority: {
        domain: 'player',
        actorId: 'player',
        authorizedFactIds: [...input.knowledge.player.factIds],
        authorizedOperations: capabilityOperations(input.knowledge.player.facts, 'player'),
      },
      canonicalConstraints: [...input.canonicalConstraints],
      canonicalStoryMaterial: input.canonicalStoryMaterial.map((material) => ({
        ...material,
        eligibilityRules: [...material.eligibilityRules],
        allowedDomains: [...material.allowedDomains],
        forbiddenClaims: [...material.forbiddenClaims],
      })),
    },
    playerSpecialist: {
      ...metadata,
      ...input.knowledge.player,
      turnBrief: input.brief,
    },
    killerSpecialist: specialistProjection(
      metadata,
      input.knowledge.killer,
      signalsFor(input.conditionalSignals, 'killer', 'killer'),
      input.canonicalConstraints,
    ),
    npcSpecialists: Object.fromEntries(
      Object.entries(input.knowledge.npcs).map(([npcId, projection]) => [
        npcId,
        {
          ...specialistProjection(
            metadata,
            projection,
            signalsFor(input.conditionalSignals, 'npc', npcId),
            input.canonicalConstraints,
          ),
          communications: input.brief.communications
            .filter((communication) => (
              communication.recipientIds.includes(npcId)
              && communication.intendedAudience.includes(npcId)
            ))
            .map((communication) => ({
              ...communication,
              prerequisiteEventId: `event.message_delivered.${communication.id}`,
            })),
        },
      ]),
    ),
    environmentSpecialist: specialistProjection(
      metadata,
      projectionFromFacts('environment', publicFacts),
      signalsFor(input.conditionalSignals, 'environment', 'environment'),
      input.canonicalConstraints,
    ),
    clueSpecialist: specialistProjection(
      metadata,
      input.knowledge.player,
      signalsFor(input.conditionalSignals, 'clue', 'clue'),
      input.canonicalConstraints,
    ),
    recommendationSpecialist: specialistProjection(
      metadata,
      input.knowledge.player,
      signalsFor(input.conditionalSignals, 'recommendation', 'recommendation'),
      input.canonicalConstraints,
    ),
  };
}

function projectMetadata(brief: TurnBrief): ProjectedTurnMetadata {
  return {
    loopId: brief.loopId,
    turnId: brief.turnId,
    inputStateVersion: brief.inputStateVersion,
    deadlineAt: brief.deadlineAt,
    compilerVersion: brief.compilerVersion,
    schemaVersion: brief.schemaVersion,
  };
}

function specialistProjection(
  metadata: ProjectedTurnMetadata,
  projection: FactProjection,
  conditionalSignals: ConditionalIntentSignal[],
  canonicalConstraints: string[],
): SpecialistProjection {
  return {
    ...metadata,
    facts: projection.facts,
    factIds: projection.factIds,
    canonicalConstraints: [...canonicalConstraints],
    conditionalSignals,
  };
}

function projectionFromFacts(viewerId: string, facts: Fact[]): FactProjection {
  return { viewerId, facts, factIds: facts.map((fact) => fact.id) };
}

function capabilityOperations(facts: Fact[], actorId: string): string[] {
  return [...new Set(facts.flatMap((fact) => (
    fact.subject === actorId
    && fact.predicate === 'capability'
    && typeof fact.value === 'string'
      ? [fact.value]
      : []
  )))];
}

function signalsFor(
  signals: ConditionalIntentSignal[],
  domain: ProposalDomain,
  viewerId: string,
): ConditionalIntentSignal[] {
  return signals
    .filter((signal) => (
      signal.domain === domain
      && (signal.visibleTo.includes(viewerId) || signal.visibleTo.includes('public'))
      && signal.prerequisiteEventIds.length > 0
    ))
    .map((signal) => ({
      id: signal.id,
      domain: signal.domain,
      visibleTo: [...signal.visibleTo],
      prerequisiteEventIds: [...signal.prerequisiteEventIds],
      signalType: signal.signalType,
      subjectId: signal.subjectId,
      scope: signal.scope,
      candidateHandleIds: signal.candidateHandleIds ? [...signal.candidateHandleIds] : undefined,
    }));
}
