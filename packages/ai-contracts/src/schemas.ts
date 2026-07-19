import { z } from 'zod';

export const ActionIntentValues = [
  'inspect',
  'preserve_evidence',
  'communicate',
  'deceive',
  'record',
  'secure_entry',
  'hide_evidence',
  'call_police',
  'verify_identity',
  'escape',
  'open_door',
  'self_care',
  'wait',
  'attack',
  'pick_up',
  'use_item',
] as const;

export const ActionRiskValues = ['low', 'medium', 'high'] as const;

export const KillerStrategyTypeValues = [
  'phone_probe',
  'soft_knock',
  'landlord_excuse',
  'fake_police',
  'spare_key_entry',
  'window_route',
  'direct_confrontation',
  'framing_pressure',
  'power_cut',
  'lure_linyue',
  'fake_neighbor',
  'fake_callback',
  'message_reply',
  'wait_for_fatigue',
  'retreat',
] as const;

export const RuleEventKindValues = ['action', 'clue', 'state_change', 'sound', 'message', 'threat', 'ending'] as const;
export const RuleEventVisibilityValues = ['player', 'killer', 'hidden'] as const;
export const AgentNameValues = ['parser', 'rule', 'killer', 'narrator', 'director', 'npc', 'ui-adapter', 'sidebar'] as const;
export const AgentModeValues = ['ai', 'fallback'] as const;
export const EndingIdValues = ['death', 'escaped_no_evidence', 'escaped_with_evidence'] as const;
export const EndingReasonValues = [
  'deadline_murder',
  'forced_entry',
  'window_route',
  'ambient_pressure',
  'killer_dead_with_evidence',
  'killer_dead_no_evidence',
  'deadline_survived_with_evidence',
  'police_arrived_with_evidence',
  'police_arrived_without_evidence',
  'escaped_without_evidence',
  'unknown',
] as const;

export const ActionIntentSchema = z.enum(ActionIntentValues);
export const ActionTargetSchema = z.string().min(1);
export const EndingIdSchema = z.enum(EndingIdValues);
export const EndingReasonSchema = z.enum(EndingReasonValues);

export const ParsedActionSchema = z.object({
  id: z.string(),
  raw: z.string(),
  intent: ActionIntentSchema,
  target: ActionTargetSchema,
  method: z.string().optional(),
  confidence: z.number().min(0).max(1),
  timeCost: z.number().min(1).max(5),
  noise: z.number().min(0).max(10),
  risk: z.enum(ActionRiskValues),
}).passthrough();

