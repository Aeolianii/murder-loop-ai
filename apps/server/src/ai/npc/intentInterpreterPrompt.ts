import type { ObjectiveState, SubjectiveState, NpcLastPlan } from '@murder-loop-ai/game-core';

export function buildIntentInterpreterSystemPrompt(): string {
  return `你是一个 NPC 意图推断引擎。唯一任务：根据当前世界状态，推断NPC在接下来一分钟内的核心意图。
只输出 JSON：{"intent":"简短英文标签","attentionWeights":{"player_activity":0-1,"other_npcs":0-1,"threat_level":0-1,"time_pressure":0-1,"own_goals":0-1},"urgency":1-10,"reasoning":"1-2句思维链","affectedFacts":["可选，最多8个"]}
约束：基于ObjectiveState公共事实+SubjectiveState私有知识推理。urgency=10只保留给生存威胁。attentionWeights各维度不必和为1。reasoning必须引用具体状态。`;
}

export function buildIntentInterpreterUserPayload(objective: ObjectiveState, subjective: SubjectiveState, othersLastPlans: Record<string, NpcLastPlan>): string {
  return JSON.stringify({
    currentMinute: objective.minute, overallThreat: objective.threat,
    npcIdentity: { id: subjective.npcId, name: subjective.name, faction: subjective.faction },
    myPrivateState: { location: subjective.location, goalStack: subjective.goalStack, risk: subjective.risk, riskTolerance: subjective.riskTolerance, suspicion: subjective.suspicion, stress: subjective.stress, currentAction: subjective.currentAction || null, status: subjective.status },
    publicWorld: { locations: objective.locations, objects: objective.objects, characters: objective.characters, recentEvents: objective.recentPublicEvents },
    otherNpcsLastPlans: Object.fromEntries(Object.entries(othersLastPlans).map(([id, plan]) => [id, { intent: plan.intent, destination: plan.destination || null, attention: plan.attentionWeights, tasks: plan.tasks.map((t) => ({ action: t.action, target: t.target, priority: t.priority })) }])),
  }, null, 2);
}
