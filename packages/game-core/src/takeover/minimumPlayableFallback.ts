import type {
  ActionPlan,
  GameState,
  Narration,
  RuleResult,
  TurnResolution,
} from '@murder-loop-ai/shared';

const FALLBACK_TEXT =
  'AI services are unavailable. No requested action or world-state change was applied.';

/**
 * Closes a turn without interpreting natural language or authoring new world facts.
 * This is the only phase-six fallback and is safe to use when every AI source is unavailable.
 */
export function resolveMinimumPlayableTurn(
  state: GameState,
  input: string,
): TurnResolution {
  const finalState = structuredClone(state) as GameState;
  const id = `minimum-fallback-${state.run}-${state.minute}-${state.log.length}`;
  finalState.log.push({
    id,
    run: state.run,
    minute: state.minute,
    title: 'AI services unavailable',
    text: FALLBACK_TEXT,
    tone: 'neutral',
    channel: 'ambient',
  });

  const plan: ActionPlan = {
    id: `${id}-plan`,
    raw: input,
    summary: 'No action was interpreted while AI services were unavailable.',
    actions: [],
    confidence: 0,
    warnings: ['ai_services_unavailable'],
  };
  const playerResult: RuleResult = {
    title: 'Action not applied',
    text: FALLBACK_TEXT,
    tone: 'neutral',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const killerResult: RuleResult = {
    title: 'World held',
    text: 'No additional world action was confirmed.',
    tone: 'neutral',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const narration: Narration = {
    title: playerResult.title,
    text: playerResult.text,
  };

  return {
    plan,
    playerResult,
    killerStrategy: {
      id: `${id}-world-hold`,
      type: 'minimum_playable_hold',
      title: 'World held',
      rationale: 'No AI candidate was available, so the fallback cannot author a world action.',
      visibleToPlayer: false,
      risk: 'low',
    },
    killerResult,
    narration,
    actionNarration: narration,
    ambientNarration: {
      title: killerResult.title,
      text: killerResult.text,
    },
    npcReply: null,
    recommendedActions: [],
    worldTickTrace: [],
    finalState,
  };
}
