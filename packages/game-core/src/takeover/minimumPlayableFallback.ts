import type {
  ActionPlan,
  GameState,
  Narration,
  RuleResult,
  TurnResolution,
} from '@murder-loop-ai/shared';

const FALLBACK_TEXT =
  '智能叙事服务暂时不可用，本次请求的动作和世界状态均未改变。';

const UNCONFIRMED_INTENT_TEXT =
  '这次行动意图没有通过世界规则确认，因此没有改变已确认的状态。你可以换一种说法，或把行动拆成更小的步骤继续尝试。';

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

/**
 * Turns a semantic or adjudication rejection into a visible, state-safe game turn.
 * It deliberately does not reinterpret the raw input or invent a world outcome.
 */
export function resolveRecoverableIntentTurn(
  state: GameState,
  input: string,
  reason: string,
): TurnResolution {
  return resolveHeldTurn({
    state,
    input,
    idPrefix: 'recoverable-intent',
    title: '行动尚未确认',
    text: UNCONFIRMED_INTENT_TEXT,
    planSummary: '行动意图未通过确认，本次没有执行或改变世界状态。',
    warning: `intent_unconfirmed:${reason}`,
    strategyType: 'recoverable_intent_hold',
    rationale: `AI 结果未通过通用世界规则校验：${reason}`,
  });
}

function resolveHeldTurn(input: {
  state: GameState;
  input: string;
  idPrefix: string;
  title: string;
  text: string;
  planSummary: string;
  warning: string;
  strategyType: string;
  rationale: string;
}): TurnResolution {
  const finalState = structuredClone(input.state) as GameState;
  const id = `${input.idPrefix}-${input.state.run}-${input.state.minute}-${input.state.log.length}`;
  finalState.log.push({
    id,
    run: input.state.run,
    minute: input.state.minute,
    title: input.title,
    text: input.text,
    tone: 'neutral',
    channel: 'action',
  });
  const plan: ActionPlan = {
    id: `${id}-plan`,
    raw: input.input,
    summary: input.planSummary,
    actions: [],
    confidence: 0,
    warnings: [input.warning],
  };
  const playerResult: RuleResult = {
    title: input.title,
    text: input.text,
    tone: 'neutral',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const killerResult: RuleResult = {
    title: '世界状态保持不变',
    text: '没有未经确认的世界结果被写入状态。',
    tone: 'neutral',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [],
    state: finalState,
  };
  const narration: Narration = { title: playerResult.title, text: playerResult.text };
  return {
    plan,
    playerResult,
    killerStrategy: {
      id: `${id}-world-hold`,
      type: input.strategyType,
      title: '世界状态保持不变',
      rationale: input.rationale,
      visibleToPlayer: false,
      risk: 'low',
    },
    killerResult,
    narration,
    actionNarration: narration,
    ambientNarration: { title: killerResult.title, text: killerResult.text },
    npcReply: null,
    recommendedActions: [],
    worldTickTrace: [],
    finalState,
  };
}
