import type { AgentId, AgentRegistration, AgentRegistry } from './AgentRegistry';
import type { AgentTraceEntryContract, AgentTraceWorldInfoContract } from '@murder-loop-ai/ai-contracts';
import type { GameEventBus } from './EventBus';
import type {
  GameCommandResults,
  GameCommandType,
  GameEvent,
  GameEventType,
} from './eventTypes';

export interface HarnessTraceEntry {
  eventType: string;
  agentId: AgentId;
  source: 'ai' | 'fallback' | 'deterministic';
  durationMs: number;
  warnings: string[];
}

export class HarnessDispatcher {
  private trace: HarnessTraceEntry[] = [];
  private agentTrace: AgentTraceEntryContract[] = [];
  private artifacts: Array<{ eventType: string; agentId: AgentId; source: HarnessTraceEntry['source']; result: unknown }> = [];

  constructor(
    private readonly bus: GameEventBus,
    private readonly registry: AgentRegistry,
  ) {}

  async runCommand<T extends GameCommandType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<GameCommandResults[T]> {
    const event = this.bus.createEvent(type, payload, parentId);
    const startedAt = performance.now();
    const subscribers = this.registry.getAgentsForEvent(type);
    const primary = subscribers.find((subscriber) => subscriber.role === 'primary');
    if (!primary) {
      throw new Error(`No primary agent registered for command "${type}"`);
    }

    const eventResults: unknown[] = [];
    let primaryResult: unknown;
    try {
      primaryResult = await this.runWithFallback(type, primary.agent, payload, event);
      eventResults.push(primaryResult);
    } catch (error) {
      eventResults.push({ __error: error });
      this.bus.recordEvent(event, eventResults, performance.now() - startedAt);
      throw error;
    }

    for (const subscriber of subscribers.filter((entry) => entry.agent.id !== primary.agent.id)) {
      if (subscriber.defer) {
        void this.runWithFallback(type, subscriber.agent, payload, event).catch(() => null);
        continue;
      }

      try {
        eventResults.push(await this.runWithFallback(type, subscriber.agent, payload, event));
      } catch (error) {
        eventResults.push({ __error: error });
      }
    }

    this.bus.recordEvent(event, eventResults, performance.now() - startedAt);
    return primaryResult as GameCommandResults[T];
  }

  async emitNotification<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<unknown[]> {
    return this.bus.emit(type, payload, parentId);
  }

