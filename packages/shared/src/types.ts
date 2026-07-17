import type { WorldEvent, WorldState } from './worldTypes';

export type GamePhase =
  | 'intro'
  | 'loop_started'
  | 'investigating'
  | 'killer_pressure'
  | 'police_called'
  | 'false_police_arrived'
  | 'pre_2347_countdown'
  | 'post_2347_escalation'
  | 'escape_attempt'
  | 'confrontation'
  | 'death'
  | 'survived'
  | 'ending';

export type KillerPhase =
  | 'confirming_package'
  | 'package_recovery'
  | 'soft_pressure'
  | 'deception'
  | 'forced_entry'
  | 'evidence_erasure'
  | 'framing'
  | 'violence'
  | 'retreat'
  | 'exposed';

/** 杀手物理状态——规则引擎和 AI 据此判断杀手能做什么 */
export type KillerStatus =
  | 'alive'
  | 'suspicious'
  | 'confronting'
  | 'injured'
  | 'incapacitated'
  | 'dead'
  | 'arrested'
  | 'fled';

export type PolicePhase =
  | 'not_contacted'
  | 'call_started'
  | 'verifying_report'
  | 'dispatch_pending'
  | 'real_police_en_route'
  | 'delayed'
  | 'arrived'
  | 'misled';

export type LinYuePhase =
  | 'unaware'
  | 'received_photo'
  | 'worried'
  | 'calling_player'
  | 'calling_police'
  | 'coming_to_apartment'
  | 'endangered'
  | 'safe'
  | 'injured'
  | 'dead';

export type EvidencePhase =
  | 'package_unnoticed'
  | 'package_seen'
  | 'package_opened'
  | 'package_photographed'
  | 'evidence_shared'
  | 'evidence_backed_up'
  | 'evidence_hidden'
  | 'evidence_destroyed'
  | 'evidence_submitted';

export type StoryTone = 'neutral' | 'memory' | 'clue' | 'threat' | 'death' | 'win' | 'system';
export type StoryChannel = 'ambient' | 'action' | 'memory' | 'system';

export type EndingId =
  | 'death'
  | 'escaped_no_evidence'
  | 'escaped_with_evidence';

export type EndingReason =
  | 'deadline_murder'
  | 'forced_entry'
  | 'window_route'
  | 'ambient_pressure'
  | 'killer_dead_with_evidence'
  | 'killer_dead_no_evidence'
  | 'deadline_survived_with_evidence'
  | 'police_arrived_with_evidence'
  | 'police_arrived_without_evidence'
  | 'escaped_without_evidence'
  | 'phone_battery_depleted'
  | 'unknown';

export type ScoreRank = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** AI 可以自由创造 intent。常用值: inspect, attack, pick_up, use_item, communicate, wait, escape 等 */
export type ActionIntent = string;

/** AI 可以自由使用任意 target。以下仅为常用值参考。 */
export type ActionTarget = string;

export interface ParsedAction {
  id: string;
  raw: string;
  intent: ActionIntent;
  target: ActionTarget;
  method?: string;
  confidence: number;
  /** 动作分析 agent 评估的本回合耗时，单位分钟，范围 1~5 */
  timeCost: number;
  noise: number;
  risk: 'low' | 'medium' | 'high';
}

export interface ActionPlan {
  id: string;
  raw: string;
  summary: string;
  actions: ParsedAction[];
  confidence: number;
  warnings: string[];
}

export interface StoryLogEntry {
  id: string;
  run: number;
  minute: number;
  title: string;
  text: string;
  tone: StoryTone;
  channel?: StoryChannel;
  isAiNarration?: boolean;
}

export type MemoryScope = 'short_term' | 'current_run' | 'cross_run' | 'character';
export type MemoryKind = 'observation' | 'action' | 'clue' | 'death' | 'checkpoint' | 'lesson';
export type CharacterMemoryOwner = 'player' | 'linYue' | 'killer';
export type MemorySource = 'rule' | 'ai' | 'system' | 'legacy';

