import { fallbackNpcReply } from '../npc/fallbackNpc';
import { buildNpcInboundMessages } from '../npc/npcInboundMessage';
import type { AgentRegistration } from '../events/AgentRegistry';
import type { ActionPlan, GameState } from '@murder-loop-ai/shared';

/**
 * NPC 回复 Agent。
 * 处理 NPC（林越、陈怀民等）对玩家消息的回复。
 * - AI 模式：调用 LLM 生成角色一致的回复
 * - fallback 模式：基于角色模板的本地回复
 */
export const NpcAgent: AgentRegistration = {
  id: 'npc',
  subscriptions: [{ event: 'ActionParsed', priority: 25, role: 'observer' }],
  contract: {
    version: '1.0.0',
    input: null as never,
    output: null as never,
    validate: false,
  },
  handler: async (_input: unknown) => {
    // AI handler 由服务端 adapter 在 createHarness 时注入
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (input: unknown) => {
    const payload = input as { plan?: ActionPlan; state: GameState };
    const plan = payload.plan;
    const state = payload.state;
    if (!plan) return null;
    const message = buildNpcInboundMessages(plan)[0];
    return message ? fallbackNpcReply(message.speaker, message.text, state) : null;
  },
  mode: 'fallback',
};
