import type { AgentRegistration } from '../events/AgentRegistry';
import { directorContract } from '../contracts/director.contract';

/**
 * 导演 Agent。
 * 评估叙事质量并在高风险场景中进行仲裁。
 *
 * 两阶段设计：
 * - Phase 1（硬守卫，同步，<5ms）：检查规则一致性 + 信息泄露
 *   通过 → 叙事放行。不通过 → 拦截，触发重写。
 * - Phase 2（软评分，异步，2秒超时）：评估文笔 + 节奏
 *   2秒内返回 → 可本回合重写。超时 → 结果指导下回合 Prompt。
 *
 * 同时在高风险场景（报警核验等）中担任仲裁角色。
 */
export const DirectorAgent: AgentRegistration = {
  id: 'director',
  subscriptions: [
    { event: 'NarrationDone', priority: 80, role: 'primary' },
    { event: 'HighRiskScenarioDetected', priority: 15, role: 'reviewer' },
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
    moodSignal: '你感觉这一次的判断还算稳妥。',
  }),
  mode: 'fallback',
};
