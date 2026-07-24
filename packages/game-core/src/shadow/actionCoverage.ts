import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';

const NON_ACTIONABLE_CHARACTER_STATUSES = new Set([
  'dead',
  'incapacitated',
  'unconscious',
  'arrested',
  'fled',
]);

const ACTION_CAPABILITY_PREDICATES = new Set([
  'can_act',
  'action_capable',
  'action_capability',
]);

export interface OrderedActionCoverage {
  resolvedActionIds: Set<string>;
  interruptedActionIds: Set<string>;
  unresolvedActionIds: string[];
  terminalEventByInterruptedActionId: Map<string, ProposedEvent>;
}

/**
 * Evaluates action coverage from the contract itself. A completed scene ending
 * or a structured loss of action capability terminates every later ordered
 * action, regardless of the story-specific event involved.
 */
export function evaluateOrderedActionCoverage(
  requiredActionIds: string[],
  events: ProposedEvent[],
): OrderedActionCoverage {
  const requiredIndex = new Map(
    requiredActionIds.map((actionId, index) => [actionId, index]),
  );
  const resolvedActionIds = new Set(events.flatMap((event) => (
    event.status === 'attempted' ? [] : event.sourceActionIds
  )));
  const interruptedActionIds = new Set<string>();
  const terminalEventByInterruptedActionId = new Map<string, ProposedEvent>();

  const terminalBoundaries = events
    .filter(isActionTerminatingEvent)
    .flatMap((event) => {
      const sourceIndexes = event.sourceActionIds
        .map((actionId) => requiredIndex.get(actionId))
        .filter((index): index is number => index !== undefined);
      if (sourceIndexes.length === 0) return [];
      return [{ event, boundary: Math.max(...sourceIndexes) }];
    })
    .sort((left, right) => left.boundary - right.boundary);

  for (const [index, actionId] of requiredActionIds.entries()) {
    if (resolvedActionIds.has(actionId)) continue;
    const terminal = terminalBoundaries.find(({ boundary }) => boundary < index);
    if (!terminal) continue;
    interruptedActionIds.add(actionId);
    resolvedActionIds.add(actionId);
    terminalEventByInterruptedActionId.set(actionId, terminal.event);
  }

  return {
    resolvedActionIds,
    interruptedActionIds,
    unresolvedActionIds: requiredActionIds.filter((actionId) => (
      !resolvedActionIds.has(actionId)
    )),
    terminalEventByInterruptedActionId,
  };
}

export function isActionTerminatingEvent(event: ProposedEvent): boolean {
  if (event.status !== 'completed') return false;
  if (event.kind === 'ending') return true;

  return event.assertions.some((assertion) => {
    const concernsActor = assertion.subject === event.actorId
      || event.targetIds.includes(assertion.subject);
    if (!concernsActor) return false;
    if (
      assertion.predicate === 'status'
      && typeof assertion.value === 'string'
      && NON_ACTIONABLE_CHARACTER_STATUSES.has(assertion.value)
    ) {
      return true;
    }
    return ACTION_CAPABILITY_PREDICATES.has(assertion.predicate)
      && assertion.value === false;
  });
}
