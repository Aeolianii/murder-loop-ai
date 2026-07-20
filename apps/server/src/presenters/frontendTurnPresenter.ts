import { minuteLabel, type GameState, type RecommendedAction, type StoryLogEntry } from '@murder-loop-ai/shared';
import type { createHarness } from '@murder-loop-ai/game-core';

export interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
  recommendedActions?: RecommendedAction[];
}

export async function buildSidebarPayload(
  harness: ReturnType<typeof createHarness>,
  finalState: GameState,
  runTurnCompleted = false,
) {
  if (runTurnCompleted) {
    await harness.dispatcher.runCommand('TurnCompleted', { finalState });
  }
  return harness.dispatcher.getLatestArtifact('sidebar', 'TurnCompleted') ?? null;
}

export function toFrontendClues(state: GameState) {
  return state.clues.map((clue, i) => ({
    id: clue.id,
    name: clue.title,
    description: clue.detail,
    status: (i === state.clues.length - 1 ? 'new' : 'known') as 'new' | 'known',
    source: clue.source,
  }));
}

export function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action')
    return { id: entry.id, type: 'action_result', content: `${entry.title ? `${entry.title}: ` : ''}${entry.text}`, timestamp: minuteLabel(entry.minute) };
  if (entry.tone === 'system')
    return { id: entry.id, type: 'system', content: entry.title || entry.text, timestamp: minuteLabel(entry.minute) };
  return { id: entry.id, type: 'narrative', content: entry.text, timestamp: minuteLabel(entry.minute) };
}

export function applyConfirmedTurnNarration(
  nodes: FrontendStoryNode[],
  input: {
    turnId: string;
    timestamp: string;
    actionNarration?: { text: string };
    ambientNarration?: { text: string };
  },
): FrontendStoryNode[] {
  const presented = input.ambientNarration
    ? nodes.filter((node) => node.type !== 'narrative')
    : [...nodes];
  let actionIndex = -1;
  for (let index = presented.length - 1; index >= 0; index -= 1) {
    if (presented[index].type === 'action_result') {
      actionIndex = index;
      break;
    }
  }

  if (input.actionNarration && actionIndex >= 0) {
    presented[actionIndex] = {
      ...presented[actionIndex],
      content: input.actionNarration.text,
    };
  }
  if (input.ambientNarration) {
    presented.push({
      id: `narration-ambient-${input.turnId}`,
      type: 'narrative',
      content: input.ambientNarration.text,
      timestamp: input.timestamp,
    });
  }

  return presented;
}
