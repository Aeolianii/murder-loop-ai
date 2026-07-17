import { fallbackNpcReply } from '../npc/fallbackNpc';
import type { AgentRegistration } from '../events/AgentRegistry';
import type { GameState, NpcReply } from '@murder-loop-ai/shared';

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
    const payload = input as { plan?: { raw?: string; actions?: Array<{ intent: string; target?: string; method?: string; raw?: string }> }; state: GameState };
    const plan = payload.plan;
    const state = payload.state;
    // 检查是否有 NPC 通信意图
    const commIntent = plan?.actions?.find((i) => i.intent === 'communicate');
    if (commIntent?.target) {
      const speaker = commIntent.target as NpcReply['speaker'];
      return fallbackNpcReply(speaker, commIntent.raw ?? commIntent.method ?? plan?.raw ?? '', state);
    }
    return null;
  },
  mode: 'fallback',
};
