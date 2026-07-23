import type { PlayerKnowledge, TruthDerivation } from '@murder-loop-ai/shared';

export type PlayMode = 'easy' | 'hard';

export type GamePhase =
  | 'intro'
  | 'loop_started'
  | 'investigating'
  | 'killer_pressure'
  | 'death'
  | 'survived';

export type EndingId =
  | 'death'
  | 'escaped_no_evidence'
  | 'escaped_with_evidence';

export type EndingReason =
  | 'deadline_murder'
  | 'forced_entry'
  | 'window_route'
  | 'ambient_pressure'
  | 'self_inflicted'
  | 'killer_dead_with_evidence'
  | 'killer_dead_no_evidence'
  | 'deadline_survived_with_evidence'
  | 'police_arrived_with_evidence'
  | 'police_arrived_without_evidence'
  | 'escaped_without_evidence'
  | 'phone_battery_depleted'
  | 'unknown';

export type KillerStatus =
  | 'alive'
  | 'suspicious'
  | 'confronting'
  | 'injured'
  | 'incapacitated'
  | 'dead'
  | 'arrested'
  | 'fled';

export interface RecommendedAction {
  id: string;
  label: string;
  rationale: string;
  intent?: string;
  target?: string;
}

export interface StoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string; // e.g. "23:00"
  recommendedActions?: RecommendedAction[];
}

export interface Clue {
  id: string;
  name: string;
  description: string;
  status: 'new' | 'known' | 'lost';
  source?: string;  // 'ai_generated' | 'static_fallback' | 'player_discovered'
}

export interface TurnTimingEntry {
  stageId: string;
  durationMs: number;
  status?: string;
}

export interface TurnTimingState {
  wallClockMs: number;
  totalMs: number;
  slowest: TurnTimingEntry | null;
  entries: TurnTimingEntry[];
}

export interface CoordinationState {
  warnings: string[];
  facts?: unknown;
  semanticPrefetch?: {
    status: 'ready_hit' | 'inflight_hit' | 'miss' | 'stale' | 'cancelled' | 'standard';
    savedCompilerMs?: number;
    cancelledCount?: number;
    metrics: {
      semantic_prefetch_ready_hit: number;
      semantic_prefetch_inflight_hit: number;
      semantic_prefetch_miss: number;
      semantic_prefetch_cancelled: number;
      semantic_prefetch_stale: number;
      savedCompilerMs: number;
    };
  };
  trace?: Array<{
    taskId: string;
    agentId?: string;
    source: string;
    decision?: string;
    warnings: string[];
    durationMs: number;
  }>;
  agentTiming?: {
    totalMs: number;
    slowest: {
      taskId: string;
      agentId: string;
      source: string;
      durationMs: number;
    } | null;
    entries: Array<{
      taskId: string;
      agentId: string;
      source: string;
      durationMs: number;
    }>;
  };
  turnTiming?: TurnTimingState;
  judgements?: Record<string, unknown>;
}

export interface GameState {
  gameSessionId: string;
  stateVersion: number;
  playMode: PlayMode;
  time: string; // "23:00"
  location: string;
  phase: GamePhase;
  storyLog: StoryNode[];
  clues: Clue[];
  isParsing: boolean;
  isParsingAction: boolean;
  actionConfirmation: string | null;
  coreState?: unknown;
  knowledge?: PlayerKnowledge[];
  truth?: TruthDerivation;
  ending?: EndingId | null;
  endingReason?: EndingReason | null;
  deathTitle?: string | null;
  deathSummary?: string | null;
  deathMethod?: string | null;
  coordination?: CoordinationState;
  recap?: string;
  sidebar?: {
    phone: { battery: number; recording: boolean; muted: boolean; newMessages: string[] };
    threat: { level: number; trend: string; label: string };
    timeLabel: string;
    phaseLabel: string;
    npcStatus: Array<{ name: string; status: string; risk: string }>;
    roomStatus: Array<{ item: string; state: string; icon: string }>;
    newClues: Array<{ id: string; name: string; detail: string }>;
  };
}
