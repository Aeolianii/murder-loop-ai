import { z } from 'zod';
import type { Narration, NarrationContext, RuleResult, GameState } from '@murder-loop-ai/shared';
import { completeRoleJson } from './openaiClient';
import { heuristicDirectorScore, type DirectorScore } from './turnCoordinator';

const DirectorScoreSchema = z.object({
  total: z.number().min(0).max(100),
  pace: z.number().min(0).max(100),
  infoSafety: z.number().min(0).max(100),
  ruleConsistency: z.number().min(0).max(100),
  prose: z.number().min(0).max(100),
  verdict: z.enum(['pass', 'rewrite']),
  issues: z.array(z.string()).max(8),
  rewriteBrief: z.string(),
});

function contextSummary(context: NarrationContext) {
  return context.events
    .filter((event) => event.visibility !== 'hidden')
    .map((event) => `${event.kind}:${event.subject}:${event.summary}`)
    .join('\n');
}

export async function scoreNarrationWithDirector(options: {
  slot: DirectorScore['slot'];
  narration: Narration;
  context: NarrationContext;
  playerResult: RuleResult;
  killerResult: RuleResult;
  state: GameState;
}): Promise<DirectorScore> {
  const heuristic = heuristicDirectorScore(options.narration, options.slot, contextSummary(options.context));

  const ai = await completeRoleJson(
    'recap',
    [
      '你是《23:47》的剧情导演评分器，不写正文，只审稿。',
      '你要判断一段叙事是否适合互动悬疑游戏：节奏是否好、是否泄露信息、是否违反规则事实、文笔是否有吸引力。',
      '评分维度：pace 节奏/钩子；infoSafety 信息边界与无剧透；ruleConsistency 是否只使用事件事实；prose 文笔与画面感。',
      '如果出现开发词、内部 id、schema、系统判定、规则数值、上帝视角、替玩家悟出真相，必须扣重分并要求 rewrite。',
      '如果 action 段没有动作落地，或 ambient 段复述玩家动作而不是外部变化，也要求 rewrite。',
      'rewriteBrief 必须是一段给叙事 AI 的具体重写指令，短而明确。',
      '只输出 JSON：{"total":0-100,"pace":0-100,"infoSafety":0-100,"ruleConsistency":0-100,"prose":0-100,"verdict":"pass|rewrite","issues":["..."],"rewriteBrief":"..."}。',
    ].join('\n'),
    {
      slot: options.slot,
      narration: options.narration,
      visibleEvents: contextSummary(options.context),
      stateSnapshot: options.context.stateSnapshot,
      heuristic,
    },
    { temperature: 0.18 },
  ).catch(() => null);

  const parsed = DirectorScoreSchema.safeParse(ai);
  if (!parsed.success) return heuristic;

  const score: DirectorScore = {
    slot: options.slot,
    total: Math.round(parsed.data.total),
    pace: Math.round(parsed.data.pace),
    infoSafety: Math.round(parsed.data.infoSafety),
    ruleConsistency: Math.round(parsed.data.ruleConsistency),
    prose: Math.round(parsed.data.prose),
    verdict: parsed.data.verdict,
    issues: parsed.data.issues,
    rewriteBrief: parsed.data.rewriteBrief,
    source: 'ai',
  };

  return score;
}
