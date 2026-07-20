import type { HarnessTurnResponse } from './api/harnessTurnClient';
import type { GameState, StoryNode } from './types';

function nonInputStoryNodes(response: HarnessTurnResponse): StoryNode[] {
  return response.storyLog?.filter(node => node.type !== 'player_input') ?? [];
}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const message = requestErrorMessage(error);
    return {
      ...state,
      isParsing: false,
      storyLog: [
        ...state.storyLog,
        {
          id: `sys-${Date.now()}`,
          type: 'system',
          content: `后端暂时没有回应（${message.slice(0, 60)}），行动未写入循环。`,
        },
      ],
    };
  }

  return {
    ...state,
    gameSessionId: response.gameSessionId ?? state.gameSessionId,
    stateVersion: response.outputStateVersion ?? state.stateVersion,
    isParsing: false,
    actionConfirmation: null,
    time: response.time ?? state.time,
    location: response.location ?? state.location,
    phase: response.phase ?? state.phase,
    clues: response.clues ?? state.clues,
    coreState: response.coreState ?? state.coreState,
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

export function rewindFrontendStateFromResponse(state: GameState, response: HarnessTurnResponse): GameState {
  return {
    ...state,
    gameSessionId: response.gameSessionId ?? state.gameSessionId,
    stateVersion: response.outputStateVersion ?? state.stateVersion,
    isParsing: false,
    time: response.time ?? state.time,
    location: response.location ?? state.location,
    phase: response.phase ?? state.phase,
    clues: response.clues ?? state.clues,
    coreState: response.coreState ?? state.coreState,
    ending: null,
    deathTitle: null,
    deathSummary: null,
    deathMethod: null,
    coordination: response.coordination ?? state.coordination,
    recap: response.recap ?? state.recap,
    sidebar: response.sidebar ?? state.sidebar,
  };
}
