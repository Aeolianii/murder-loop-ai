import type { ProposedEvent } from '@murder-loop-ai/ai-contracts';

export interface OrderedActionCoverage {
  resolvedActionIds: Set<string>;
  interruptedActionIds: Set<string>;
  unresolvedActionIds: string[];
  terminalEventByInterruptedActionId: Map<string, ProposedEvent>;
}

/**
 * Evaluates action coverage from the contract itself. A completed ending event
 * terminates every later ordered action, regardless of the story-specific
 * action or ending involved.
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
    .filter((event) => event.kind === 'ending' && event.status === 'completed')
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