export const ActionPlanSchema = z.object({
  id: z.string(),
  raw: z.string(),
  summary: z.string(),
  actions: z.array(ParsedActionSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const KillerStrategySchema = z.object({
  id: z.string(),
  type: z.enum(KillerStrategyTypeValues),
  title: z.string(),
  rationale: z.string(),
  responseHint: z.string().optional(),
  visibleToPlayer: z.boolean(),
  risk: z.enum(ActionRiskValues),
});

export const RuleEventSchema = z.object({
  kind: z.enum(RuleEventKindValues),
  subject: z.string(),
  summary: z.string(),
  sensoryHints: z.array(z.string()),
  visibility: z.enum(RuleEventVisibilityValues),
});

export const ClueRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  source: z.enum(['ai_generated', 'static_fallback', 'player_discovered']),
  weight: z.number(),
  discoveredAt: z.object({ run: z.number(), minute: z.number() }),
  isPersistent: z.boolean(),
});

export const GameStateContractSchema = z.object({
  run: z.number(),
  minute: z.number(),
  phase: z.string(),
  killerPhase: z.string(),
  killerStatus: z.string(),
  policePhase: z.string(),
  linYuePhase: z.string(),
  evidencePhase: z.string(),
  threat: z.number(),
  suspicion: z.number(),
  player: z.object({
    injury: z.string(),
    stress: z.number(),
    hidden: z.boolean(),
  }),
  playerHolding: z.string().nullable(),
  combatTriggered: z.boolean(),
  clues: z.array(ClueRecordSchema),
  room: z.record(z.string(), z.unknown()),
  killerKnowledge: z.record(z.string(), z.unknown()),
  memory: z.unknown(),
  log: z.array(z.unknown()),
  ending: EndingIdSchema.nullable(),
  endingReason: EndingReasonSchema.nullable(),
  score: z.unknown().nullable(),
  phoneBattery: z.number(),
  phoneFunctional: z.boolean(),
  reviveProtectionTurns: z.number().optional(),
  policeArrivalMinute: z.number().optional(),
});

export const RuleResultSchema = z.object({
  title: z.string(),
  text: z.string(),
  tone: z.enum(['neutral', 'memory', 'clue', 'threat', 'death', 'win', 'system']),
  addedClues: z.array(ClueRecordSchema),
  timePassed: z.number(),
  threatDelta: z.number(),
  events: z.array(RuleEventSchema),
  state: GameStateContractSchema,
});

export const ParserAgentInputSchema = z.object({
  input: z.string(),
  state: GameStateContractSchema,
});

export const RuleAgentInputSchema = z.union([
  z.object({
    plan: ActionPlanSchema,
    state: GameStateContractSchema,
  }),
  z.object({
    killerStrategy: KillerStrategySchema,
    playerResult: RuleResultSchema,
    state: GameStateContractSchema,
  }),
]);

export const KillerAgentInputSchema = z.object({
  killerContext: z.object({
    visibleState: z.object({
      minute: z.number(),
      phase: z.string(),
      threat: z.number(),
      killerPhase: z.string(),
      killerStatus: z.string(),
      ending: z.boolean(),
      policeActive: z.boolean(),
      policePhase: z.string(),
      linYuePhase: z.string(),
      knowledge: z.record(z.string(), z.unknown()),
      observedFactIds: z.array(z.string()),
      recentStrategyTypes: z.array(z.string()),
      recentKillerActions: z.array(z.object({ title: z.string(), text: z.string() })),
    }),
    planSummary: z.string().optional(),
    observableEvents: z.array(z.object({
      subject: z.string(),
      summary: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      source: z.enum(['rule_event', 'state_projection', 'inference']),
    })),
    recentKillerMemory: z.array(z.string()),
    worldInfo: z.array(z.unknown()),
    uncertainty: z.array(z.string()),
  }).strict(),
}).strict();

export const NarrationContextSchema = z.object({
  run: z.number(),
  minute: z.number(),
  turnIndex: z.number(),
  playerActionSummary: z.string(),
  events: z.array(RuleEventSchema),
  confirmedFacts: z.array(z.object({
    id: z.string(),
    origin: z.enum(['player', 'killer', 'world', 'rule']),
    type: z.string(),
    subject: z.string(),
    summary: z.string(),
    facts: z.array(z.string()),
    visibility: z.enum(['player', 'public']),
    causationId: z.string().optional(),
  }).strict()),
  confirmedTitles: z.object({ action: z.string(), ambient: z.string() }).strict(),
  stateSnapshot: z.object({
    phase: z.string(),
    killerPhase: z.string(),
    killerStatus: z.string(),
    policePhase: z.string(),
    linYuePhase: z.string(),
    evidencePhase: z.string(),
    threat: z.number(),
    suspicion: z.number(),
    injury: z.string(),
    stress: z.number(),
    clues: z.array(ClueRecordSchema),
    ending: EndingIdSchema.nullable(),
    endingReason: EndingReasonSchema.nullable().optional(),
    phoneBattery: z.number().optional(),
    phoneFunctional: z.boolean().optional(),
    playerHolding: z.string().nullable().optional(),
    combatTriggered: z.boolean().optional(),
  }),
  knownClueTitles: z.array(z.string()).optional(),
  combatContext: z.object({
    playerWeapon: z.string().nullable(),
    killerArmed: z.boolean(),
    advantage: z.enum(['player', 'killer', 'mutual']),
  }).optional(),
  plotPhase: z.string().optional(),
  playerSituation: z.string().optional(),
  confirmedWorldEvents: z.array(z.object({
    id: z.string(),
    minute: z.number(),
    type: z.string(),
    actors: z.array(z.string()),
    location: z.string().optional(),
    facts: z.array(z.string()),
    visibility: z.enum(['player', 'public']),
    narrationHint: z.string().optional(),
  }).strict()).optional(),
  forbiddenFacts: z.array(z.string()),
  styleGuide: z.array(z.string()),
}).strict();

export const NarratorAgentInputSchema = z.object({
  narrationContext: NarrationContextSchema,
}).strict();

export const NpcReplySchema = z.object({
  speaker: z.enum(['linyue', 'police_dispatch', 'chen_huaimin']),
  text: z.string().min(1).max(800),
  intent: z.string(),
  riskWarning: z.string(),
  suggestedExternalAction: z.string(),
});

export const NarrationSchema = z.object({
  title: z.string().min(1).max(24),
  text: z.string().min(1).max(1200),
  ending: EndingIdSchema.optional(),
  isFatal: z.boolean().optional(),
  killerKilled: z.boolean().optional(),
  clue: z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string(),
    weight: z.number().min(1).max(20),
  }).optional(),
});

