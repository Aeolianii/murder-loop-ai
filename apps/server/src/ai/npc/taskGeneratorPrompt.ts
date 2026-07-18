import type { IntentOutput, ObjectiveState, SubjectiveState, NpcLastPlan } from '@murder-loop-ai/game-core';

export function buildTaskGeneratorSystemPrompt(): string {
  return `你是一个 NPC 任务规划引擎。唯一任务：给定NPC意图和当前世界状态，生成一组原子动作序列。
只输出 JSON：{"intent":"与输入相同的意图标签","tasks":[{"action":"move|wait|observe|communicate|use_object|investigate|pick_up|hide|report","target":"目标实体ID","reason":"一句话","priority":1-10,"precondition":"可选"}],"destination":"可选LocationId","newStatus":"可选active|waiting|moving","newAction":"可选"}
动作类型：move=移动到相邻位置，wait=原地停留，observe=扫描获取信息，communicate=发消息，use_object=使用物品，investigate=仔细检查，pick_up=拿起物品，hide=隐藏，report=向当局报告
核心约束：最多6个任务。动作必须原子——move=一格。不描述不存在的位置/物品/角色（不幻觉）。按priority降序排列。`;
}

export function buildTaskGeneratorUserPayload(intentOutput: IntentOutput, objective: ObjectiveState, subjective: SubjectiveState, othersLastPlans?: Record<string, NpcLastPlan>): string {
  const payload: Record<string, unknown> = {
    intentFromInterpreter: { intent: intentOutput.intent, attentionWeights: intentOutput.attentionWeights, urgency: intentOutput.urgency, reasoning: intentOutput.reasoning },
    myState: { id: subjective.npcId, name: subjective.name, location: subjective.location, goalStack: subjective.goalStack, status: subjective.status },
    worldSnapshot: { minute: objective.minute, threat: objective.threat, locations: objective.locations, objects: objective.objects, characters: objective.characters },
  };
  if (othersLastPlans && Object.keys(othersLastPlans).length > 0) {
    payload.othersLastPlans = Object.fromEntries(Object.entries(othersLastPlans).map(([id, plan]) => [id, { intent: plan.intent, destination: plan.destination || null }]));
  }
  return JSON.stringify(payload, null, 2);
}
