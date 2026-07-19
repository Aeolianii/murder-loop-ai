import { chooseFallbackKillerStrategy } from '../killer/fallbackStrategy';
import type { AgentRegistration } from '../events/AgentRegistry';
import { killerContract } from '../contracts/killer.contract';
import type { KillerDecisionContext } from '../killer/knowledge';

/**
 * 凶手 Agent（陈怀民）。
 * 在玩家行动执行后制定对抗策略。
 * - AI 模式：调用 LLM 在有限信息下制定策略
 * - fallback 模式：基于状态机 + 优先级的本地规则
 *
 * 关键约束：凶手只能消费 ContextBuilder 生成的 KillerDecisionContext，
 * AI 与 fallback 的函数签名都不接收完整 GameState。
 */
export const KillerAgent: AgentRegistration = {
  id: 'killer',
  subscriptions: [{ event: 'RulesApplied', priority: 30, role: 'primary' }],
  contract: killerContract,
  handler: async (_input: unknown) => {
    // AI handler 由服务端 adapter 在 createHarness 时注入
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (input: unknown) => {
    const { killerContext } = input as { killerContext: KillerDecisionContext };
    return chooseFallbackKillerStrategy(killerContext);
  },
  mode: 'fallback',
};
