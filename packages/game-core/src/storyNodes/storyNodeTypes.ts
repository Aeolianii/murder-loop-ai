import type {
  ActionPlan,
  GamePhase,
  GameState,
  RecommendedAction,
  RuleResult,
} from '@murder-loop-ai/shared';

export interface StoryNodeResolution {
  storyNodeId: string;
  title: string;
  text: string;
  tone: RuleResult['tone'];
  addedClueIds: string[];
  recommendedActions: RecommendedAction[];
  timePassed: number;
  threatDelta: number;
  stressDelta?: number;
  phase?: GamePhase;
  statePatch?: (state: GameState) => void;
}

export interface StoryNodeDefinition {
  id: string;
  priority: number;
  resolve: (state: GameState, plan: ActionPlan) => StoryNodeResolution | null;
}
