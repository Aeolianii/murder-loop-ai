import type {
  ActionPlan,
  GameState,
  KillerStrategy,
  Narration,
  NarrationContext,
  TurnResolution,
} from '@murder-loop-ai/shared';

/**
 * 游戏中所有事件类型。
 * 每个事件代表游戏流程中的一个关键节点，Agent 通过订阅这些事件来协作。
 */
export type GameEventType =
  | 'PlayerActionSubmitted'
  | 'ActionParsed'
  | 'RulesApplied'
  | 'KillerActed'
  | 'NarrationRequested'
  | 'NarrationDone'
  | 'NarrationRewriteRequested'
  | 'HighRiskScenarioDetected'
  | 'TurnCompleted'
  | 'GamePhaseChanged'
  | 'DeathTriggered'
  | 'SurvivalTriggered'
  | 'LoopRewound';

/**
 * 每个事件类型对应的 payload 结构。
 * 通过映射类型确保 emit 时的类型安全。
 */
export interface GameEventPayloads {
  PlayerActionSubmitted: { input: string; state: GameState; traceContext?: { worldInfo?: unknown[] } };
  ActionParsed: { plan: ActionPlan; state: GameState };
  RulesApplied: {
    playerResult: TurnResolution['playerResult'];
    state: GameState;
    plan?: ActionPlan;
    traceContext?: { worldInfo?: unknown[] };
  };
  KillerActed: { killerStrategy: KillerStrategy; playerResult: TurnResolution['playerResult']; state: GameState };
  NarrationRequested: {
    plan: ActionPlan;
    playerResult: TurnResolution['playerResult'];
    killerResult: TurnResolution['killerResult'];
    state: GameState;
    narrationContext?: NarrationContext;
  };
  NarrationDone: {
    narration: Narration;
    actionNarration: Narration;
    ambientNarration: Narration;
    state: GameState;
    narrationContext?: NarrationContext;
    playerResult?: TurnResolution['playerResult'];
    killerResult?: TurnResolution['killerResult'];
  };
  NarrationRewriteRequested: { reason: string; previousNarration: Narration; state: GameState };
  HighRiskScenarioDetected: { scenario: string; state: GameState };
  TurnCompleted: { finalState: GameState; moodSignal?: string };
  GamePhaseChanged: { from: string; to: string; state: GameState };
  DeathTriggered: { state: GameState; cause: string };
  SurvivalTriggered: { state: GameState; endingId: string };
  LoopRewound: { state: GameState; previousRun: number };
}

export interface GameCommandResults {
  PlayerActionSubmitted: ActionPlan;
  ActionParsed: TurnResolution['playerResult'];
  RulesApplied: KillerStrategy;
  KillerActed: TurnResolution['killerResult'];
  NarrationRequested: {
    actionNarration: Narration;
    ambientNarration: Narration;
  };
  NarrationDone: {
    score: unknown;
    passed: boolean;
    violations: string[];
    moodSignal?: string;
  };
  TurnCompleted: unknown;
}

export type GameCommandType = keyof GameCommandResults & GameEventType;

/**
 * 通用事件对象。
 * @template T - 事件类型，用于推断 payload 类型
 */
export interface GameEvent<T extends GameEventType = GameEventType> {
  type: T;
  payload: GameEventPayloads[T];
  /** 高精度时间戳（performance.now），用于诊断 */
  timestamp: number;
  /** 触发此事件的上一个事件 ID，用于追踪事件链 */
  parentId?: string;
  /** 唯一标识 */
  id: string;
}

/**
 * 事件处理器函数类型。
 * 可以是同步或异步，返回值会被收集到 emit 的结果数组中。
 */
export type EventHandler<T extends GameEventType = GameEventType> = (
  event: GameEvent<T>,
) => Promise<unknown> | unknown;
