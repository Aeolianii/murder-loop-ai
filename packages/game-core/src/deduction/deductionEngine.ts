import type { DeductionClaim, DeductionResult, GameState } from '@murder-loop-ai/shared';
import { deriveTruth } from '../knowledge/knowledgeInference';
import { getActivatedClueFragments } from '../knowledge/playerKnowledge';

export function buildDeductionPrompt(state: GameState): string {
  const fragments = getActivatedClueFragments(state);
  if (fragments.length === 0) return '你靠在门边，脑子一片空白。你知道的还不够。';
  return ['你靠在门边，把这几轮的记忆在脑子里过了一遍。', '', ...fragments.map((f) => `  ${f}。`), '', '这些碎片拼在一起——'].join('\n');
}

export function validateDeductionClaims(
  state: GameState,
  playerText?: string,
): DeductionResult {
  const confirmedKnowledgeIds = new Set(
    deriveTruth(state.activatedKnowledge).confirmedKnowledgeIds,
  );
  const activatedLabels = new Map(
    state.activatedKnowledge
      .filter((knowledge) => confirmedKnowledgeIds.has(knowledge.id))
      .map((knowledge) => [knowledge.id, knowledge.label]),
  );
  const rawClaims = playerText === undefined
    ? [...activatedLabels.values()]
    : playerText.split(/[。；\n]/).map((s) => s.trim()).filter((s) => s.length >= 4);

  const claims: DeductionClaim[] = rawClaims.map((statement) => {
    for (const [id, label] of activatedLabels) {
      const a = new Set(statement.replace(/\s/g, ''));
      const b = new Set(label.replace(/\s/g, ''));
      if (b.size === 0) continue;
      let overlap = 0;
      for (const ch of b) { if (a.has(ch)) overlap++; }
      if (overlap / b.size >= 0.4) return { statement, knowledgeId: id, verdict: 'confirmed' };
    }
    return { statement, knowledgeId: null, verdict: 'unrecognized' };
  });

  const confirmedCount = new Set(
    claims.flatMap((claim) =>
      claim.verdict === 'confirmed' && claim.knowledgeId
        ? [claim.knowledgeId]
        : [],
    ),
  ).size;
  return {
    claims,
    confirmedCount,
    totalAsked: claims.length,
    passed: confirmedCount > 0,
    consecutiveFailures: 0,
  };
}

export function buildDeductionResponse(result: DeductionResult): string {
  if (result.passed) return '她说完了。雨声填满了沉默——她知道，自己终于把碎片拼对了。';
  if (result.claims.some((c) => c.verdict === 'contradicted')) return '……不对。她停顿了一下。有些细节对不上。';
  return '她能说的都说了。但有些事——还连不上。';
}
