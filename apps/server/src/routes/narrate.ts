import type { FastifyInstance } from 'fastify';
import { NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { createFallbackActionNarration, createFallbackAmbientNarration, createFallbackNarration, sanitizeNarration } from '@murder-loop-ai/game-core';
import type { NarrationContext, RuleResult } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';

type NarrationMode = 'mixed' | 'action' | 'ambient';

function systemPromptFor(mode: NarrationMode) {
  if (mode === 'action') {
    return [
      '你是《23:47》的“行动回应”作者。只写玩家这次动作的落地结果，不负责下一波环境推进。',
      '只能使用 narrationContext.events 里的事实。不要新增证据，不改变时间、生死、NPC 状态，不让角色突然进场。',
      '目标是让玩家感到输入被认真执行：动作顺序、物体变化、代价、遗漏和可利用信息都要具体。',
      '文风参考悬疑网文：段落有推进，句子有钩子，但不要中二，不要空喊恐惧。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
      '结构：动作落地 -> 现场变化 -> 风险/收益 -> 一个小钩子。不要写系统、规则、判定、数值、AI、fallback。',
      '可以有极短第一人称反应，但不能替玩家悟出真相，不能泄露凶手内心。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '每次 220 到 520 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  }

  if (mode === 'ambient') {
    return [
      '你是《23:47》的“环境播报/暗线镜头”。只写门外、楼道、手机、时间、来电、灯光、窗外等环境变化。',
      '只能使用 narrationContext.events 中的环境、threat、sound、message、state_change、ending 类事实。不能新增关键证据，不能让角色突然进场，不能改变规则结果。',
      '不要复述玩家动作细节，不要写玩家心理，不要解释凶手计划。你只呈现玩家能直接感知的现象。',
      '节奏短促、有镜头感：每次只推进一个压力点。不要每回合都大爆发，安静、停顿、误导同样重要。',
      '不要写玩家心理，不要解释凶手计划，不要用上帝视角。只写玩家能看见、听见、摸到、闻到，或现场能直接判断的变化。',
      '语言像悬疑网文的收尾钩子，但保持现实主义：门锁、楼道灯、雨声、电表箱、手机冷光、猫眼、脚步距离。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '每次 90 到 240 个中文字符。最后一句停在一个可观察压力点上。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  }

  return [
    '你是《23:47》的限知叙事作者。你的任务是把规则事件写成有张力的悬疑网文段落。',
    '只能使用 narrationContext 里的事件、状态快照、禁止事项和风格指南。规则层 fallback 文本不会提供给你；如果事件很少，也只写可观察的环境变化。',
    '必须严格遵守 narrationContext.events：不能新增关键证据，不能改变生死结果，不能替玩家执行没做过的行动。',
    '视角限制：只写玩家当下能看见、听见、摸到、闻到，或能从现场直接判断出的现实反馈；不要给上帝视角，不要透露凶手内心。',
    '禁止替玩家写心理感受、恐惧、担忧、明白了什么、意识到什么、我觉得什么。不要写“我害怕/我明白/我意识到/我开始觉得/我能感觉到”。',
    '可以写玩家身体的外部可观察反应，例如手停顿、呼吸变浅、动作放慢，但不要解释这些动作背后的心理。',
    '重要：events 是事实素材，不是要你逐条复述的列表。禁止出现“系统”“规则”“收束”“玩家”“行动判定”“fallback”等游戏开发词。',
    '每次回复 180 到 420 个中文字符。信息密度要高，每句话都提供新的现实变化或可操作线索。',
    '语言要求：具体、克制、现实主义。多写声音、光线、距离、位置、物体状态、他人行为和时间变化，少写形容词。',
    '结构要求：先写玩家动作造成的外部结果，再写环境/NPC/门窗/手机的新变化，最后停在一个现实可观察的压力点上；不要总结主题，不要升华。',
    '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
    '只输出 JSON：{"title":"...","text":"..."}。',
  ].join('\n');
}

async function narrate(body: { context?: NarrationContext; playerResult: RuleResult; killerResult: RuleResult; state?: unknown }, mode: NarrationMode) {
  const fallback =
    mode === 'action'
      ? createFallbackActionNarration(body.playerResult)
      : mode === 'ambient'
        ? createFallbackAmbientNarration(body.playerResult, body.killerResult)
        : createFallbackNarration(body.playerResult, body.killerResult);

  const ai = await completeRoleJson('narrator', systemPromptFor(mode), { narrationContext: body.context }, { temperature: mode === 'mixed' ? 0.68 : 0.76 }).catch(() => null);

  const parsed = NarrationSchema.safeParse(ai);
  return parsed.success ? sanitizeNarration(parsed.data) : fallback;
}

export async function narrateRoute(app: FastifyInstance) {
  app.post('/api/narrate', async (request) => {
    const body = request.body as { context?: NarrationContext; playerResult: RuleResult; killerResult: RuleResult; state?: unknown };
    return narrate(body, 'mixed');
  });

  app.post('/api/narrate-action', async (request) => {
    const body = request.body as { context?: NarrationContext; playerResult: RuleResult; killerResult: RuleResult; state?: unknown };
    return narrate(body, 'action');
  });

  app.post('/api/narrate-ambient', async (request) => {
    const body = request.body as { context?: NarrationContext; playerResult: RuleResult; killerResult: RuleResult; state?: unknown };
    return narrate(body, 'ambient');
  });
}