export const NarrationPairSchema = z.object({
  actionNarration: NarrationSchema,
  ambientNarration: NarrationSchema,
});

export const DirectorAgentInputSchema = z.object({
  directorContext: z.object({
    stateSummary: z.object({
      run: z.number(),
      minute: z.number(),
      phase: z.string(),
      ending: EndingIdSchema.nullable(),
      endingReason: EndingReasonSchema.nullable().optional(),
      threat: z.number(),
      suspicion: z.number(),
    }).strict(),
    narration: NarrationSchema,
    actionNarration: NarrationSchema,
    ambientNarration: NarrationSchema,
    playerEvents: z.array(RuleEventSchema),
    killerEvents: z.array(RuleEventSchema),
    traceSummary: z.array(z.object({
      agent: z.string(),
      eventType: z.string(),
      mode: z.string(),
      valid: z.boolean(),
      errors: z.array(z.string()),
      durationMs: z.number().optional(),
    }).strict()),
    worldInfo: z.array(z.unknown()),
    consistencyChecklist: z.array(z.string()),
  }).strict(),
  narrationContext: NarrationContextSchema,
}).strict();

export const DirectorOutputSchema = z.object({
  score: z.object({
    pacing: z.number().min(0).max(10),
    infoLeak: z.number().min(0).max(10),
    ruleConsistency: z.number().min(0).max(10),
    prose: z.number().min(0).max(10),
  }),
  passed: z.boolean(),
  violations: z.array(z.string()),
}).strict();

export const ScoreRecapSchema = z.object({
  total: z.number().min(0).max(100),
  rank: z.enum(['S', 'A', 'B', 'C', 'D', 'F']),
  survival: z.number().min(0).max(20),
  truth: z.number().min(0).max(20),
  evidence: z.number().min(0).max(20),
  npc: z.number().min(0).max(15),
  injury: z.number().min(0).max(10),
  riskControl: z.number().min(0).max(15),
  notes: z.array(z.string()),
});

export const AgentTraceWorldInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(['derived', 'manual', 'unknown']),
  priority: z.number(),
});

export const AgentTraceEntrySchema = z.object({
  agent: z.enum(AgentNameValues),
  eventType: z.string(),
  mode: z.enum(AgentModeValues),
  input: z.unknown(),
  output: z.unknown(),
  worldInfo: z.array(AgentTraceWorldInfoSchema).optional(),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  durationMs: z.number().optional(),
  timestamp: z.string().optional(),
});

export type ActionIntentContract = z.infer<typeof ActionIntentSchema>;
export type ParsedActionContract = z.infer<typeof ParsedActionSchema>;
export type ActionPlanContract = z.infer<typeof ActionPlanSchema>;
export type KillerStrategyTypeContract = z.infer<typeof KillerStrategySchema>['type'];
export type KillerStrategyContract = z.infer<typeof KillerStrategySchema>;
export type RuleEventContract = z.infer<typeof RuleEventSchema>;
export type RuleResultContract = z.infer<typeof RuleResultSchema>;
export type NarrationContextContract = z.infer<typeof NarrationContextSchema>;
export type NpcReplyContract = z.infer<typeof NpcReplySchema>;
export type NarrationContract = z.infer<typeof NarrationSchema>;
export type NarrationPairContract = z.infer<typeof NarrationPairSchema>;
export type DirectorOutputContract = z.infer<typeof DirectorOutputSchema>;
export type ScoreRecapContract = z.infer<typeof ScoreRecapSchema>;
export type AgentTraceWorldInfoContract = z.infer<typeof AgentTraceWorldInfoSchema>;
export type AgentNameContract = z.infer<typeof AgentTraceEntrySchema>['agent'];
export type AgentModeContract = z.infer<typeof AgentTraceEntrySchema>['mode'];
export type AgentTraceEntryContract = z.infer<typeof AgentTraceEntrySchema>;
