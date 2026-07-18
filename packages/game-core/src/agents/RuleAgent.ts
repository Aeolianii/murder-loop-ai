import { applyPlayerActions } from '../rules/applyPlayerActions';
import { applyKillerStrategy } from '../killer/applyKillerStrategy';
import type { AgentRegistration } from '../events/AgentRegistry';
import type { ActionPlan, GameState, KillerStrategy } from '@murder-loop-ai/shared';
import { ruleContract } from '../contracts/rule.contract';

/**
 * 规则系统 Agent。
 * 纯确定性逻辑，不调用 AI。负责：
 * 1. 在 ActionParsed 后执行玩家行动效果
 * 2. 在 KillerActed 后校验凶手策略的合法性
 */
export const RuleAgent: AgentRegistration = {
  id: 'rule',
  subscriptions: [
    { event: 'ActionParsed', priority: 20, role: 'primary' },
    { event: 'KillerActed', priority: 60, role: 'primary' },
  ],
  contract: ruleContract,
  handler: async (input: unknown, event) => {
    // RuleAgent 始终使用确定性逻辑，不调用 AI
    return RuleAgent.fallback(input, event);
  },
  fallback: async (input: unknown, event) => {
    const payload = input as Record<string, unknown>;
    if (event?.type === 'ActionParsed') {
      return applyPlayerActions(payload.state as GameState, payload.plan as ActionPlan);
    }
    if (event?.type === 'KillerActed') {
      return applyKillerStrategy(
        payload.state as GameState,
        payload.killerStrategy as KillerStrategy,
      );
    }
    return null;
  },
  mode: 'fallback',
};