export interface MemoryFragment {
  id: string;
  run: number;
  minute?: number;
  title: string;
  text: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  owner?: CharacterMemoryOwner;
  importance?: number;
  source?: MemorySource;
}

export interface LoopMemory {
  shortTerm: MemoryFragment[];
  currentRun: MemoryFragment[];
  crossRun: MemoryFragment[];
  characters: {
    player: MemoryFragment[];
    linYue: MemoryFragment[];
    killer: MemoryFragment[];
  };
}

export interface ClueRecord {
  id: string;
  title: string;
  detail: string;
  /** 'ai_generated' 由叙事 AI 动态生成 | 'static_fallback' 来自 clueBook | 'player_discovered' 由规则引擎触发 */
  source: 'ai_generated' | 'static_fallback' | 'player_discovered';
  weight: number;
  /** 发现时间和轮次 */
  discoveredAt: { run: number; minute: number };
  /** 跨循环保留（默认 true，AI 生成的线索在死亡后依然记得） */
  isPersistent: boolean;
}

export interface RoomObjectState {
  id: string;
  name: string;
  location: string;
  visible: boolean;
  inspected: boolean;
  state: Record<string, boolean | number | string | null>;
}

export interface KillerKnowledge {
  knowsPackageAt503: boolean;
  knowsPlayerOpenedPackage: boolean | 'uncertain';
  knowsPlayerPhotographedPackage: boolean;
  knowsPlayerContactedLinYue: boolean;
  knowsDoorBarricaded: boolean;
  knowsWindowLocked: boolean;
  knowsPoliceCalled: boolean;
  suspectsPlayerIsAlert: boolean;
  knowsEvidenceLocation: string | null;
}

export interface PlayerCondition {
  injury: 'none' | 'minor' | 'bleeding' | 'leg_injured' | 'critical';
  stress: number;
  hidden: boolean;
}

export interface GameState {
  run: number;
  minute: number;
  phase: GamePhase;
  killerPhase: KillerPhase;
  /** 杀手的物理状态——规则引擎和 AI 据此判断他能做什么 */
  killerStatus: KillerStatus;
  policePhase: PolicePhase;
  linYuePhase: LinYuePhase;
  evidencePhase: EvidencePhase;
  threat: number;
  suspicion: number;
  player: PlayerCondition;
  /** 当前手持物品 id（用于攻击判定），null 表示空手 */
  playerHolding: string | null;
  /** 本轮是否发生了战斗——战斗发生后触发结局检测 */
  combatTriggered: boolean;
  /** 线索列表——ClueRecord[] 替代旧的 string[]，支持 AI 动态生成 */
  clues: ClueRecord[];
  room: Record<string, RoomObjectState>;
  killerKnowledge: KillerKnowledge;
  memory: LoopMemory;
  log: StoryLogEntry[];
  ending: EndingId | null;
  endingReason: EndingReason | null;
  score: ScoreResult | null;
  /** 手机电量（分钟），独立追踪 */
  phoneBattery: number;
  /** 手机是否可用（电量 > 0 且未被损坏） */
  phoneFunctional: boolean;
  /** 死亡回溯后的首回合保护，保证玩家不会在刚醒来的第一回合再次死亡 */
  reviveProtectionTurns?: number;
  /** Hidden resolver: once real police are confirmed, the background minute when they arrive. */
  policeArrivalMinute?: number;
  /** Plot Director 生成的剧情指导——下一回合注入给叙事/杀手 AI */
  plotGuidance?: string;
  /** Optional Behavior Network snapshot while legacy GameState remains authoritative. */
  world?: WorldState;
}

export interface RuleEvent {
  kind: 'action' | 'clue' | 'state_change' | 'sound' | 'message' | 'threat' | 'ending';
  subject: string;
  summary: string;
  sensoryHints: string[];
  visibility: 'player' | 'killer' | 'hidden';
}

export interface RuleResult {
  title: string;
  text: string;
  tone: StoryTone;
  addedClues: ClueRecord[];
  timePassed: number;
  threatDelta: number;
  events: RuleEvent[];
  state: GameState;
}

