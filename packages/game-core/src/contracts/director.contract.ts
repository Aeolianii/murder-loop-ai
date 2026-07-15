import { DirectorAgentInputSchema, DirectorOutputSchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const directorContract: ArtifactContract = {
  version: '1.0.0',
  input: DirectorAgentInputSchema as ArtifactContract['input'],
  output: DirectorOutputSchema as ArtifactContract['output'],
  validate: true,
};
