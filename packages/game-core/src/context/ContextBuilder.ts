import type {
  ActionPlan,
  GameState,
  Narration,
  NarrationContext,
  NpcReply,
  RuleEvent,
  RuleResult,
  WorldEvent,
} from '@murder-loop-ai/shared';
import type { AgentTraceEntryContract } from '@murder-loop-ai/ai-contracts';
import { selectWorldInfoCards, type WorldInfoCard } from '@murder-loop-ai/content';
import {
  projectKillerVisibleState,
  type KillerDecisionContext,
  type KillerObservableEvent,
} from '../killer/knowledge';
import { buildNarrationContext } from '../narration/buildNarrationContext';
import { buildVisibleMemoryForAgent, normalizeLoopMemory } from '../memory/loopMemory';
import { buildSubjectiveState } from '../world/npcCoordinator';
import { ensureWorldState } from '../world/syncGameWorld';
import { readWorldNarrationBatch } from '../world/narrationCursor';
import type { CharacterId } from '../world/worldTypes';

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
  worldInfo: WorldInfoCard[];
}

export interface KillerContext extends KillerDecisionContext {
  visibleState: ReturnType<typeof projectKillerVisibleState>;
  planSummary?: string;
  observableEvents: KillerObservableEvent[];
  recentKillerMemory: string[];
  worldInfo: WorldInfoCard[];
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
    endingReason: GameState['endingReason'];
    threat: number;
    suspicion: number;
  };
  narration: Narration;
  actionNarration: Narration;
  ambientNarration: Narration;
  playerEvents: RuleEvent[];
  killerEvents: RuleEvent[];
  traceSummary: DirectorTraceSummary[];
  worldInfo: WorldInfoCard[];
  consistencyChecklist: string[];
}

export interface NpcVisibleContext {
  speaker: NpcReply['speaker'];
  characterId: CharacterId;
  input: string;
  subjectiveState: ReturnType<typeof buildSubjectiveState>;
  knownFactIds: string[];
  receivedPlayerMessage: string;
  recentPublicEvents: Array<{
    type: string;
    facts: string[];
    minute: number;
  }>;
  canReference: {
    packagePhoto: boolean;
    doorActivity: boolean;
    policeReport: boolean;
    fakePoliceSuspicion: boolean;
  };
  forbiddenFacts: string[];
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
    worldInfo: selectWorldInfoCards({ agent: 'parser', input, state, limit: 6 }),
  };
}