export interface RecommendedAction {
  id: string;
  label: string;
  rationale: string;
  intent?: ActionIntent;
  target?: ActionTarget;
}

export interface CombatContext {
  playerWeapon: string | null;
  killerArmed: boolean;
  advantage: 'player' | 'killer' | 'mutual';
}

export interface NarrationContext {
  run: number;
  minute: number;
  turnIndex: number;
  playerActionSummary: string;
  /** 玩家原始输入——叙事 AI 用它核对动作，防止跑题 */
  playerInput?: string;
  events: RuleEvent[];
  stateSnapshot: {
    phase: GamePhase;
    killerPhase: KillerPhase;
    killerStatus: KillerStatus;
    policePhase: PolicePhase;
    linYuePhase: LinYuePhase;
    evidencePhase: EvidencePhase;
    threat: number;
    suspicion: number;
    injury: PlayerCondition['injury'];
    stress: number;
    clues: ClueRecord[];
    ending: EndingId | null;
    endingReason: EndingReason | null;
    phoneBattery: number;
    phoneFunctional: boolean;
    playerHolding: string | null;
    combatTriggered: boolean;
  };
  recentLog: Array<Pick<StoryLogEntry, 'minute' | 'title' | 'text' | 'channel'>>;
  /** AI 生成线索时的参考：已有线索标题列表 */
  knownClueTitles: string[];
  /** 战斗上下文（仅在 combatTriggered 时提供） */
  combatContext?: CombatContext;
  /** 当前剧情阶段描述（供 AI 叙事判断节奏） */
  plotPhase: string;
  /** 玩家处境摘要 */
  playerSituation: string;
  /** Structured memory visible to narration only; rules and endings must ignore it. */
  memorySummary?: string[];
  /** Confirmed Behavior Network events visible to narration only; these are read-only facts. */
  confirmedWorldEvents?: WorldEvent[];
  /** Selected world facts for this turn. These are context only, not rule authority. */
  worldInfo?: Array<{ id: string; title: string; content: string; tags: string[]; priority: number }>;
  forbiddenFacts: string[];
  styleGuide: string[];
}

export interface NpcReply {
  speaker: 'linyue' | 'police_dispatch' | 'chen_huaimin';
  text: string;
  intent: string;
  riskWarning: string;
  suggestedExternalAction: string;
}

export interface KillerStrategy {
  id: string;
  /** AI 自由选择策略类型。常用: spare_key_entry, window_route, landlord_excuse, phone_probe, direct_confrontation, retreat 等 */
  type: string;
  title: string;
  rationale: string;
  responseHint?: string;
  visibleToPlayer: boolean;
  risk: 'low' | 'medium' | 'high';
}

export interface Narration {
  title: string;
  text: string;
  /** AI 可直接声明本回合已进入某个明确结局 */
  ending?: EndingId;
  /** AI 判断：这一叙事是否意味着玩家死亡 */
  isFatal?: boolean;
  /** AI 判断：这一叙事是否意味着杀手死亡 */
  killerKilled?: boolean;
  /** AI 动态生成的线索 */
  clue?: {
    id: string;
    title: string;
    detail: string;
    weight: number;
  };
}

export interface ScoreResult {
  total: number;
  rank: ScoreRank;
  survival: number;
  truth: number;
  evidence: number;
  npc: number;
  injury: number;
  riskControl: number;
  notes: string[];
}

export interface TurnResolution {
  plan: ActionPlan;
  playerResult: RuleResult;
  killerStrategy: KillerStrategy;
  killerResult: RuleResult;
  narration: Narration;
  actionNarration?: Narration;
  ambientNarration?: Narration;
  recommendedActions?: RecommendedAction[];
  finalState: GameState;
}

export interface AmbientResolution {
  ambientResult: RuleResult;
  killerStrategy: KillerStrategy;
  killerResult: RuleResult;
  narration: Narration;
  finalState: GameState;
}
