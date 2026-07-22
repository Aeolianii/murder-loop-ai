import { z } from 'zod';

const IdSchema = z.string().min(1);
const StateVersionSchema = z.number().int().nonnegative();
export const WORLD_MODEL_SCHEMA_VERSION = 'world-model-v3';
const JsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const RiskClassValues = ['reversible', 'high_impact', 'irreversible'] as const;
export const EventKindValues = [
  'action',
  'state_transition',
  'information_transfer',
  'observation',
  'timer',
  'ending',
] as const;
export const EventStatusValues = ['attempted', 'completed', 'blocked', 'failed'] as const;
export const ProposalDomainValues = [
  'player',
  'killer',
  'npc',
  'environment',
  'clue',
  'recommendation',
  'world',
] as const;

export const TurnEnvelopeSchema = z.object({
  loopId: IdSchema,
  turnId: IdSchema,
  inputStateVersion: StateVersionSchema,
  deadlineAt: z.string().datetime({ offset: true }),
}).strict();

export const FactSchema = z.object({
  id: IdSchema,
  subject: IdSchema,
  predicate: IdSchema,
  value: JsonValueSchema,
  sourceEventId: IdSchema,
  visibleTo: z.array(IdSchema),
  knownBy: z.array(IdSchema),
  validFromTurn: IdSchema,
  invalidatedBy: IdSchema.nullable().optional(),
}).strict();

export const SourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
}).strict().refine((span) => span.end >= span.start, {
  message: 'end must be greater than or equal to start',
  path: ['end'],
});

export const ResolvedReferenceSchema = z.object({
  referenceId: IdSchema,
  originalSpan: SourceSpanSchema,
  entityIds: z.array(IdSchema).min(1),
  confidence: z.number().min(0).max(1),
}).strict();

export const OrderedActionSchema = z.object({
  actionId: IdSchema,
  actorId: IdSchema,
  operation: IdSchema,
  targetIds: z.array(IdSchema),
  scope: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  dependsOnActionIds: z.array(IdSchema),
  inputHandleIds: z.array(IdSchema),
  outputHandleIds: z.array(IdSchema),
  originalSpan: SourceSpanSchema,
  stealthIntent: z.boolean().optional(),
  intendedAudience: z.array(IdSchema).optional(),
  desiredOutcome: z.string().min(1).optional(),
}).strict();

export const IntentConstraintSchema = z.object({
  id: IdSchema,
  type: z.enum(['must_not', 'scope_only', 'conditional', 'sequence', 'visibility']),
  actionIds: z.array(IdSchema),
  value: JsonValueSchema,
  originalSpan: SourceSpanSchema,
}).strict();

export const CommunicationIntentSchema = z.object({
  id: IdSchema,
  actionId: IdSchema,
  senderId: IdSchema,
  recipientIds: z.array(IdSchema).min(1),
  channel: IdSchema,
  contentSummary: z.string().min(1),
  attachmentHandleIds: z.array(IdSchema),
  intendedAudience: z.array(IdSchema),
}).strict();

export const CandidateHandleSchema = z.object({
  id: IdSchema,
  kind: IdSchema,
  producedByActionId: IdSchema,
  dependsOnActionIds: z.array(IdSchema),
}).strict();

export const TurnAmbiguitySchema = z.object({
  id: IdSchema,
  originalSpan: SourceSpanSchema,
  description: z.string().min(1),
  impact: z.enum(['state', 'display', 'low']),
  requiresClarification: z.boolean(),
}).strict();

export const TurnBriefSchema = TurnEnvelopeSchema.extend({
  compilerVersion: IdSchema,
  schemaVersion: IdSchema,
  utteranceMode: z.enum(['command', 'question', 'hypothetical', 'mixed', 'clarification_required', 'non_action']),
  resolvedReferences: z.array(ResolvedReferenceSchema),
  orderedActions: z.array(OrderedActionSchema),
  globalConstraints: z.array(IntentConstraintSchema),
  scopedConstraints: z.array(IntentConstraintSchema),
  communications: z.array(CommunicationIntentSchema),
  candidateHandles: z.array(CandidateHandleSchema),
  ambiguities: z.array(TurnAmbiguitySchema),
}).strict();

export const CompactPlayerContextSchema = z.object({
  facts: z.array(FactSchema),
  accessibleEntityIds: z.array(IdSchema),
  capabilities: z.array(IdSchema),
  activeCommunicationActorIds: z.array(IdSchema),
  recentConfirmedEventIds: z.array(IdSchema),
  entityAliasIndex: z.record(z.string(), z.array(IdSchema)),
  recentReferenceCandidates: z.array(z.object({
    originalText: z.string().min(1),
    entityIds: z.array(IdSchema).min(1),
  }).strict()),
  phaseSummary: z.string(),
}).strict();

