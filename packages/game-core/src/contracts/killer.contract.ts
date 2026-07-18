import { KillerAgentInputSchema, KillerStrategySchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const killerContract: ArtifactContract = {
  version: '1.0.0',
  input: KillerAgentInputSchema as ArtifactContract['input'],
  output: KillerStrategySchema as ArtifactContract['output'],
  validate: true,
};
