import type { EndingTier, EndingTierResult, GameState } from '@murder-loop-ai/shared';
import { ENDING_CATALOG, type EndingCatalogEntry } from '@murder-loop-ai/content';
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

export function resolveEndingTier(score: number): EndingCatalogEntry {
  return ENDING_CATALOG.find((ending) => score >= ending.minScore)
    ?? ENDING_CATALOG[ENDING_CATALOG.length - 1];
}

export function scoreEnding(state: GameState): EndingTierResult {
  const truthLayer = deriveTruth(state.activatedKnowledge).truthLayer;
  const evidenceStrength = scoreEvidenceStrength(state);
  const externalReach = scoreExternalReach(state);
  const survivors = scoreSurvivors(state);
  const cycleCost = scoreCycleCost(state);
  const totalScore = Math.max(0, Math.min(100, Math.round(truthLayer * 0.35 + evidenceStrength * 0.30 + externalReach * 0.25 + survivors * 0.15 + cycleCost * 0.05)));
  const ending = resolveEndingTier(totalScore);
  const tier: EndingTier = ending.tier;
  return {
    tier,
    totalScore,
    breakdown: { truthLayer, evidenceStrength, externalReach, survivors, cycleCost },
    narrative: ending.narrative,
    backtrackHint: ending.backtrackHint,
  };
}