  dispatchDeferred<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): void {
    const snapshot = deepFreeze(structuredClone(payload));
    const event = this.bus.createEvent(type, snapshot, parentId);
    const startedAt = performance.now();
    const subscribers = this.registry.getAgentsForEvent(type).filter((subscriber) => subscriber.defer);

    void Promise.all(subscribers.map(async ({ agent }) => {
      try {
        return await this.runWithFallback(type, agent, snapshot, event);
      } catch (error) {
        return { __error: error };
      }
    })).then((results) => {
      this.bus.recordEvent(event, results, performance.now() - startedAt);
    });
  }

  getTrace(): ReadonlyArray<HarnessTraceEntry> {
    return this.trace;
  }

  getAgentTrace(): ReadonlyArray<AgentTraceEntryContract> {
    return this.agentTrace;
  }

  getArtifacts(eventType?: string): ReadonlyArray<{ eventType: string; agentId: AgentId; source: HarnessTraceEntry['source']; result: unknown }> {
    return eventType ? this.artifacts.filter((artifact) => artifact.eventType === eventType) : this.artifacts;
  }

  getLatestArtifact(agentId: AgentId, eventType?: string): unknown | undefined {
    return [...this.artifacts]
      .reverse()
      .find((artifact) => artifact.agentId === agentId && (!eventType || artifact.eventType === eventType))
      ?.result;
  }

  private async runWithFallback(
    eventType: string,
    agent: AgentRegistration,
    payload: unknown,
    event: GameEvent,
  ): Promise<unknown> {
    const startedAt = performance.now();
    const warnings: string[] = [];

    try {
      const result = await this.registry.runAgent(agent, payload, event);
      const source = agent.mode === 'ai' ? 'ai' : 'fallback';
      this.recordTrace(eventType, agent, startedAt, warnings, source);
      this.recordAgentTrace(eventType, agent, startedAt, warnings, source, payload, result);
      this.recordArtifact(eventType, agent, source, result);
      return result;
    } catch (error) {
      warnings.push(formatError(error));

      if (agent.mode !== 'ai') {
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        this.recordAgentTrace(eventType, agent, startedAt, warnings, 'fallback', payload, undefined);
        throw error;
      }

      try {
        const fallbackResult = await this.registry.runFallback(agent, payload, event);
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        this.recordAgentTrace(eventType, agent, startedAt, warnings, 'fallback', payload, fallbackResult);
        this.recordArtifact(eventType, agent, 'fallback', fallbackResult);
        return fallbackResult;
      } catch (fallbackError) {
        warnings.push(formatError(fallbackError));
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        this.recordAgentTrace(eventType, agent, startedAt, warnings, 'fallback', payload, undefined);
        throw fallbackError;
      }
    }
  }

  private recordTrace(
    eventType: string,
    agent: AgentRegistration,
    startedAt: number,
    warnings: string[],
    source: HarnessTraceEntry['source'],
  ): void {
    this.trace.push({
      eventType,
      agentId: agent.id,
      source,
      warnings: [...warnings],
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  private recordArtifact(
    eventType: string,
    agent: AgentRegistration,
    source: HarnessTraceEntry['source'],
    result: unknown,
  ): void {
    this.artifacts.push({ eventType, agentId: agent.id, source, result });
  }

  private recordAgentTrace(
    eventType: string,
    agent: AgentRegistration,
    startedAt: number,
    warnings: string[],
    source: HarnessTraceEntry['source'],
    input: unknown,
    output: unknown,
  ): void {
    const worldInfo = extractTraceWorldInfo(input);
    this.agentTrace.push({
      agent: agent.id,
      eventType,
      mode: source === 'ai' ? 'ai' : 'fallback',
      input: sanitizeTraceValue(input),
      output: sanitizeTraceValue(output),
      ...(worldInfo.length > 0 ? { worldInfo } : {}),
      validation: {
        valid: warnings.length === 0,
        errors: [...warnings],
      },
      durationMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function looksLikeGameState(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.run === 'number'
    && typeof value.minute === 'number'
    && typeof value.phase === 'string'
    && typeof value.threat === 'number';
}

function summarizeGameState(state: Record<string, unknown>) {
  return {
    run: state.run,
    minute: state.minute,
    phase: state.phase,
    killerStatus: state.killerStatus,
    policePhase: state.policePhase,
    threat: state.threat,
    suspicion: state.suspicion,
    ending: state.ending,
    endingReason: state.endingReason,
    clueCount: Array.isArray(state.clues) ? state.clues.length : undefined,
    logCount: Array.isArray(state.log) ? state.log.length : undefined,
  };
}

function extractTraceWorldInfo(value: unknown): AgentTraceWorldInfoContract[] {
  const candidates = [
    getNestedValue(value, ['traceContext', 'worldInfo']),
    getNestedValue(value, ['parserContext', 'worldInfo']),
    getNestedValue(value, ['killerContext', 'worldInfo']),
    getNestedValue(value, ['narrationContext', 'worldInfo']),
    getNestedValue(value, ['directorContext', 'worldInfo']),
    getNestedValue(value, ['worldInfo']),
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const summarized = candidate
      .map(summarizeWorldInfoCard)
      .filter((card): card is AgentTraceWorldInfoContract => Boolean(card));
    if (summarized.length > 0) return summarized;
  }
  return [];
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function summarizeWorldInfoCard(value: unknown): AgentTraceWorldInfoContract | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  const source = value.source === 'derived' || value.source === 'manual' ? value.source : 'unknown';
  return {
    id: value.id,
    title: value.title,
    source,
    priority: typeof value.priority === 'number' ? value.priority : 0,
  };
}

function sanitizeTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((entry) => sanitizeTraceValue(entry, depth + 1));
  if (looksLikeGameState(value)) return summarizeGameState(value);

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/apiKey|secret|token|password/i.test(key)) {
      result[key] = '[redacted]';
      continue;
    }
    if ((key === 'state' || key === 'finalState' || key === 'coreState') && looksLikeGameState(nested)) {
      result[key] = summarizeGameState(nested);
      continue;
    }
    result[key] = sanitizeTraceValue(nested, depth + 1);
  }
  return result;
}
