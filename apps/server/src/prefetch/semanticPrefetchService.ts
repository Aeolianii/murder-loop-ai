import { createHash, randomUUID } from 'node:crypto';
import type { TurnBrief, TurnEnvelope } from '@murder-loop-ai/ai-contracts';
import type { GameState, RecommendedAction } from '@murder-loop-ai/shared';

export interface SemanticPrefetchCompileInput {
  state: GameState;
  recommendation: RecommendedAction;
  envelope: TurnEnvelope;
  signal: AbortSignal;
}

export interface SemanticPrefetchCompileResult {
  brief?: TurnBrief;
  durationMs: number;
}

export interface SemanticPrefetchScheduleInput {
  gameSessionId: string;
  loopId: string;
  stateVersion: number;
  state: GameState;
  recommendations: RecommendedAction[];
}

export interface SemanticPrefetchClaimInput {
  gameSessionId: string;
  loopId: string;
  stateVersion: number;
  recommendationId: string;
  label: string;
}

export type SemanticPrefetchClaim = {
  status: 'ready_hit' | 'inflight_hit';
  brief: TurnBrief;
  savedCompilerMs: number;
} | {
  status: 'miss' | 'stale';
  brief?: undefined;
  savedCompilerMs?: undefined;
};

export interface SemanticPrefetchMetrics {
  semantic_prefetch_ready_hit: number;
  semantic_prefetch_inflight_hit: number;
  semantic_prefetch_miss: number;
  semantic_prefetch_cancelled: number;
  semantic_prefetch_stale: number;
  savedCompilerMs: number;
}

export interface SemanticPrefetchService {
  schedule(input: SemanticPrefetchScheduleInput): void;
  claim(input: SemanticPrefetchClaimInput): Promise<SemanticPrefetchClaim>;
  cancelSession(gameSessionId: string, reason: string): number;
  pendingCount(): number;
  metrics(): SemanticPrefetchMetrics;
}

export interface SemanticPrefetchServiceOptions {
  compile: (input: SemanticPrefetchCompileInput) => Promise<SemanticPrefetchCompileResult>;
  now?: () => number;
  createTurnId?: () => string;
  ttlMs?: number;
  compilerVersion?: string;
  maxRecommendations?: number;
}

interface PrefetchEntry {
  key: string;
  gameSessionId: string;
  loopId: string;
  stateVersion: number;
  recommendationId: string;
  labelHash: string;
  controller: AbortController;
  startedAt: number;
  expiresAt: number;
  status: 'running' | 'ready';
  durationMs: number;
  promise: Promise<SemanticPrefetchCompileResult | undefined>;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_COMPILER_VERSION = 'semantic-compiler-v1';

export function createSemanticPrefetchService(
  options: SemanticPrefetchServiceOptions,
): SemanticPrefetchService {
  const now = options.now ?? Date.now;
  const createTurnId = options.createTurnId ?? (() => `semantic-prefetch-${randomUUID()}`);
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS);
  const compilerVersion = options.compilerVersion ?? DEFAULT_COMPILER_VERSION;
  const maxRecommendations = positiveInteger(options.maxRecommendations, 3);
  const entries = new Map<string, PrefetchEntry>();
  const counters: SemanticPrefetchMetrics = {
    semantic_prefetch_ready_hit: 0,
    semantic_prefetch_inflight_hit: 0,
    semantic_prefetch_miss: 0,
    semantic_prefetch_cancelled: 0,
    semantic_prefetch_stale: 0,
    savedCompilerMs: 0,
  };

  function cancelEntry(entry: PrefetchEntry, reason: string): void {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    if (!entry.controller.signal.aborted) entry.controller.abort(reason);
    counters.semantic_prefetch_cancelled += 1;
  }

  function cancelSession(gameSessionId: string, reason: string): number {
    const matching = [...entries.values()].filter((entry) => entry.gameSessionId === gameSessionId);
    for (const entry of matching) cancelEntry(entry, reason);
    return matching.length;
  }

  function cancelSiblings(gameSessionId: string, selectedKey: string): void {
    for (const entry of [...entries.values()]) {
      if (entry.gameSessionId === gameSessionId && entry.key !== selectedKey) {
        cancelEntry(entry, 'recommendation_sibling_not_selected');
      }
    }
  }

  function purgeExpired(): void {
    const current = now();
    for (const entry of [...entries.values()]) {
      if (entry.expiresAt <= current) cancelEntry(entry, 'semantic_prefetch_expired');
    }
  }

