import {
  RecommenderAgentInputSchema,
  RecommendedActionsSchema,
} from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const recommenderContract: ArtifactContract = {
  version: '1.0.0',
  input: RecommenderAgentInputSchema as ArtifactContract['input'],
  output: RecommendedActionsSchema as ArtifactContract['output'],
  validate: true,
};
