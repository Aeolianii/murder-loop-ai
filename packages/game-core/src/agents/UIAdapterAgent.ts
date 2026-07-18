import type { AgentRegistration } from '../events/AgentRegistry';
import type { GameState } from '@murder-loop-ai/shared';

/**
 * 前端数据适配 Agent。
 * 回合完成后，将最终游戏状态适配为前端需要的格式。
 * 不调用 AI，纯数据转换。
 */
export const UIAdapterAgent: AgentRegistration = {
  id: 'ui-adapter',
  subscriptions: [{ event: 'TurnCompleted', priority: 100, role: 'primary' }],
  contract: {
    version: '1.0.0',
    input: null as never,
    output: null as never,
    validate: false,
  },
  handler: async (input: unknown) => {
    // UIAdapter 始终使用确定性逻辑
    return UIAdapterAgent.fallback(input);
  },
  fallback: async (input: unknown) => {
    const { finalState, moodSignal } = input as {
      finalState: GameState;
      moodSignal?: string;
    };

    // 将 game-core 的 log 条目转为前端 storyLog 格式
    const storyLog = (finalState.log ?? [])
      .filter((n) => n.channel !== 'system')
      .map((n) => ({
        id: n.id,
        type: (n.channel === 'action' ? 'narration' : 'ambient') as string,
        content: n.title ? `**${n.title}**\n\n${n.text}` : n.text,
      }));

    // 收集所有线索
    const clues = finalState.clues ?? [];

    return {
      time: finalState.minute ?? finalState.run,
      location: '青荷公寓 503 室',
      phase: finalState.phase,
      clues,
      coreState: finalState,
      ending: finalState.ending ?? null,
      storyLog,
      moodSignal,
      // 协调信息（供诊断面板）
      coordination: {
        warnings: [],
        directorScores: [],
        agentDecisions: [],
      },
    };
  },
  mode: 'fallback',
};
