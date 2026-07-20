import type { DisplayFragment } from '@murder-loop-ai/ai-contracts';
import type { PreparedLowRiskTurn } from '@murder-loop-ai/game-core';
import type {
  GameState,
  Narration,
  RecommendedAction,
  TurnResolution,
} from '@murder-loop-ai/shared';

export function buildConfirmedAiFirstResolution(input: {
  prepared: PreparedLowRiskTurn;
  state: GameState;
  displayFragments: DisplayFragment[];
  publishedEventIds: Set<string>;
  recommendedActions: RecommendedAction[];
}): TurnResolution {
  const preparedEventIds = new Set(
    input.prepared.eventCandidates.map((candidate) => candidate.event.id),
  );
  const ambientEventIds = new Set(
    [...input.publishedEventIds].filter((eventId) => !preparedEventIds.has(eventId)),
  );
  const confirmedOutcomeText = input.displayFragments
    .filter((fragment) => fragment.eventRefs.some((eventId) => ambientEventIds.has(eventId)))
    .map((fragment) => fragment.text)
    .join(' ');
  const actionNarration: Narration = {
    title: input.prepared.playerResult.title,
    text: input.prepared.playerResult.text,
  };
  const ambientNarration: Narration = {
    title: confirmedOutcomeText ? 'Confirmed world outcome' : 'No high-risk outcome confirmed',
    text: confirmedOutcomeText || 'No high-risk state change passed the deterministic gate.',
  };

  return {
    plan: input.prepared.plan,
    playerResult: { ...input.prepared.playerResult, state: input.state },
    killerStrategy: {
      id: `phase6.${input.prepared.envelope.turnId}`,
      type: 'confirmed_shadow_result',
      title: ambientNarration.title,
      rationale: 'Only confirmed AI-first events are authoritative; no legacy state path was executed.',
      visibleToPlayer: confirmedOutcomeText.length > 0,
      risk: confirmedOutcomeText ? 'high' : 'low',
    },
    killerResult: {
      title: ambientNarration.title,
      text: ambientNarration.text,
      tone: input.state.ending === 'death'
        ? 'death'
        : confirmedOutcomeText
          ? 'threat'
          : 'neutral',
      addedClues: [],
      timePassed: 0,
      threatDelta: 0,
      events: confirmedOutcomeText
        ? [{
            kind: 'state_change',
            subject: 'world',
            summary: confirmedOutcomeText,
            sensoryHints: [],
            visibility: 'player',
          }]
        : [],
      state: input.state,
    },
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    npcReply: null,
    recommendedActions: input.recommendedActions,
    worldTickTrace: [],
    finalState: input.state,
  };
}
