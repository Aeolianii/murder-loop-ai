import type { z } from 'zod';
import {
  ActionPlanSchema,
  DirectorAgentInputSchema,
  DirectorOutputSchema,
  KillerAgentInputSchema,
  KillerStrategySchema,
  NarrationPairSchema,
  NarratorAgentInputSchema,
  ParserAgentInputSchema,
  RuleAgentInputSchema,
  RuleResultSchema,
} from './schemas';

export type AgentContractName = 'parser' | 'rule' | 'killer' | 'narrator' | 'director';

export interface AgentContractField {
  name: string;
  type: string;
  meaning: string;
  required: boolean;
  mutableByAgent: boolean;
}

export interface AgentContractSpec {
  agent: AgentContractName;
  responsibility: string;
  callTiming: string;
  inputFields: AgentContractField[];
  aiResponsibilities: string[];
  outputSchemaName: string;
  outputSchema: z.ZodTypeAny;
  forbidden: string[];
  validationAndFallback: string[];
}

export const parserAgentContract: AgentContractSpec = {
  agent: 'parser',
  responsibility: 'Convert the player natural-language input into a structured ActionPlan for the rule layer.',
  callTiming: 'Primary handler for PlayerActionSubmitted, before any state mutation.',
  inputFields: [
    { name: 'input', type: 'string', meaning: 'Raw player input for this turn.', required: true, mutableByAgent: false },
    { name: 'state', type: 'GameState', meaning: 'Current world state snapshot used only as context.', required: true, mutableByAgent: false },
  ],
  aiResponsibilities: [
    'Identify one or more supported action intents from the player input.',
    'Extract target, method, confidence, suggested timeCost, suggested noise, and risk.',
    'Preserve player action order when the input contains multiple actions.',
    'Use warnings for ambiguity instead of inventing unsupported intents.',
  ],
  outputSchemaName: 'ActionPlanSchema',
  outputSchema: ActionPlanSchema,
  forbidden: [
    'Must not decide whether an action succeeds.',
    'Must not mutate GameState or imply a final state change.',
    'Must not create ActionIntent enum values outside ActionIntentValues.',
    'Must not directly trigger endings, deaths, arrests, escapes, or victory states.',
    'Must not invent objects, clues, rooms, or characters not represented by current state or known project content.',
  ],
  validationAndFallback: [
    'Invalid JSON, missing fields, illegal intent, or out-of-range numeric values reject the AI output.',
    'On rejection or timeout, ParserAgent fallbackParseAction produces an ActionPlan.',
    'The rule layer recalculates actual effects; Parser timeCost and noise remain parser suggestions.',
  ],
};

export const ruleAgentContract: AgentContractSpec = {
  agent: 'rule',
  responsibility: 'Apply deterministic game rules for parsed player actions and killer strategies.',
  callTiming: 'Primary handler for ActionParsed and KillerActed.',
  inputFields: [
    { name: 'plan', type: 'ActionPlan', meaning: 'Parsed player action plan, only for ActionParsed.', required: false, mutableByAgent: false },
    { name: 'killerStrategy', type: 'KillerStrategy', meaning: 'Chosen killer strategy, only for KillerActed.', required: false, mutableByAgent: false },
    { name: 'playerResult', type: 'RuleResult', meaning: 'Resolved player action result, only for KillerActed.', required: false, mutableByAgent: false },
    { name: 'state', type: 'GameState', meaning: 'Current world state that rule code clones and resolves.', required: true, mutableByAgent: false },
  ],
  aiResponsibilities: [
    'None in the current implementation; RuleAgent is deterministic code.',
    'If an AI-assisted rule analysis is added later, it may only propose explanations, never execute state changes.',
  ],
  outputSchemaName: 'RuleResultSchema',
  outputSchema: RuleResultSchema,
  forbidden: [
    'Must not bypass object existence, location, time, item, or precondition checks.',
    'Must not accept natural-language narration as a state mutation.',
    'Must not delegate final rule execution to an AI result.',
    'Must not add or redesign ending trigger logic in this contract layer.',
  ],
  validationAndFallback: [
    'Rule input/output is validated like other agents even though the implementation is deterministic.',
    'Malformed deterministic output is fatal for the turn because there is no safer AI fallback.',
    'Invalid killer strategy input is rejected before applyKillerStrategy runs.',
  ],
};

