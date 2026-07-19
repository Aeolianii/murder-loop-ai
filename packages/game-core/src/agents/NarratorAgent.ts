import {
  createFallbackActionNarrationFromConfirmedFacts,
  createFallbackAmbientNarrationFromConfirmedFacts,
  sanitizeNarration,
} from '../narration/fallbackNarration';
import type { AgentRegistration } from '../events/AgentRegistry';
import { narratorContract } from '../contracts/narrator.contract';
import type { NarrationContext } from '@murder-loop-ai/shared';

/**
 * 叙事 Agent。
 * 将游戏事件转化为悬疑小说风格的叙事文本。
 * - AI 模式：调用 LLM 生成文学化的叙事
 * - fallback 模式：基于模板的本地叙事生成
 *
 * 输出分为两个通道：
 * - actionNarration：玩家行动的结果叙事
 * - ambientNarration：环境/凶手行动的氛围叙事
 */
export const NarratorAgent: AgentRegistration = {
  id: 'narrator',
  subscriptions: [{ event: 'NarrationRequested', priority: 70, role: 'primary' }],
  contract: narratorContract,
  handler: async (_input: unknown) => {
    // AI handler 由服务端 adapter 在 createHarness 时注入
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (input: unknown) => {
    const { narrationContext } = input as { narrationContext: NarrationContext };
    const rawAction = createFallbackActionNarrationFromConfirmedFacts(narrationContext);
    const rawAmbient = createFallbackAmbientNarrationFromConfirmedFacts(narrationContext);
    return {
      actionNarration: sanitizeNarration(rawAction),
      ambientNarration: sanitizeNarration(rawAmbient),
    };
  },
  mode: 'fallback',
};
