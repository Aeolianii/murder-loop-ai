import type {
  ActionPlan,
  GameState,
  KillerStrategy,
  Narration,
  NarrationContext,
  RecommendedAction,
  TurnResolution,
} from '@murder-loop-ai/shared';
import type { KillerContext } from '../context/ContextBuilder';
import type { RecommendationRequest } from '../recommendations/recommendationTypes';

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
  | 'RecommendationsRequested'
  | 'NarrationCritiqueRequested'
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
    killerContext: KillerContext;
  };
  KillerActed: { killerStrategy: KillerStrategy; playerResult: TurnResolution['playerResult']; state: GameState };
  NarrationRequested: {
    narrationContext: NarrationContext;
  };
  RecommendationsRequested: RecommendationRequest;
  NarrationCritiqueRequested: {
    directorContext: unknown;
    narrationContext: NarrationContext;
  };
  TurnCompleted: { finalState: GameState };
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
  RecommendationsRequested: RecommendedAction[];
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
