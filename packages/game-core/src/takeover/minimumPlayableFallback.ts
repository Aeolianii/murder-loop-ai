import type {
  ActionPlan,
  GameState,
  Narration,
  RuleResult,
  TurnResolution,
} from '@murder-loop-ai/shared';

const FALLBACK_TEXT =
  '智能叙事服务暂时不可用，本次请求的动作和世界状态均未改变。';

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
    title: '叙事服务暂时不可用',
    text: FALLBACK_TEXT,
    tone: 'neutral',
    channel: 'ambient',
  });

  const plan: ActionPlan = {
    id: `${id}-plan`,
    raw: input,
    summary: '叙事服务不可用，本次没有解析或执行任何动作。',
    actions: [],
    confidence: 0,
    warnings: ['ai_services_unavailable'],
  };
  const playerResult: RuleResult = {
    title: '行动未执行',
    text: FALLBACK_TEXT,
    tone: 'neutral',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const killerResult: RuleResult = {
    title: '世界状态保持不变',
    text: '本次没有确认新的世界状态变化。',
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
      title: '世界状态保持不变',
      rationale: '没有可用的叙事候选，因此兜底流程不会创建新的世界动作。',
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
