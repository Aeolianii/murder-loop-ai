import { enforce, type ArtifactContract } from '../contracts/ArtifactContract';
import type { GameEventBus } from './EventBus';
import type { EventHandler, GameEvent, GameEventType } from './eventTypes';

/**
 * Agent 标识符。
 */
export type AgentId = 'parser' | 'killer' | 'narrator' | 'director' | 'npc' | 'rule' | 'ui-adapter' | 'sidebar';

/**
 * Agent 处理器函数签名。
 * 接收事件的 payload 和完整 event 对象，返回处理结果。
 */
export type AgentHandler = (payload: unknown, event?: GameEvent) => Promise<unknown> | unknown;

/**
 * Agent 注册信息。
 * 每个 Agent 有自己的订阅列表、产物契约、双实现（AI + fallback）。
 */
export interface AgentRegistration {
  id: AgentId;
  /** 订阅的事件 + 优先级 */
  subscriptions: { event: GameEventType; priority: number; role?: 'primary' | 'observer' | 'reviewer'; defer?: boolean }[];
  /** 产物契约 */
  contract: ArtifactContract;
  /** 完整版实现（调用 AI API） */
  handler: AgentHandler;
  /** Demo/fallback 实现（纯本地规则） */
  fallback: AgentHandler;
  /** 当前模式 */
  mode: 'ai' | 'fallback';
}

function cloneAgent(agent: AgentRegistration): AgentRegistration {
  return {
    ...agent,
    subscriptions: agent.subscriptions.map((subscription) => ({ ...subscription })),
  };
}

/**
 * Agent 注册中心 — 管理所有 Agent 的生命周期和事件订阅。
 *
 * 职责：
 * 1. 注册 Agent 并自动订阅其声明的事件
 * 2. 提供模式切换（AI ↔ fallback）
 * 3. 支持一键切换所有 Agent 为 fallback（Demo 模式）
 * 4. 提供 Agent 列表查询（供诊断层使用）
 */
export class AgentRegistry {
  private agents = new Map<AgentId, AgentRegistration>();
  private bus: GameEventBus;
  private unsubscribers: (() => void)[] = [];

  constructor(bus: GameEventBus) {
    this.bus = bus;
  }

  /**
   * 注册一个 Agent。会自动在 EventBus 上订阅其声明的所有事件。
   * 同一 ID 重复注册会抛出异常。
   */
  register(agent: AgentRegistration): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    const registered = cloneAgent(agent);
    this.agents.set(registered.id, registered);

    for (const sub of registered.subscriptions) {
      const unsubscribe = this.bus.subscribe(sub.event, this.createHandler(registered), sub.priority);
      this.unsubscribers.push(unsubscribe);
    }
  }

  /**
   * 获取指定 Agent。
   */
  getAgent(id: AgentId): AgentRegistration | undefined {
    return this.agents.get(id);
  }

  /**
   * 切换单个 Agent 的模式。
   */
  setMode(id: AgentId, mode: 'ai' | 'fallback'): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.mode = mode;
    }
  }

  /**
   * 一键切换所有 Agent 为 fallback 模式（Demo/离线使用）。
   */
  setAllFallback(): void {
    for (const agent of this.agents.values()) {
      agent.mode = 'fallback';
    }
  }

  /**
   * 一键切换所有 Agent 为 AI 模式（完整版）。
   */
  setAllAi(): void {
    for (const agent of this.agents.values()) {
      agent.mode = 'ai';
    }
  }

  /**
   * 列出所有已注册的 Agent（供诊断层使用）。
   */
  listAgents(): ReadonlyArray<{ id: AgentId; mode: string; subscriptions: number }> {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      mode: a.mode,
      subscriptions: a.subscriptions.length,
    }));
  }

  getAgentsForEvent(event: GameEventType): ReadonlyArray<{
    agent: AgentRegistration;
    priority: number;
    role: 'primary' | 'observer' | 'reviewer';
    defer: boolean;
  }> {
    return Array.from(this.agents.values())
      .flatMap((agent) =>
        agent.subscriptions
          .filter((subscription) => subscription.event === event)
          .map((subscription) => ({
            agent,
            priority: subscription.priority,
            role: subscription.role ?? 'observer',
            defer: subscription.defer ?? false,
          })),
      )
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 销毁注册中心，取消所有订阅。
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.agents.clear();
  }

  async runAgent(agent: AgentRegistration, payload: unknown, event?: GameEvent): Promise<unknown> {
    const fn = agent.mode === 'ai' ? agent.handler : agent.fallback;
    const guarded = enforce(
      agent.contract,
      (input: unknown) => fn(input, event),
      agent.id,
    );
    return guarded(payload);
  }

  async runFallback(agent: AgentRegistration, payload: unknown, event?: GameEvent): Promise<unknown> {
    const guarded = enforce(
      agent.contract,
      (input: unknown) => agent.fallback(input, event),
      agent.id,
    );
    return guarded(payload);
  }

  /**
   * 为 Agent 创建事件处理器。
   * 根据 Agent 当前模式选择 handler 或 fallback。
   */
  private createHandler(agent: AgentRegistration): EventHandler {
    return async (event: GameEvent) => this.runAgent(agent, event.payload, event);
  }
}