export const killerAgentContract: AgentContractSpec = {
  agent: 'killer',
  responsibility: 'Choose Chen Huaimin strategy based on visible state, player result, and limited killer knowledge.',
  callTiming: 'Primary handler for RulesApplied, after player actions are resolved.',
  inputFields: [
    { name: 'playerResult', type: 'RuleResult', meaning: 'Confirmed player action result from RuleAgent.', required: true, mutableByAgent: false },
    { name: 'state', type: 'GameState', meaning: 'Current state; server prompts must project visible/allowed knowledge.', required: true, mutableByAgent: false },
    { name: 'plan', type: 'ActionPlan', meaning: 'Parsed player intent for context.', required: false, mutableByAgent: false },
  ],
  aiResponsibilities: [
    'Select one supported KillerStrategy type.',
    'Explain rationale using only visible state, playerResult events, and supplied context.',
    'Provide responseHint only for communication-style strategies.',
    'Estimate risk as low, medium, or high.',
  ],
  outputSchemaName: 'KillerStrategySchema',
  outputSchema: KillerStrategySchema,
  forbidden: [
    'Must not read hidden player actions or evidence locations not supplied by code.',
    'Must not directly mutate player, NPC, room, or killerStatus state.',
    'Must not decide player death, killer escape/arrest/death, or any ending.',
    'Must not create strategy enum values outside KillerStrategyTypeValues.',
    'Must not treat suspicion as omniscient knowledge.',
  ],
  validationAndFallback: [
    'Invalid strategy enum, malformed JSON, or contradictory schema output rejects the AI strategy.',
    'On rejection or timeout, chooseFallbackKillerStrategy supplies a deterministic strategy.',
    'RuleAgent validates and applies the chosen strategy; KillerAgent output is not state execution.',
  ],
};

export const narratorAgentContract: AgentContractSpec = {
  agent: 'narrator',
  responsibility: 'Turn confirmed rule results into player-facing action and ambient narration.',
  callTiming: 'Primary handler for NarrationRequested, after player and killer rule results exist.',
  inputFields: [
    { name: 'plan', type: 'ActionPlan', meaning: 'Parsed player action plan.', required: true, mutableByAgent: false },
    { name: 'playerResult', type: 'RuleResult', meaning: 'Confirmed player action result.', required: true, mutableByAgent: false },
    { name: 'killerResult', type: 'RuleResult', meaning: 'Confirmed killer/environment result.', required: true, mutableByAgent: false },
    { name: 'state', type: 'GameState', meaning: 'Current resolved state snapshot.', required: true, mutableByAgent: false },
    { name: 'narrationContext', type: 'NarrationContext', meaning: 'Formatted context and forbidden facts.', required: false, mutableByAgent: false },
  ],
  aiResponsibilities: [
    'Write actionNarration for confirmed player action results.',
    'Write ambientNarration for confirmed external pressure and environment results.',
    'Keep prose consistent with RuleResult events and forbiddenFacts.',
    'Optionally propose clue/ending-related fields only as schema fields; code decides whether to accept them.',
  ],
  outputSchemaName: 'NarrationPairSchema',
  outputSchema: NarrationPairSchema,
  forbidden: [
    'Must not describe failed or impossible actions as successful.',
    'Must not add key events, clues, items, characters, deaths, arrests, escapes, or endings that rule results did not confirm.',
    'Must not leak facts the player has not learned.',
    'Must not mutate state or decide subsequent state.',
    'Must not use prose as a substitute for rule execution.',
  ],
  validationAndFallback: [
    'Invalid narration JSON or text length violations reject the AI narration pair.',
    'On rejection or timeout, local fallback narration is generated from RuleResult.',
    'Any ending/isFatal/killerKilled fields remain proposals and do not directly trigger endings in this task.',
  ],
};

export const directorAgentContract: AgentContractSpec = {
  agent: 'director',
  responsibility: 'Asynchronously critique completed narration without participating in the playable turn path.',
  callTiming: 'Deferred reviewer for NarrationCritiqueRequested after the narration has already been accepted.',
  inputFields: [
    { name: 'directorContext', type: 'DirectorContext', meaning: 'Read-only projected state, events, narration, and trace summary.', required: true, mutableByAgent: false },
    { name: 'narrationContext', type: 'NarrationContext', meaning: 'Confirmed facts used by the narrator.', required: true, mutableByAgent: false },
  ],
  aiResponsibilities: [
    'Score pacing, information leakage, rule consistency, and prose quality.',
    'Return violations for diagnostics and future tuning only.',
  ],
  outputSchemaName: 'DirectorOutputSchema',
  outputSchema: DirectorOutputSchema,
  forbidden: [
    'Must not bypass RuleAgent or deterministic code.',
    'Must not mutate confirmed state.',
    'Must not invent key clues, objects, characters, or scene facts.',
    'Must not design, judge, or trigger any ending in this task.',
    'Must not convert suggestions into executable state changes.',
  ],
  validationAndFallback: [
    'Invalid score ranges, missing fields, or malformed JSON reject the AI review.',
    'On rejection or timeout, DirectorAgent fallback returns a conservative diagnostic review.',
    'Critic output is advisory and must not change narration, state, UI, or normal turn logic.',
  ],
};

export const agentContractSpecs = {
  parser: parserAgentContract,
  rule: ruleAgentContract,
  killer: killerAgentContract,
  narrator: narratorAgentContract,
  director: directorAgentContract,
} as const;

export const agentInputSchemas = {
  parser: ParserAgentInputSchema,
  rule: RuleAgentInputSchema,
  killer: KillerAgentInputSchema,
  narrator: NarratorAgentInputSchema,
  director: DirectorAgentInputSchema,
} as const;

export const agentOutputSchemas = {
  parser: ActionPlanSchema,
  rule: RuleResultSchema,
  killer: KillerStrategySchema,
  narrator: NarrationPairSchema,
  director: DirectorOutputSchema,
} as const;