  return {
    schedule(input) {
      purgeExpired();
      cancelSession(input.gameSessionId, 'state_changed');
      const stateSnapshot = structuredClone(input.state) as GameState;

      for (const recommendation of input.recommendations.slice(0, maxRecommendations)) {
        const normalizedLabel = recommendation.label.trim();
        if (!recommendation.id.trim() || !normalizedLabel) continue;
        const labelHash = hashLabel(normalizedLabel);
        const key = cacheKey({
          gameSessionId: input.gameSessionId,
          loopId: input.loopId,
          stateVersion: input.stateVersion,
          recommendationId: recommendation.id,
          labelHash,
          compilerVersion,
        });
        const controller = new AbortController();
        const startedAt = now();
        const envelope: TurnEnvelope = {
          loopId: input.loopId,
          turnId: createTurnId(),
          inputStateVersion: input.stateVersion,
          deadlineAt: new Date(startedAt + ttlMs).toISOString(),
        };
        const entry: PrefetchEntry = {
          key,
          gameSessionId: input.gameSessionId,
          loopId: input.loopId,
          stateVersion: input.stateVersion,
          recommendationId: recommendation.id,
          labelHash,
          controller,
          startedAt,
          expiresAt: startedAt + ttlMs,
          status: 'running',
          durationMs: 0,
          promise: Promise.resolve(undefined),
        };
        entries.set(key, entry);
        entry.promise = Promise.resolve()
          .then(() => options.compile({
            state: stateSnapshot,
            recommendation: { ...recommendation, label: normalizedLabel },
            envelope,
            signal: controller.signal,
          }))
          .then((result) => {
            if (controller.signal.aborted || entries.get(key) !== entry) return undefined;
            if (!result.brief || result.brief.compilerVersion !== compilerVersion) {
              entries.delete(key);
              if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
              return undefined;
            }
            entry.status = 'ready';
            entry.durationMs = Math.max(0, result.durationMs);
            return result;
          })
          .catch(() => {
            if (entries.get(key) === entry) entries.delete(key);
            if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
            return undefined;
          });
        entry.expiryTimer = setTimeout(
          () => cancelEntry(entry, 'semantic_prefetch_expired'),
          ttlMs,
        );
        entry.expiryTimer.unref?.();
      }
    },

    async claim(input) {
      purgeExpired();
      const labelHash = hashLabel(input.label.trim());
      const key = cacheKey({ ...input, labelHash, compilerVersion });
      const entry = entries.get(key);
      if (!entry) {
        const sessionEntries = [...entries.values()].filter((candidate) => (
          candidate.gameSessionId === input.gameSessionId
        ));
        const stale = sessionEntries.some((candidate) => (
          candidate.gameSessionId === input.gameSessionId
          && candidate.recommendationId === input.recommendationId
        ));
        if (sessionEntries.length > 0) {
          cancelSession(
            input.gameSessionId,
            stale ? 'semantic_prefetch_stale' : 'semantic_prefetch_miss',
          );
        }
        if (stale) {
          counters.semantic_prefetch_stale += 1;
          return { status: 'stale' };
        }
        counters.semantic_prefetch_miss += 1;
        return { status: 'miss' };
      }

      cancelSiblings(input.gameSessionId, key);
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      const hitStatus = entry.status === 'ready' ? 'ready_hit' as const : 'inflight_hit' as const;
      const claimedAt = now();
      const result = await entry.promise;
      entries.delete(key);
      if (!result?.brief) {
        counters.semantic_prefetch_miss += 1;
        return { status: 'miss' };
      }

      const savedCompilerMs = hitStatus === 'ready_hit'
        ? entry.durationMs
        : Math.max(0, Math.min(result.durationMs, claimedAt - entry.startedAt));
      counters[hitStatus === 'ready_hit'
        ? 'semantic_prefetch_ready_hit'
        : 'semantic_prefetch_inflight_hit'] += 1;
      counters.savedCompilerMs += savedCompilerMs;
      return {
        status: hitStatus,
        brief: result.brief,
        savedCompilerMs,
      };
    },

    cancelSession,
    pendingCount: () => entries.size,
    metrics: () => ({ ...counters }),
  };
}

function cacheKey(input: {
  gameSessionId: string;
  loopId: string;
  stateVersion: number;
  recommendationId: string;
  labelHash: string;
  compilerVersion: string;
}): string {
  return [
    input.gameSessionId,
    input.loopId,
    input.stateVersion,
    input.recommendationId,
    input.labelHash,
    input.compilerVersion,
  ].join('|');
}

function hashLabel(label: string): string {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}
