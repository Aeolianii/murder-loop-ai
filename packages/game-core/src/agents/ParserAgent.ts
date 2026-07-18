import { fallbackParseAction } from '../actions/fallbackParser';
import type { AgentRegistration } from '../events/AgentRegistry';
import { parserContract } from '../contracts/parser.contract';

/**
 * 行动解析 Agent。
 * 将玩家的自然语言输入解析为结构化的行动方案。
 * - AI 模式：调用 LLM 解析（由服务端 adapter 注入）
 * - fallback 模式：基于关键词的本地规则解析
 */
export const ParserAgent: AgentRegistration = {
  id: 'parser',
  subscriptions: [{ event: 'PlayerActionSubmitted', priority: 10, role: 'primary' }],
  contract: parserContract,
  handler: async (_input: unknown) => {
    // AI handler 由服务端 adapter 在 createHarness 时注入
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (input: unknown) => {
    const { input: text } = input as { input: string };
    return fallbackParseAction(text);
  },
  mode: 'fallback',
};
