import type { NpcAdapter } from '@murder-loop-ai/game-core';
import { IntentOutputSchema, TaskPlanSchema } from '@murder-loop-ai/ai-contracts';
import { completeRoleJson } from '../openaiClient';
import { buildIntentInterpreterSystemPrompt, buildIntentInterpreterUserPayload } from './intentInterpreterPrompt';
import { buildTaskGeneratorSystemPrompt, buildTaskGeneratorUserPayload } from './taskGeneratorPrompt';

export function createNpcAdapter(): NpcAdapter {
  return {
    async processNpc(input) {
      const { npcId, objectiveState, subjectiveState, othersLastPlans } = input;
      const intentRaw = await completeRoleJson<unknown>('npc_intent', buildIntentInterpreterSystemPrompt(), buildIntentInterpreterUserPayload(objectiveState, subjectiveState, othersLastPlans), { temperature: 0.4 });
      if (!intentRaw) throw new Error(`[NPC ${npcId}] IntentInterpreter returned null`);
      const intent = IntentOutputSchema.parse(intentRaw);
      const planRaw = await completeRoleJson<unknown>('npc_task', buildTaskGeneratorSystemPrompt(), buildTaskGeneratorUserPayload(intent, objectiveState, subjectiveState, othersLastPlans), { temperature: 0.3 });
      if (!planRaw) throw new Error(`[NPC ${npcId}] TaskGenerator returned null`);
      const plan = TaskPlanSchema.parse(planRaw);
      return { npcId, plan: { tick: objectiveState.minute, ...plan } };
    },
  };
}
