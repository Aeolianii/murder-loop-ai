import type { DisplayFragment } from '@murder-loop-ai/ai-contracts';
import type { PreparedLowRiskTurn } from '@murder-loop-ai/game-core';
import type {
  GameState,
  Narration,
  TurnResolution,
} from '@murder-loop-ai/shared';

export function buildConfirmedAiFirstResolution(input: {
  prepared: PreparedLowRiskTurn;
  state: GameState;
  displayFragments: DisplayFragment[];
  publishedEventIds: Set<string>;
}): TurnResolution {
  const confirmedOutcomeText = input.displayFragments
    .filter((fragment) => fragment.eventRefs.some((eventId) => input.publishedEventIds.has(eventId)))
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
      events: [],
      state: input.state,
    },
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    npcReply: null,
    recommendedActions: [],
    worldTickTrace: [],
    finalState: input.state,
  };
}
