import { randomUUID } from 'node:crypto';
import type { TurnEnvelope } from '@murder-loop-ai/ai-contracts';
import {
  finalizeShadowRun,
  runShadowCandidateWave,
  type FinalizeShadowRunInput,
  type LegacyEventSnapshot,
  type RunShadowCandidateWaveInput,
  type ShadowCandidateWave,
  type ShadowRunAdapters,
  type ShadowRunReport,
} from '@murder-loop-ai/game-core';
import type { GameState, RuleEvent, TurnResolution, WorldEvent } from '@murder-loop-ai/shared';
import { createAiShadowAdapters } from '../ai/shadowAiAdapters';
import { shadowReportStore, type ShadowReportStore } from './shadowReportStore';

const SHADOW_NPC_IDS = ['lin_yue', 'police_dispatch'];
const CANONICAL_SHADOW_CONSTRAINTS = [
  'canonical.rule_kernel_is_authoritative',
  'canonical.knowledge_projection_isolation',
  'canonical.narration_is_non_authoritative',
  'canonical.high_risk_requires_deterministic_evidence',
];

export interface ShadowRunSession {
  envelope: TurnEnvelope;
  wave: Promise<ShadowCandidateWave>;
}

export interface ShadowRunCoordinator {
  start(input: { rawInput: string; state: GameState }): ShadowRunSession;
  complete(session: ShadowRunSession, resolution: TurnResolution): Promise<void>;
}

export interface ShadowRunCoordinatorOptions {
  adapters?: ShadowRunAdapters;
  store?: ShadowReportStore;
  deadlineMs?: number;
  compilerTimeoutMs?: number;
  now?: () => Date;
  createTurnId?: () => string;
  runCandidateWave?: (input: RunShadowCandidateWaveInput) => Promise<ShadowCandidateWave>;
  finalize?: (input: FinalizeShadowRunInput) => ShadowRunReport;
}

export function createShadowRunCoordinator(
  options: ShadowRunCoordinatorOptions = {},
): ShadowRunCoordinator {
  const adapters = options.adapters ?? createAiShadowAdapters();
  const store = options.store ?? shadowReportStore;
  const deadlineMs = positiveDuration(options.deadlineMs, 6_000);
  const compilerTimeoutMs = positiveDuration(options.compilerTimeoutMs, 1_000);
  const now = options.now ?? (() => new Date());
  const createTurnId = options.createTurnId ?? (() => `shadow-${randomUUID()}`);
  const runCandidateWave = options.runCandidateWave ?? runShadowCandidateWave;
  const finalize = options.finalize ?? finalizeShadowRun;
  let latestObserved: {
    run: number;
    loopId: string;
    stateVersion: number;
    committedTurnIds: string[];
  } | undefined;

  return {
    start({ rawInput, state }) {
      const startedAt = now();
      const envelope: TurnEnvelope = {
        loopId: `legacy-run-${state.run}`,
        turnId: createTurnId(),
        inputStateVersion: deriveLegacyShadowStateVersion(state),
        deadlineAt: new Date(startedAt.getTime() + deadlineMs).toISOString(),
      };
      const observedVersion = deriveLegacyShadowStateVersion(state);
      if (
        !latestObserved
        || state.run > latestObserved.run
        || (state.run === latestObserved.run && observedVersion >= latestObserved.stateVersion)
      ) {
        latestObserved = {
          run: state.run,
          loopId: envelope.loopId,
          stateVersion: observedVersion,
          committedTurnIds: [],
        };
      }
      store.begin(envelope);
      const wave = runCandidateWave({
        state: structuredClone(state),
        rawInput,
        envelope,
        adapters,
        npcIds: SHADOW_NPC_IDS,
        canonicalConstraints: CANONICAL_SHADOW_CONSTRAINTS,
        compilerTimeoutMs,
      });
      return { envelope, wave };
    },

    async complete(session, resolution) {
      try {
        const wave = await session.wave;
        if (wave.status === 'compiler_unavailable') {
          store.complete(session.envelope.turnId, {
            kind: 'compiler_unavailable',
            envelope: session.envelope,
            semantic: wave.semantic,
          });
          return;
        }
        const report = finalize({
          wave,
          legacyPlan: resolution.plan,
          legacyEvents: legacyEventsFromResolution(resolution, session.envelope.turnId),
          current: latestObserved
            ? {
                loopId: latestObserved.loopId,
                stateVersion: latestObserved.stateVersion,
                committedTurnIds: [...latestObserved.committedTurnIds],
              }
            : {
                loopId: `legacy-run-${resolution.finalState.run}`,
                stateVersion: session.envelope.inputStateVersion,
                committedTurnIds: [],
              },
        });
        store.complete(session.envelope.turnId, { kind: 'completed', report });
      } catch (error) {
        if (store.get(session.envelope.turnId)) {
          store.fail(session.envelope.turnId, error);
        }
      }
    },
  };
}

export function deriveLegacyShadowStateVersion(state: GameState): number {
  return state.log.length + (state.world?.events.length ?? 0);
}

export function legacyEventsFromResolution(
  resolution: TurnResolution,
  turnId: string,
): LegacyEventSnapshot[] {
  const domainEvents = [
    ...domainEventsFrom(resolution.playerResult),
    ...domainEventsFrom(resolution.killerResult),
  ];
  const officialEvents = domainEvents.length > 0
    ? domainEvents
    : [
        ...ruleEventsFrom(resolution.playerResult.events, turnId, 'player'),
        ...ruleEventsFrom(resolution.killerResult.events, turnId, 'killer'),
      ];
  return [
    ...officialEvents,
    ...worldEventsFrom(resolution.worldTickTrace ?? []),
  ];
}

function domainEventsFrom(result: TurnResolution['playerResult']): LegacyEventSnapshot[] {
  const domainEvents = (
    result as TurnResolution['playerResult'] & {
      domainEvents?: Array<Pick<LegacyEventSnapshot, 'id' | 'eventType' | 'subject' | 'facts'>>;
    }
  ).domainEvents ?? [];
  return domainEvents.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    subject: event.subject,
    facts: [...event.facts],
  }));
}

function ruleEventsFrom(
  events: RuleEvent[],
  turnId: string,
  source: 'player' | 'killer',
): LegacyEventSnapshot[] {
  return events.map((event, index) => ({
    id: `legacy.${turnId}.${source}.${index}`,
    eventType: `rule.${event.kind}`,
    subject: event.subject,
    facts: [event.summary, ...event.sensoryHints],
  }));
}

function worldEventsFrom(events: WorldEvent[]): LegacyEventSnapshot[] {
  return events.map((event) => ({
    id: event.id,
    eventType: `world.${event.type}`,
    subject: event.actors.join(',') || event.location || 'world',
    facts: [...event.facts],
  }));
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}
