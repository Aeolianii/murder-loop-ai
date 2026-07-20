# Phase 7: Generic Event Model

## Outcome

The AI-facing world-model contract now uses mechanism-level events instead of
story-specific event types.

Adding a new story fact does not require adding a new event type. A proposal
describes the reusable mechanic and puts story data in structured fields:

```json
{
  "kind": "action",
  "actorId": "actor-id",
  "operation": "photograph",
  "targetIds": ["object-id"],
  "status": "completed",
  "assertions": [
    {
      "id": "assertion-1",
      "subject": "artifact-id",
      "predicate": "exists",
      "value": true,
      "visibleTo": ["player"]
    }
  ]
}
```

The six event kinds are:

- `action`
- `state_transition`
- `information_transfer`
- `observation`
- `timer`
- `ending`

These are mechanism categories, not a list of story outcomes. `operation` is a
reusable mechanic such as `move`, `enter`, `attack`, `change_status`,
`communicate`, or `resolve_ending`.

## Assertion provenance

AI proposals no longer author canonical Fact IDs.

1. Each event owns structured assertions.
2. Proposal-local assertion IDs are unique.
3. Observations cite `visibleAssertionIds` from visible source events.
4. Clues cite `claimAssertionIds` exposed by their source observations.
5. Display fragments cite event IDs and assertion IDs.
6. The local `canonicalFactIdForAssertion(eventId, assertionId)` factory creates
   stable canonical Fact IDs at the validated projection/commit boundary.

Predicates and natural-language summaries are descriptive values. They are
never foreign keys.

## Generic local checks

The Shadow Arbiter checks:

- strict v3 schema conformance;
- unique event and assertion IDs;
- proposal actor ownership (`event.actorId === proposal.actorId`);
- event, effect, observation, assertion, clue, recommendation, and display
  reference integrity;
- assertion visibility through the cited source event;
- fact authorization for proposal inputs and preconditions;
- causal chains and deterministic evidence for high-risk events.

The server takeover authority gate uses domain-to-event-kind policy plus actor
ownership. It does not contain scenario actor names or story event types.
Actor-controlled operations are checked against capability values projected
from scenario character data. Capability ownership is indexed by the canonical
actor subject, so viewer/communication aliases do not need story-specific
branches in the Arbiter.

## Compatibility boundary

Legacy `DomainEvent.eventType` and `DomainEvent.facts` still exist behind the
low-risk reducer because the old harness and debug comparison consume them.
They are not part of the AI proposal contract.

The existing high-risk `GameState` reducer still contains scenario-shaped state
fields and some scenario entity/location checks. Moving those values into
scenario capability, entity, and invariant policy data is a separate migration.
This phase deliberately does not claim that the old state model is generic.
Legacy world snapshots that predate character capabilities are backfilled from
the scenario's initial world data when they enter the deterministic world layer.

## Verification

- AI contracts test legacy `eventType/facts` rejection.
- Fact factory tests stable IDs and cross-event separation.
- Arbiter tests assertion provenance and actor mismatch rejection.
- Prompt tests reject story-specific tokens.
- Game-core and server suites cover low-risk, knowledge/clue, high-risk, and
  atomic commit regressions.
