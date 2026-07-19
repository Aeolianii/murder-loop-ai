import type { AgentRegistration } from '../events/AgentRegistry';
import { directorContract } from '../contracts/director.contract';

/**
 * 异步叙事 Critic。它只产生诊断产物，不参与规则裁决、叙事放行或当前回合响应。
 */
export const DirectorAgent: AgentRegistration = {
  id: 'director',
  subscriptions: [
    { event: 'NarrationCritiqueRequested', priority: 80, role: 'reviewer', defer: true },
  ],
  contract: directorContract,
  handler: async (_input: unknown) => {
    // AI handler 由服务端 adapter 在 createHarness 时注入
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (_input: unknown) => ({
    score: { pacing: 7, infoLeak: 10, ruleConsistency: 10, prose: 6 },
    passed: true,
    violations: [],
  }),
  mode: 'fallback',
};
