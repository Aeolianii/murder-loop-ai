import type { EndingTier, EndingTierResult, GameState } from '@murder-loop-ai/shared';
import { deriveTruth } from '../knowledge/knowledgeInference';
import { hasConvictingEvidence } from '../rules/endingRules';

function scoreEvidenceStrength(state: GameState): number {
  let score = 0;
  if (state.clues.some((c) => c.id === 'package_photo') || state.room.package?.state?.photographed) score += 20;
  if (state.room.package?.state?.opened || state.clues.some((c) => c.id === 'package_contents')) score += 20;
  if (state.clues.some((c) => c.id === 'room_403_receipt' || c.id === 'handoff_failed_2347')) score += 20;
  if (hasConvictingEvidence(state)) score += 20;
  if (['safe', 'calling_police'].includes(state.linYuePhase) || ['real_police_en_route', 'arrived'].includes(state.policePhase)) score += 20;
  return Math.min(100, score);
}

function scoreExternalReach(state: GameState): number {
  let score = 0;
  if (state.clues.some((c) => c.id === 'linyue_has_photo') || ['calling_police', 'safe'].includes(state.linYuePhase)) score += 40;
  if (['arrived', 'real_police_en_route'].includes(state.policePhase) || state.clues.some((c) => c.id === 'police_verified')) score += 30;
  if (state.clues.some((c) => c.id === 'recording_pressure')) score += 20;
  if (state.activatedKnowledge.some((k) => k.id === 'organization_has_police_insider')) score = Math.round(score * 0.8);
  return Math.min(100, score);
}

function scoreSurvivors(state: GameState): number {
  let score = 0;
  if (state.linYuePhase !== 'dead' && state.linYuePhase !== 'injured') score += 60;
  else if (state.linYuePhase === 'injured') score += 30;
  if (state.player.injury === 'none') score += 40;
  else if (state.player.injury === 'minor') score += 20;
  return Math.min(100, score);
}

function scoreCycleCost(state: GameState): number {
  if (state.run <= 5) return 0;
  if (state.run <= 10) return -20;
  if (state.run <= 15) return -40;
  if (state.run <= 20) return -60;
  return -100;
}

const TIERS: { tier: EndingTier; min: number }[] = [{ tier: 'S', min: 90 }, { tier: 'A', min: 70 }, { tier: 'B', min: 50 }, { tier: 'C', min: 30 }, { tier: 'D', min: 0 }];

const HINTS: Record<Exclude<EndingTier, 'S'>, string> = {
  A: '雨声还在。她闭眼，又睁开——有一件事她还没想通。',
  B: '陈怀民的脸她记住了。但她总觉得，那个电话号码后面还有别人。',
  C: '她活到了天亮。但 403 那扇门后面是什么，她不知道。',
  D: '她睁开眼。雨声落在窗外。又是 23:00。',
};

const NARRATIVES: Record<EndingTier, string> = {
  S: '证据链完整公开，赵鸿远被逮捕，组织网络被摧毁。',
  A: '警方拿到关键证据开始调查，但赵鸿远提前脱身。',
  B: '陈怀民被逮捕，组织切割了他，真相只揭露了表层。',
  C: '她知道了一切但证据不够，只能匿名举报后逃离。',
  D: '活下来了——不再循环——但没人知道 503 发生了什么。',
};

export function scoreEnding(state: GameState): EndingTierResult {
  const truthLayer = deriveTruth(state.activatedKnowledge).truthLayer;
  const evidenceStrength = scoreEvidenceStrength(state);
  const externalReach = scoreExternalReach(state);
  const survivors = scoreSurvivors(state);
  const cycleCost = scoreCycleCost(state);
  const totalScore = Math.max(0, Math.min(100, Math.round(truthLayer * 0.35 + evidenceStrength * 0.30 + externalReach * 0.25 + survivors * 0.15 + cycleCost * 0.05)));
  const tier = TIERS.find((t) => totalScore >= t.min)?.tier ?? 'D';
  return { tier, totalScore, breakdown: { truthLayer, evidenceStrength, externalReach, survivors, cycleCost }, narrative: NARRATIVES[tier], backtrackHint: tier === 'S' ? null : HINTS[tier] };
}
