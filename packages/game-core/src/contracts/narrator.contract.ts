import { NarrationPairSchema, NarratorAgentInputSchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const narratorContract: ArtifactContract = {
  version: '1.0.0',
  input: NarratorAgentInputSchema as ArtifactContract['input'],
  output: NarrationPairSchema as ArtifactContract['output'],
  validate: true,
};
