export type GamePhase =
  | 'intro'
  | 'loop_started'
  | 'investigating'
  | 'killer_pressure'
  | 'death'
  | 'survived';

export type EndingId =
  | 'default_murder'
  | 'opened_to_fake_police'
  | 'window_route_death'
  | 'hidden_inside_death'
  | 'framed_survivor'
  | 'escaped_without_truth'
  | 'survived_with_evidence'
  | 'perfect_truth'
  | 'killer_dead_with_evidence'
  | 'killer_dead_no_evidence'
  | 'killer_arrested'
  | 'killer_fled'
  | 'mutual_kill'
  | 'phone_dead_helpless';

export type KillerStatus =
  | 'alive'
  | 'suspicious'
  | 'confronting'
  | 'injured'
  | 'incapacitated'
  | 'dead'
  | 'arrested'
  | 'fled';

export interface StoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string; // e.g. "23:00"
}

export interface Clue {
  id: string;
  name: string;
  description: string;
  status: 'new' | 'known' | 'lost';
  source?: string;  // 'ai_generated' | 'static_fallback' | 'player_discovered'
}

export interface DirectorScore {
  slot: 'action' | 'ambient';
  total: number;
  pace: number;
  infoSafety: number;
  ruleConsistency: number;
  prose: number;
  verdict: 'pass' | 'rewrite';
  issues: string[];
  rewriteBrief: string;
  source: 'heuristic' | 'ai' | 'ai_rewrite';
}

export interface CoordinationState {
  warnings: string[];
  facts?: unknown;
  directorScores?: DirectorScore[];
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
  judgements?: Record<string, unknown>;
}

export interface GameState {
  time: string; // "23:00"
  location: string;
  phase: GamePhase;
  storyLog: StoryNode[];
  clues: Clue[];
  isParsing: boolean;
  isParsingAction: boolean;
  actionConfirmation: string | null;
  coreState?: unknown;
  ending?: EndingId | null;
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
    moodSignal: string;
    npcStatus: Array<{ name: string; status: string; risk: string }>;
    roomStatus: Array<{ item: string; state: string; icon: string }>;
    newClues: Array<{ id: string; name: string; detail: string }>;
  };
}
