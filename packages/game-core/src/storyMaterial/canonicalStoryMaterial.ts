import type { ProposalDomain } from '@murder-loop-ai/ai-contracts';

export interface CanonicalStoryMaterial {
  id: string;
  kind: 'canonical_beat' | 'phase_goal';
  phaseGoal: string;
  eligibilityRules: string[];
  allowedDomains: ProposalDomain[];
  forbiddenClaims: string[];
}

/**
 * Authored possibilities for the World Model, not executable story branches.
 * Every resulting fact still needs an authorized proposal and confirmed event.
 */
export const CANONICAL_STORY_MATERIAL: CanonicalStoryMaterial[] = [
  {
    id: 'material.handoff_2347',
    kind: 'phase_goal',
    phaseGoal: 'After 23:47, the failed package handoff may force the opposition to change plans.',
    eligibilityRules: [
      'world.minute >= 1427',
      'ending == null',
      'the player has established a short-term defense or external evidence path',
    ],
    allowedDomains: ['world', 'killer'],
    forbiddenClaims: [
      'Do not claim the player heard a handoff conversation without a confirmed audible observation.',
      'Do not create a clue directly from this material.',
    ],
  },
  {
    id: 'material.room_403_receipt',
    kind: 'canonical_beat',
    phaseGoal: 'A receipt linking the package to room 403 can become discoverable through a legal deep inspection.',
    eligibilityRules: [
      'world.minute >= 1390',
      'fact that the package was delivered to the wrong room is confirmed',
      'package evidence has not been destroyed',
      'an inspection exposes the relevant compartment',
    ],
    allowedDomains: ['world', 'clue'],
    forbiddenClaims: [
      'Do not reveal the receipt from an exterior-only package observation.',
      'Do not add a clue without a confirmed receipt observation.',
    ],
  },
  {
    id: 'material.lin_yue_retracted_message',
    kind: 'canonical_beat',
    phaseGoal: 'Early in the loop, Lin Yue may retract a warning that hints at incomplete knowledge.',
    eligibilityRules: [
      '1384 <= world.minute <= 1392',
      'Lin Yue has not already received the package photo or entered a permanent danger state',
      'a message delivery event is confirmed',
    ],
    allowedDomains: ['npc', 'world'],
    forbiddenClaims: [
      'Do not update player or NPC knowledge when delivery is not confirmed.',
      'Do not force Lin Yue into danger as a side effect of this material.',
    ],
  },
  {
    id: 'material.fake_store_call',
    kind: 'canonical_beat',
    phaseGoal: 'A deceptive convenience-store call may try to lure the player out of the room.',
    eligibilityRules: [
      '1396 <= world.minute <= 1414',
      'the phone is functional',
      'the caller action and message delivery are confirmed',
    ],
    allowedDomains: ['killer', 'world'],
    forbiddenClaims: [
      'Do not make the player leave the room merely because the call occurred.',
      'Do not create caller identity knowledge without verification evidence.',
    ],
  },
];

export function canonicalStoryMaterial(): CanonicalStoryMaterial[] {
  return CANONICAL_STORY_MATERIAL.map((material) => ({
    ...material,
    eligibilityRules: [...material.eligibilityRules],
    allowedDomains: [...material.allowedDomains],
    forbiddenClaims: [...material.forbiddenClaims],
  }));
}
