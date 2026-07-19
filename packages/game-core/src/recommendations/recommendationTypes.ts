import type {
  Narration,
  NarrationContext,
  NpcReply,
  RecommendedAction,
} from '@murder-loop-ai/shared';

export interface RecommendationContext {
  playerInput: string;
  planSummary: string;
  actionNarration: Narration;
  ambientNarration: Narration;
  npcReply: NpcReply | null;
  confirmedFacts: NarrationContext['confirmedFacts'];
  confirmedWorldEvents: NonNullable<NarrationContext['confirmedWorldEvents']>;
  visibleState: {
    run: number;
    minute: number;
    injury: NarrationContext['stateSnapshot']['injury'];
    stress: number;
    ending: NarrationContext['stateSnapshot']['ending'];
    phoneBattery: number;
    phoneFunctional: boolean;
    playerHolding: string | null;
  };
  knownClueTitles: string[];
}

export interface RecommendationRequest {
  recommendationContext: RecommendationContext;
  fallbackActions: RecommendedAction[];
}
