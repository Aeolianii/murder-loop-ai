import type {
  Fact,
  ProposedAssertion,
  ProposedEvent,
} from '@murder-loop-ai/ai-contracts';

export function assertionValue(
  event: ProposedEvent | undefined,
  predicate: string,
  subject?: string,
): ProposedAssertion['value'] | undefined {
  return event?.assertions.find((assertion) => (
    assertion.predicate === predicate
    && (subject === undefined || assertion.subject === subject)
  ))?.value;
}

export function assertionIds(event: ProposedEvent): string[] {
  return event.assertions.map((assertion) => assertion.id);
}

export function canonicalFactIdForAssertion(eventId: string, assertionId: string): string {
  return `fact:${encodeURIComponent(eventId)}:${encodeURIComponent(assertionId)}`;
}

export function materializeEventFacts(event: ProposedEvent, validFromTurn: string): Fact[] {
  return event.assertions.map((assertion) => ({
    id: canonicalFactIdForAssertion(event.id, assertion.id),
    subject: assertion.subject,
    predicate: assertion.predicate,
    value: assertion.value,
    sourceEventId: event.id,
    visibleTo: [...assertion.visibleTo],
    knownBy: [...new Set([
      event.actorId,
      ...assertion.visibleTo.filter((viewerId) => viewerId !== 'public'),
    ])],
    validFromTurn,
    invalidatedBy: null,
  }));
}
