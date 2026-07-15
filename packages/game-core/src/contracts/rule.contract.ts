import { RuleAgentInputSchema, RuleResultSchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const ruleContract: ArtifactContract = {
  version: '1.0.0',
  input: RuleAgentInputSchema as ArtifactContract['input'],
  output: RuleResultSchema as ArtifactContract['output'],
  validate: true,
};
