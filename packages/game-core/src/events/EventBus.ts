import type { EventHandler, GameEvent, GameEventType } from './eventTypes';

interface SubscriptionEntry {
  event: GameEventType;
  handler: EventHandler;
  priority: number;
}

export interface EventLogEntry {
  event: GameEvent;
  results: unknown[];
  durationMs: number;
}

/**
 * 游戏事件总线 — Harness 架构的神经中枢。
 *
 * 设计原则：
 * - 同步优先：游戏逻辑需要确定性，默认同步执行处理器
 * - 优先级排序：同一事件的多个处理器按 priority (1-100) 有序执行
 * - 事件日志：所有事件自动记录到环形缓冲区，供诊断层消费
 * - 零依赖：纯 TypeScript 实现，~150 行
 */
export class GameEventBus {
  private subscriptions: SubscriptionEntry[] = [];
  private eventLog: EventLogEntry[] = [];
  private readonly maxLogSize: number;
  private idCounter = 0;

  constructor(maxLogSize = 500) {
    this.maxLogSize = maxLogSize;
  }

  /**
   * 订阅事件。
   * @returns 取消订阅的函数
   */
  subscribe(
    event: GameEventType,
    handler: EventHandler,
    priority = 50,
  ): () => void {
    const sub: SubscriptionEntry = { event, handler, priority };
    this.subscriptions.push(sub);
    // 保持按优先级排序
    this.subscriptions.sort((a, b) => a.priority - b.priority);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * 发射事件，同步执行所有匹配的处理器（按优先级排序）。
   * 处理器可以是 async，会按顺序 await。
   */
  async emit<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<unknown[]> {
    const event = this.createEvent(type, payload, parentId);

    const handlers = this.subscriptions
      .filter((s) => s.event === type)
      .sort((a, b) => a.priority - b.priority);

    const startTime = performance.now();
    const results: unknown[] = [];

    for (const sub of handlers) {
      try {
        results.push(await sub.handler(event as GameEvent));
      } catch (error) {
        results.push({ __error: error });
      }
    }

    this.recordEvent(event, results, performance.now() - startTime);
    return results;
  }

  createEvent<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): GameEvent<T> {
    return {
      type,
      payload,
      timestamp: performance.now(),
      parentId,
      id: `evt-${++this.idCounter}-${type}`,
    } as GameEvent<T>;
  }

  recordEvent(event: GameEvent, results: unknown[], durationMs: number): void {
    this.addToLog(event, results, durationMs);
  }

  /**
   * 获取完整事件日志（只读）。
   */
  getEventLog(): ReadonlyArray<EventLogEntry> {
    return this.eventLog;
  }

  /**
   * 获取最近 N 条事件日志。
   */
  getRecentEvents(count = 20): ReadonlyArray<EventLogEntry> {
    return this.eventLog.slice(-count);
  }

  /** 清空事件日志 */
  clearLog(): void {
    this.eventLog = [];
  }

  /** 当前已注册的订阅数量 */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  private addToLog(event: GameEvent, results: unknown[], durationMs: number): void {
    this.eventLog.push({ event, results, durationMs });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }
}
