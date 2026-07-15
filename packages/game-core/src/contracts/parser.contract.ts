import { ActionPlanSchema, ParserAgentInputSchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

export const parserContract: ArtifactContract = {
  version: '1.0.0',
  input: ParserAgentInputSchema as ArtifactContract['input'],
  output: ActionPlanSchema as ArtifactContract['output'],
  validate: true,
};
