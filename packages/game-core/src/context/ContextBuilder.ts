import type {
  ActionPlan,
  GameState,
  Narration,
  NarrationContext,
  RuleEvent,
  RuleResult,
} from '@murder-loop-ai/shared';
import type { AgentTraceEntryContract } from '@murder-loop-ai/ai-contracts';
import { projectKillerVisibleState } from '../killer/knowledge';
import { buildNarrationContext } from '../narration/buildNarrationContext';
import { buildVisibleMemoryForAgent, normalizeLoopMemory } from '../memory/loopMemory';

export interface ParserContext {
  input: string;
  stateSummary: {
    run: number;
    minute: number;
    phase: GameState['phase'];
    threat: number;
    suspicion: number;
    playerHolding: string | null;
    phoneFunctional: boolean;
    clueIds: string[];
  };
  recentMemory: string[];
}

export interface KillerObservableEvent {
  subject: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'rule_event' | 'state_projection' | 'inference';
}

export interface KillerContext {
  visibleState: ReturnType<typeof projectKillerVisibleState>;
  planSummary?: string;
  observableEvents: KillerObservableEvent[];
  recentKillerMemory: string[];
  uncertainty: string[];
}

export interface DirectorTraceSummary {
  agent: string;
  eventType: string;
  mode: string;
  valid: boolean;
  errors: string[];
  durationMs?: number;
}

export interface DirectorContext {
  stateSummary: {
    run: number;
    minute: number;
    phase: GameState['phase'];
    ending: GameState['ending'];
    threat: number;
    suspicion: number;
  };
  narration: Narration;
  actionNarration: Narration;
  ambientNarration: Narration;
  playerEvents: RuleEvent[];
  killerEvents: RuleEvent[];
  traceSummary: DirectorTraceSummary[];
  consistencyChecklist: string[];
}

export function buildParserContext(input: string, state: GameState): ParserContext {
  const memory = normalizeLoopMemory(state.memory);
  return {
    input,
    stateSummary: {
      run: state.run,
      minute: state.minute,
      phase: state.phase,
      threat: state.threat,
      suspicion: state.suspicion,
      playerHolding: state.playerHolding,
      phoneFunctional: state.phoneFunctional,
      clueIds: state.clues.map((clue) => clue.id),
    },
    recentMemory: buildVisibleMemoryForAgent(memory, 'parser').slice(-3),
  };
}

export function buildKillerContext(
  state: GameState,
  input: { plan?: ActionPlan; playerResult?: RuleResult } = {},
): KillerContext {
  const observableEvents = (input.playerResult?.events ?? [])
    .filter((event) => event.visibility === 'killer')
    .map(toObservableEvent);
  const hiddenCount = (input.playerResult?.events ?? []).filter((event) => event.visibility === 'hidden').length;

  return {
    visibleState: projectKillerVisibleState(state),
    planSummary: input.plan?.summary,
    observableEvents,
    recentKillerMemory: buildVisibleMemoryForAgent(normalizeLoopMemory(state.memory), 'killer'),
    uncertainty: [
      'Killer only receives observable events and projected knowledge, not player private intent.',
      hiddenCount > 0
        ? `Killer does not receive hidden player facts (${hiddenCount} hidden event${hiddenCount === 1 ? '' : 's'} withheld).`
        : 'No hidden player facts were exposed to Killer.',
    ],
  };
}

export function buildNarratorContext(input: {
  state: GameState;
  playerResult: RuleResult;
  killerResult: RuleResult;
  playerActionSummary: string;
  playerInput?: string;
}): NarrationContext {
  const context = buildNarrationContext(
    input.playerResult,
    input.killerResult,
    input.playerActionSummary,
    input.playerInput,
  );
  return {
    ...context,
    forbiddenFacts: [
      ...context.forbiddenFacts,
      'Narrator may use memorySummary for continuity but must not decide endings, deaths, arrests, or rule outcomes.',
    ],
  };
}

export function buildDirectorContext(input: {
  state: GameState;
  narration: Narration;
  actionNarration: Narration;
  ambientNarration: Narration;
  playerResult: RuleResult;
  killerResult: RuleResult;
  agentTrace?: AgentTraceEntryContract[];
}): DirectorContext {
  return {
    stateSummary: {
      run: input.state.run,
      minute: input.state.minute,
      phase: input.state.phase,
      ending: input.state.ending,
      threat: input.state.threat,
      suspicion: input.state.suspicion,
    },
    narration: input.narration,
    actionNarration: input.actionNarration,
    ambientNarration: input.ambientNarration,
    playerEvents: input.playerResult.events,
    killerEvents: input.killerResult.events,
    traceSummary: (input.agentTrace ?? []).map((entry) => ({
      agent: entry.agent,
      eventType: entry.eventType,
      mode: entry.mode,
      valid: entry.validation.valid,
      errors: entry.validation.errors,
      durationMs: entry.durationMs,
    })),
    consistencyChecklist: [
      'Narration must be grounded in rule results and confirmed events.',
      'Narration must not add endings, deaths, arrests, clues, rooms, or character arrivals not present in rule results.',
      'Agent trace errors or fallback usage should be considered when judging reliability.',
    ],
  };
}

function toObservableEvent(event: RuleEvent): KillerObservableEvent {
  return {
    subject: event.subject,
    summary: event.summary,
    confidence: event.sensoryHints.length > 0 ? 'high' : 'medium',
    source: 'rule_event',
  };
}