export const SemanticCompilerRequestSchema = TurnEnvelopeSchema.extend({
  rawInput: z.string().min(1),
  playerContext: CompactPlayerContextSchema,
}).strict();

export const SemanticCompilerResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('compiled'),
    brief: TurnBriefSchema,
  }).strict(),
  TurnEnvelopeSchema.extend({
    status: z.literal('clarification_required'),
    compilerVersion: IdSchema,
    schemaVersion: IdSchema,
    questions: z.array(z.string().min(1)).min(1),
    ambiguities: z.array(TurnAmbiguitySchema).min(1),
  }).strict(),
  TurnEnvelopeSchema.extend({
    status: z.literal('fallback_to_world_model'),
    compilerVersion: IdSchema,
    schemaVersion: IdSchema,
    reasonCode: IdSchema,
  }).strict(),
]);

export const ProposalPreconditionSchema = z.object({
  id: IdSchema,
  kind: z.enum(['fact', 'event', 'capability', 'invariant']),
  ref: IdSchema,
  expected: JsonValueSchema.optional(),
}).strict();

export const ProposedEffectSchema = z.object({
  id: IdSchema,
  targetType: IdSchema,
  targetId: IdSchema,
  operation: IdSchema,
  path: z.string().min(1),
  value: JsonValueSchema,
  causalParentIds: z.array(IdSchema),
}).strict();

export const ProposedObservationSchema = z.object({
  id: IdSchema,
  subject: IdSchema,
  predicate: IdSchema,
  value: JsonValueSchema,
  scope: z.string().min(1),
  basedOnEffectIds: z.array(IdSchema),
  basedOnEventIds: z.array(IdSchema).min(1),
  visibleAssertionIds: z.array(IdSchema).min(1),
}).strict();

export const ProposedAssertionSchema = z.object({
  id: IdSchema,
  subject: IdSchema,
  predicate: IdSchema,
  value: JsonValueSchema,
  visibleTo: z.array(IdSchema),
}).strict();

export const ProposedEventSchema = z.object({
  id: IdSchema,
  kind: z.enum(EventKindValues),
  sourceActionIds: z.array(IdSchema),
  actorId: IdSchema,
  operation: IdSchema,
  targetIds: z.array(IdSchema),
  status: z.enum(EventStatusValues),
  summary: z.string().min(1),
  assertions: z.array(ProposedAssertionSchema),
  visibility: z.array(IdSchema),
  riskClass: z.enum(RiskClassValues),
  evidenceRefs: z.array(IdSchema),
  causalParentIds: z.array(IdSchema),
}).strict();

export const ClueCandidateSchema = z.object({
  id: IdSchema,
  // Proposal-local assertion IDs exposed by basedOnObservationIds.
  claimAssertionIds: z.array(IdSchema).min(1),
  basedOnObservationIds: z.array(IdSchema).min(1),
  visibleAssertionIds: z.array(IdSchema),
  confidence: z.number().min(0).max(1),
}).strict();

export const RecommendationCandidateSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  rationale: z.string().min(1),
  basedOnFactIds: z.array(IdSchema),
  basedOnEventIds: z.array(IdSchema),
}).strict().refine((recommendation) => (
  recommendation.basedOnFactIds.length > 0
  || recommendation.basedOnEventIds.length > 0
), {
  message: 'A recommendation requires at least one fact or event source.',
  path: ['basedOnFactIds'],
});

export const DisplayFragmentSchema = z.object({
  id: IdSchema,
  text: z.string().min(1),
  eventRefs: z.array(IdSchema),
  claimRefs: z.array(IdSchema),
}).strict();

export const ProposalSchema = TurnEnvelopeSchema.extend({
  id: IdSchema,
  compilerVersion: IdSchema,
  schemaVersion: IdSchema,
  sourceAgent: IdSchema,
  domain: z.enum(ProposalDomainValues),
  candidateRank: z.number().int().nonnegative(),
  turnBriefActionIds: z.array(IdSchema),
  replacementFor: z.array(IdSchema),
  actorId: IdSchema,
  operation: IdSchema,
  targetIds: z.array(IdSchema),
  basedOnFactIds: z.array(IdSchema),
  preconditions: z.array(ProposalPreconditionSchema),
  forbiddenScopes: z.array(z.string().min(1)),
  proposedEffects: z.array(ProposedEffectSchema),
  observations: z.array(ProposedObservationSchema),
  visibility: z.array(IdSchema),
  confidence: z.number().min(0).max(1),
  riskClass: z.enum(RiskClassValues),
  evidenceRefs: z.array(IdSchema),
  causalParentIds: z.array(IdSchema),
  proposedEvents: z.array(ProposedEventSchema),
  clueCandidates: z.array(ClueCandidateSchema),
  recommendations: z.array(RecommendationCandidateSchema),
  displayFragments: z.array(DisplayFragmentSchema),
}).strict();