export function buildKillerContext(
  state: GameState,
  input: { plan?: ActionPlan; playerResult?: RuleResult } = {},
): KillerContext {
  const observableEvents = (input.playerResult?.events ?? [])
    .filter((event) => event.visibility === 'killer')
    .map(toObservableEvent);
  const observableSummary = observableEvents.map((event) => event.summary).join(' | ');
  const hiddenCount = (input.playerResult?.events ?? []).filter((event) => event.visibility === 'hidden').length;
  const visibleRuleEvents = (input.playerResult?.events ?? []).filter((event) => event.visibility === 'killer');

  return {
    visibleState: projectKillerVisibleState(state),
    planSummary: observableSummary || undefined,
    observableEvents,
    recentKillerMemory: buildVisibleMemoryForAgent(normalizeLoopMemory(state.memory), 'killer'),
    worldInfo: selectWorldInfoCards({
      agent: 'killer',
      input: observableSummary || undefined,
      state,
      events: visibleRuleEvents,
      limit: 6,
    }),
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
  worldEvents?: WorldEvent[];
}): NarrationContext {
  const context = buildNarrationContext(
    input.playerResult,
    input.killerResult,
  );
  const cursorEvents = input.state.world
    ? readWorldNarrationBatch(input.state.world).events
    : [];
  const confirmedWorldEvents = (input.worldEvents ?? cursorEvents).filter(
    (event) => event.visibility === 'player' || event.visibility === 'public',
  );
  return {
    ...context,
    confirmedFacts: [
      ...context.confirmedFacts,
      ...confirmedWorldEvents.map((event) => ({
        id: event.id,
        origin: 'world' as const,
        type: `world_event:${event.type}`,
        subject: event.location ?? event.type,
        summary: event.narrationHint ?? event.facts.join(', '),
        facts: [...event.facts],
        visibility: event.visibility as 'player' | 'public',
      })),
    ],
    confirmedWorldEvents: confirmedWorldEvents.map((event) => ({
      id: event.id,
      minute: event.minute,
      type: event.type,
      actors: [...event.actors],
      location: event.location,
      facts: [...event.facts],
      visibility: event.visibility as 'player' | 'public',
      narrationHint: event.narrationHint,
    })),
    forbiddenFacts: [
      ...context.forbiddenFacts,
      'Narrator may describe confirmedWorldEvents but must not add facts, move characters, resolve conflicts, or write world state.',
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
  const consistencyChecklist = [
    'Narration must be grounded in rule results and confirmed events.',
    'Narration must not add endings, deaths, arrests, clues, rooms, or character arrivals not present in rule results.',
    'Agent trace errors or fallback usage should be considered when judging reliability.',
  ];
  const traceSummary = (input.agentTrace ?? []).map((entry) => ({
    agent: entry.agent,
    eventType: entry.eventType,
    mode: entry.mode,
    valid: entry.validation.valid,
    errors: entry.validation.errors,
    durationMs: entry.durationMs,
  }));

  return {
    stateSummary: {
      run: input.state.run,
      minute: input.state.minute,
      phase: input.state.phase,
      ending: input.state.ending,
      endingReason: input.state.endingReason,
      threat: input.state.threat,
      suspicion: input.state.suspicion,
    },
    narration: input.narration,
    actionNarration: input.actionNarration,
    ambientNarration: input.ambientNarration,
    playerEvents: input.playerResult.events,
    killerEvents: input.killerResult.events,
    traceSummary,
    worldInfo: selectWorldInfoCards({
      agent: 'director',
      input: [
        input.narration.title,
        input.narration.text,
        input.actionNarration.title,
        input.actionNarration.text,
        input.ambientNarration.title,
        input.ambientNarration.text,
        ...consistencyChecklist,
        ...traceSummary.flatMap((entry) => [entry.agent, entry.eventType, entry.mode, ...entry.errors]),
      ].join(' '),
      state: input.state,
      events: [...input.playerResult.events, ...input.killerResult.events],
      limit: 6,
    }),
    consistencyChecklist,
  };
}

export function buildNpcVisibleContext(
  state: GameState,
  speaker: NpcReply['speaker'],
  input: string,
): NpcVisibleContext {
  const world = ensureWorldState(state);
  const characterId = npcSpeakerToCharacterId(speaker);
  const subjectiveState = buildSubjectiveState(world, characterId);
  const knownFactIds = Object.keys(subjectiveState.knowledge);
  const hasFact = (id: string) => knownFactIds.includes(id);

  return {
    speaker,
    characterId,
    input,
    subjectiveState,
    knownFactIds,
    receivedPlayerMessage: input,
    recentPublicEvents: world.events
      .slice(-5)
      .filter((event) => event.visibility === 'public')
      .map((event) => ({
        type: event.type,
        facts: [...event.facts],
        minute: event.minute,
      })),
    canReference: {
      packagePhoto: hasFact('package_photo'),
      doorActivity: hasFact('player_reported_door_activity') || hasFact('door_coordination_quote'),
      policeReport: hasFact('report_received'),
      fakePoliceSuspicion: hasFact('reported_fake_police') || hasFact('fake_police_suspicion'),
    },
    forbiddenFacts: buildNpcForbiddenFacts(speaker, knownFactIds),
  };
}

function npcSpeakerToCharacterId(speaker: NpcReply['speaker']): CharacterId {
  if (speaker === 'linyue') return 'lin_yue';
  if (speaker === 'police_dispatch') return 'real_police';
  return 'chen_huaimin';
}

function buildNpcForbiddenFacts(speaker: NpcReply['speaker'], knownFactIds: string[]) {
  const forbidden = [
    'Do not use the full GameState. Only use subjectiveState, knownFactIds, public events, and the player message.',
    'Do not mention door, hallway, police, danger, killer pressure, or package contents unless the relevant knownFactIds explicitly allow it.',
  ];
  if (speaker === 'linyue') {
    if (!knownFactIds.includes('player_reported_door_activity') && !knownFactIds.includes('door_coordination_quote')) {
      forbidden.push('Lin Yue has not been told about door or hallway activity.');
    }
    if (!knownFactIds.includes('report_received') && !knownFactIds.includes('reported_fake_police')) {
      forbidden.push('Lin Yue has not been told that police are involved.');
    }
  }
  return forbidden;
}

function toObservableEvent(event: RuleEvent): KillerObservableEvent {
  return {
    subject: event.subject,
    summary: event.summary,
    confidence: event.sensoryHints.length > 0 ? 'high' : 'medium',
    source: 'rule_event',
  };
}
