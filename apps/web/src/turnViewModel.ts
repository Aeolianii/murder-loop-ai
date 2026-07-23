import { HarnessTurnRequestError, type HarnessTurnResponse } from './api/harnessTurnClient';
import type { GameState, StoryNode } from './types';

function nonInputStoryNodes(response: HarnessTurnResponse): StoryNode[] {
  return response.storyLog?.filter(node => node.type !== 'player_input') ?? [];
}

export function beginHarnessTurn(state: GameState, actionText: string, id = Date.now().toString()): GameState {
  return {
    ...state,
    isParsing: true,
    storyLog: [
      ...state.storyLog,
      { id: `input-${id}`, type: 'player_input', content: actionText },
    ],
  };
}

export function applyHarnessTurnResponse(
  state: GameState,
  response: HarnessTurnResponse,
  error?: unknown,
): GameState {
  if (error) {
    return {
      ...state,
      isParsing: false,
      storyLog: [
        ...state.storyLog,
        {
          id: `sys-${Date.now()}`,
          type: 'system',
          content: playerFacingTurnError(error),
        },
      ],
    };
  }

  return {
    ...state,
    gameSessionId: response.gameSessionId ?? state.gameSessionId,
    stateVersion: response.outputStateVersion ?? state.stateVersion,
    isParsing: false,
    isParsingAction: false,
    actionConfirmation: null,
    time: response.time ?? state.time,
    location: response.location ?? state.location,
    phase: response.phase ?? state.phase,
    clues: response.clues ?? state.clues,
    coreState: response.coreState ?? state.coreState,
    knowledge: response.knowledge ?? state.knowledge,
    truth: response.truth ?? state.truth,
    ending: response.ending !== undefined ? response.ending : state.ending,
    deathTitle: response.deathTitle !== undefined ? response.deathTitle : state.deathTitle,
    deathSummary: response.deathSummary !== undefined ? response.deathSummary : state.deathSummary,
    deathMethod: response.deathMethod !== undefined ? response.deathMethod : state.deathMethod,
    coordination: response.coordination ?? state.coordination,
    recap: response.recap ?? state.recap,
    sidebar: response.sidebar ?? state.sidebar,
    storyLog: [...state.storyLog, ...nonInputStoryNodes(response)],
  };
}

function playerFacingTurnError(error: unknown): string {
  if (error instanceof HarnessTurnRequestError) {
    if (error.status === 422 || error.code === 'ai_first_clarification_required') {
      return '行动含义还不够明确，请换一种更具体的说法。';
    }
    if (error.status === 503 || error.code === 'ai_first_turn_rejected') {
      return '行动解析暂时失败，本次行动没有写入循环。';
    }
  }
  return '后端暂时没有回应，行动未写入循环。';
}

export function rewindFrontendStateFromResponse(state: GameState, response: HarnessTurnResponse): GameState {
  return {
    ...state,
    gameSessionId: response.gameSessionId ?? state.gameSessionId,
    stateVersion: response.outputStateVersion ?? state.stateVersion,
    isParsing: false,
    isParsingAction: false,
    actionConfirmation: null,
    time: response.time ?? state.time,
    location: response.location ?? state.location,
    phase: response.phase ?? state.phase,
    clues: response.clues ?? state.clues,
    coreState: response.coreState ?? state.coreState,
    knowledge: response.knowledge ?? state.knowledge,
    truth: response.truth ?? state.truth,
    ending: null,
    deathTitle: null,
    deathSummary: null,
    deathMethod: null,
    coordination: response.coordination ?? state.coordination,
    recap: response.recap ?? state.recap,
    sidebar: response.sidebar ?? state.sidebar,
    storyLog: [],
  };
}
