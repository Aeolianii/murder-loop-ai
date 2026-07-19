import type {
  ActionTarget,
  EndingId,
  EndingReason,
  KillerStrategy,
  Narration,
  NpcReply,
  ParsedAction,
  RecommendedAction,
  RuleEvent,
  StoryLogEntry,
} from '@murder-loop-ai/shared';
import type { CharacterId, EventEffect, LocationId, WorldEvent } from '../world/worldTypes';
import type { SidebarPayload } from '../agents/SidebarAgent';

export type DomainConceptKind =
  | 'command'
  | 'domain_event'
  | 'simulation_intent'
  | 'render_artifact'
  | 'trace_log';

export type DomainConceptSource =
  | 'player'
  | 'parser'
  | 'rule'
  | 'killer'
  | 'npc'
  | 'world'
  | 'narrator'
  | 'director'
  | 'ui'
  | 'system';

export interface DomainTimestamp {
  run: number;
  minute: number;
}

export interface DomainConceptBase<K extends DomainConceptKind> {
  id: string;
  kind: K;
  createdAt: DomainTimestamp;
  source: DomainConceptSource;
  causationId?: string;
  correlationId?: string;
}

export type KnownPlayerCommandType =
  | 'inspect'
  | 'preserve_evidence'
  | 'communicate'
  | 'secure_entry'
  | 'hide_evidence'
  | 'call_police'
  | 'verify_identity'
  | 'escape'
  | 'open_door'
  | 'deceive'
  | 'record'
  | 'wait'
  | 'self_care'
  | 'attack'
  | 'pick_up'
  | 'use_item';

export type PlayerCommandType = KnownPlayerCommandType | (string & {});

export interface PlayerCommand extends DomainConceptBase<'command'> {
  actor: 'player';
  commandType: PlayerCommandType;
  raw: string;
  summary?: string;
  actionId?: string;
  target?: ActionTarget;
  method?: string;
  confidence?: number;
  timeCost?: number;
  noise?: number;
  risk?: ParsedAction['risk'];
  payload?: Record<string, unknown>;
}

export type KnownDomainEventType =
  | 'player_action_accepted'
  | 'inspection_completed'
  | 'time_advanced'
  | 'clue_discovered'
  | 'package_photographed'
  | 'photo_sent_to_linyue'
  | 'front_door_secured'
  | 'window_secured'
  | 'police_alert_raised'
  | 'police_identity_verified'
  | 'npc_message_received'
  | 'door_activity_reported_to_linyue'
  | 'player_lied_to_chen'
  | 'player_messaged_chen'
  | 'recording_started'
  | 'phone_secured'
  | 'evidence_hidden'
  | 'escape_attempted'
  | 'front_door_opened'
  | 'self_care_completed'
  | 'player_waited'
  | 'combat_attempted'
  | 'item_picked_up'
  | 'item_used'
  | 'killer_strategy_applied'
  | 'threat_changed'
  | 'world_event_confirmed'
  | 'ending_reached'
  | 'story_node_resolved';

export type DomainEventType = KnownDomainEventType | (string & {});
export type DomainEventVisibility = 'player' | 'killer' | 'world' | 'public' | 'hidden';
export type DomainAuthority = 'game' | 'world' | 'both';

export interface DomainEvent extends DomainConceptBase<'domain_event'> {
  eventType: DomainEventType;
  authority: DomainAuthority;
  subject: string;
  summary: string;
  facts: string[];
  visibility: DomainEventVisibility;
  actorIds?: CharacterId[];
  locationId?: LocationId;
  ruleEvents?: RuleEvent[];
  worldEvents?: WorldEvent[];
  effects?: EventEffect[];
  clueIds?: string[];
  ending?: {
    id: EndingId;
    reason: EndingReason;
  };
  payload?: Record<string, unknown>;
}

export type SimulationIntentType =
  | 'killer_plan_proposed'
  | 'npc_plan_proposed'
  | 'world_movement_proposed'
  | 'story_policy_skip_proposed'
  | (string & {});

export interface SimulationIntent extends DomainConceptBase<'simulation_intent'> {
  intentType: SimulationIntentType;
  proposer: 'killer' | 'npc' | 'world' | 'story_policy' | 'system';
  actorId?: CharacterId;
  strategy?: KillerStrategy;
  destination?: LocationId;
  confidence?: number;
  rationale?: string;
  requiresDomainReview: true;
  payload?: Record<string, unknown>;
}

export type RenderArtifactType =
  | 'action_narration'
  | 'ambient_narration'
  | 'npc_reply'
  | 'sidebar'
  | 'story_log'
  | 'recommended_actions'
  | 'audio_cue'
  | 'frontend_response'
  | 'director_critique'
  | (string & {});

export interface RenderArtifact extends DomainConceptBase<'render_artifact'> {
  artifactType: RenderArtifactType;
  basedOnEventIds: string[];
  consumer: 'player' | 'frontend' | 'debug' | 'prompt' | 'developer';
  isAuthoritative: false;
  payload:
    | Narration
    | NpcReply
    | SidebarPayload
    | StoryLogEntry[]
    | RecommendedAction[]
    | Record<string, unknown>;
}

export type TraceLogType =
  | 'agent_trace'
  | 'harness_trace'
  | 'model_call'
  | 'fallback_used'
  | 'validation_warning'
  | 'policy_guard_result'
  | (string & {});

export interface TraceLog extends DomainConceptBase<'trace_log'> {
  traceType: TraceLogType;
  observedConceptIds: string[];
  isAuthoritative: false;
  durationMs?: number;
  warnings?: string[];
  payload?: Record<string, unknown>;
}

export type TurnDomainConcept =
  | PlayerCommand
  | DomainEvent
  | SimulationIntent
  | RenderArtifact
  | TraceLog;

export function isDomainEvent(concept: TurnDomainConcept): concept is DomainEvent {
  return concept.kind === 'domain_event';
}

export function isPlayerCommand(concept: TurnDomainConcept): concept is PlayerCommand {
  return concept.kind === 'command';
}

export function isRenderArtifact(concept: TurnDomainConcept): concept is RenderArtifact {
  return concept.kind === 'render_artifact';
}

export function isAuthoritativeConcept(concept: TurnDomainConcept): concept is DomainEvent {
  return concept.kind === 'domain_event';
}