export const SpecialistCandidateSchema = ProposalSchema.extend({
  candidateType: z.literal('specialist'),
  specialistId: IdSchema,
}).strict();

export const RejectedEffectSchema = z.object({
  effectId: IdSchema,
  proposalId: IdSchema,
  reasonCodes: z.array(IdSchema).min(1),
}).strict();

export const ArbiterViolationSchema = z.object({
  code: IdSchema,
  subjectId: IdSchema,
  detail: z.string().min(1),
}).strict();

export const StateTransitionResultSchema = TurnEnvelopeSchema.extend({
  acceptedEvents: z.array(ProposedEventSchema),
  correctedEvents: z.array(ProposedEventSchema),
  rejectedEffects: z.array(RejectedEffectSchema),
  violations: z.array(ArbiterViolationSchema),
  selectedSourceByDomain: z.record(z.string(), IdSchema),
  specialistCandidatesTried: z.array(IdSchema),
  fallbackDomains: z.array(z.enum(ProposalDomainValues)),
  requiresRepair: z.boolean(),
  requiresPlayerClarification: z.boolean(),
  expectedOutputStateVersion: StateVersionSchema,
}).strict().superRefine((result, context) => {
  if (result.expectedOutputStateVersion <= result.inputStateVersion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedOutputStateVersion'],
      message: 'The expected output version must advance beyond the input version.',
    });
  }
});

export const HighRiskDecisionSchema = z.object({
  eventId: IdSchema,
  riskClass: z.enum(RiskClassValues),
  evidenceRefs: z.array(IdSchema),
  decision: z.enum(['pass', 'defer', 'reject']),
  reasonCodes: z.array(IdSchema),
}).strict().superRefine((result, context) => {
  if (
    result.decision === 'pass'
    && result.riskClass !== 'reversible'
    && result.evidenceRefs.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: 'A passed high-risk event requires independent deterministic evidence.',
    });
  }
});

export const TurnCommitResultSchema = z.object({
  loopId: IdSchema,
  turnId: IdSchema,
  inputStateVersion: StateVersionSchema,
  outputStateVersion: StateVersionSchema.nullable(),
  commitStatus: z.enum(['committed', 'conflict', 'failed']),
  confirmedEventIds: z.array(IdSchema),
}).strict().superRefine((result, context) => {
  if (result.commitStatus === 'committed' && result.outputStateVersion === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputStateVersion'],
      message: 'A committed turn requires an output state version.',
    });
  }
  if (
    result.commitStatus === 'committed'
    && result.outputStateVersion !== null
    && result.outputStateVersion <= result.inputStateVersion
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputStateVersion'],
      message: 'A committed turn must advance the state version.',
    });
  }
  if (result.commitStatus !== 'committed' && result.outputStateVersion !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputStateVersion'],
      message: 'A non-committed turn cannot publish an output state version.',
    });
  }
  if (result.commitStatus !== 'committed' && result.confirmedEventIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmedEventIds'],
      message: 'A non-committed turn cannot confirm events.',
    });
  }
});

export const ConfirmedEventSchema = ProposedEventSchema.extend({
  loopId: IdSchema,
  turnId: IdSchema,
  inputStateVersion: StateVersionSchema,
  outputStateVersion: StateVersionSchema,
  sourceProposalId: IdSchema,
  confirmedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((event, context) => {
  if (event.outputStateVersion <= event.inputStateVersion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputStateVersion'],
      message: 'A confirmed event must advance the state version.',
    });
  }
});

export type TurnEnvelope = z.infer<typeof TurnEnvelopeSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type TurnBrief = z.infer<typeof TurnBriefSchema>;
export type CompactPlayerContext = z.infer<typeof CompactPlayerContextSchema>;
export type SemanticCompilerRequest = z.infer<typeof SemanticCompilerRequestSchema>;
export type SemanticCompilerResult = z.infer<typeof SemanticCompilerResultSchema>;
export type OrderedAction = z.infer<typeof OrderedActionSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type SpecialistCandidate = z.infer<typeof SpecialistCandidateSchema>;
export type ProposedAssertion = z.infer<typeof ProposedAssertionSchema>;
export type ProposedEvent = z.infer<typeof ProposedEventSchema>;
export type DisplayFragment = z.infer<typeof DisplayFragmentSchema>;
export type StateTransitionResult = z.infer<typeof StateTransitionResultSchema>;
export type HighRiskDecision = z.infer<typeof HighRiskDecisionSchema>;
export type TurnCommitResult = z.infer<typeof TurnCommitResultSchema>;
export type ConfirmedEvent = z.infer<typeof ConfirmedEventSchema>;
export type ProposalDomain = z.infer<typeof ProposalSchema>['domain'];
export type RiskClass = z.infer<typeof HighRiskDecisionSchema>['riskClass'];
