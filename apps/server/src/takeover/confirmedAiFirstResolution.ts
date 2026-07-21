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
    title: confirmedOutcomeText ? '环境变化已确认' : '暂时没有新的危险变化',
    text: confirmedOutcomeText || '本回合没有新的高风险状态变化通过规则校验。',
  };

  return {
    plan: input.prepared.plan,
    playerResult: { ...input.prepared.playerResult, state: input.state },
    killerStrategy: {
      id: `phase6.${input.prepared.envelope.turnId}`,
      type: 'confirmed_shadow_result',
      title: ambientNarration.title,
      rationale: '仅采用已经通过规则校验的事件，不执行旧版状态路径。',
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
