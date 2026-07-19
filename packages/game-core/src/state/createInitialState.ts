import { initialRoomObjects, introText } from '@murder-loop-ai/content';
import { START_MINUTE, type GameState } from '@murder-loop-ai/shared';
import { createEmptyLoopMemory } from '../memory/loopMemory';

export function createInitialGameState(): GameState {
  return {
    run: 1,
    minute: START_MINUTE,
    phase: 'loop_started',
    killerPhase: 'confirming_package',
    killerStatus: 'alive',
    policePhase: 'not_contacted',
    linYuePhase: 'unaware',
    evidencePhase: 'package_unnoticed',
    threat: 24,
    suspicion: 0,
    player: {
      injury: 'none',
      stress: 32,
      hidden: false,
    },
    playerHolding: null,
    combatTriggered: false,
    clues: [],
    observations: [],
    room: structuredClone(initialRoomObjects),
    killerKnowledge: {
      knowsPackageAt503: true,
      knowsPlayerOpenedPackage: 'uncertain',
      knowsPlayerPhotographedPackage: false,
      knowsPlayerContactedLinYue: false,
      knowsDoorBarricaded: false,
      knowsWindowLocked: false,
      knowsPoliceCalled: false,
      suspectsPlayerIsAlert: false,
      knowsEvidenceLocation: null,
    },
    memory: createEmptyLoopMemory(),
    log: [
      {
        id: 'intro-1',
        run: 1,
        minute: START_MINUTE,
        title: '23:00，又醒了',
        text: introText,
        tone: 'memory',
        channel: 'memory',
      },
    ],
    ending: null,
    endingReason: null,
    score: null,
    phoneBattery: 61,
    phoneFunctional: true,
    reviveProtectionTurns: 0,
  };
}

export function cloneGameState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}
