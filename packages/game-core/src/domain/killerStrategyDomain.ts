import type { GameState, KillerStrategy } from '@murder-loop-ai/shared';
import type { DomainEvent, DomainTimestamp, SimulationIntent } from './domainEvents';

export function buildKillerStrategyIntent(
  strategy: KillerStrategy,
  createdAt: DomainTimestamp,
): SimulationIntent {
  return {
    id: `intent.${strategy.id}`,
    kind: 'simulation_intent',
    source: 'killer',
    createdAt,
    intentType: 'killer_plan_proposed',
    proposer: 'killer',
    actorId: 'chen_huaimin',
    strategy: { ...strategy },
    rationale: strategy.rationale,
    requiresDomainReview: true,
  };
}

export function confirmKillerStrategyIntent(
  state: GameState,
  intent: SimulationIntent,
): DomainEvent {
  if (
    intent.intentType !== 'killer_plan_proposed'
    || intent.proposer !== 'killer'
    || !intent.strategy
  ) {
    throw new Error('Cannot confirm a non-killer strategy intent.');
  }

  const strategy = intent.strategy;
  return {
    id: `domain.killer_strategy_applied.${strategy.id}`,
    kind: 'domain_event',
    source: 'rule',
    createdAt: { run: state.run, minute: state.minute },
    causationId: intent.id,
    correlationId: intent.correlationId ?? strategy.id,
    eventType: 'killer_strategy_applied',
    authority: 'game',
    subject: strategy.type,
    summary: `Rules confirmed killer strategy attempt: ${strategy.type}.`,
    facts: [`killer_strategy:${strategy.type}`, 'killer_strategy_confirmed'],
    visibility: strategy.visibleToPlayer ? 'player' : 'hidden',
    actorIds: ['chen_huaimin'],
    payload: { strategy: { ...strategy } },
  };
}

export function readKillerStrategyFromDomainEvent(event: DomainEvent): KillerStrategy {
  if (event.eventType !== 'killer_strategy_applied' || event.authority !== 'game') {
    throw new Error('Killer strategy reducer requires an authoritative killer_strategy_applied event.');
  }

  const strategy = event.payload?.strategy;
  if (!isKillerStrategy(strategy)) {
    throw new Error('killer_strategy_applied event is missing a valid strategy payload.');
  }
  return { ...strategy };
}

export function buildKillerOutcomeDomainEvents(
  confirmedEvent: DomainEvent,
  before: GameState,
  after: GameState,
): DomainEvent[] {
  const events: DomainEvent[] = [confirmedEvent];

  if (after.threat !== before.threat) {
    events.push({
      id: `domain.threat_changed.${confirmedEvent.id}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: { run: after.run, minute: after.minute },
      causationId: confirmedEvent.id,
      correlationId: confirmedEvent.correlationId,
      eventType: 'threat_changed',
      authority: 'game',
      subject: 'threat',
      summary: `Threat changed from ${before.threat} to ${after.threat}.`,
      facts: [`threat:${after.threat}`, `threat_delta:${after.threat - before.threat}`],
      visibility: confirmedEvent.visibility,
      payload: {
        before: before.threat,
        after: after.threat,
        delta: after.threat - before.threat,
      },
    });
  }

  if (after.ending && after.ending !== before.ending && after.endingReason) {
    events.push({
      id: `domain.ending_reached.${confirmedEvent.id}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: { run: after.run, minute: after.minute },
      causationId: confirmedEvent.id,
      correlationId: confirmedEvent.correlationId,
      eventType: 'ending_reached',
      authority: 'game',
      subject: after.ending,
      summary: `Rules confirmed ending ${after.ending}.`,
      facts: [`ending:${after.ending}`, `ending_reason:${after.endingReason}`],
      visibility: 'player',
      ending: { id: after.ending, reason: after.endingReason },
    });
  }

  return events;
}

function isKillerStrategy(value: unknown): value is KillerStrategy {
  if (!value || typeof value !== 'object') return false;
  const strategy = value as Record<string, unknown>;
  return typeof strategy.id === 'string'
    && typeof strategy.type === 'string'
    && typeof strategy.title === 'string'
    && typeof strategy.rationale === 'string'
    && typeof strategy.visibleToPlayer === 'boolean'
    && (strategy.risk === 'low' || strategy.risk === 'medium' || strategy.risk === 'high')
    && (strategy.responseHint === undefined || typeof strategy.responseHint === 'string');
}
