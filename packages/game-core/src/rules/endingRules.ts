import type { GameState, RuleResult } from '@murder-loop-ai/shared';
import { scoreRun } from '../scoring/scoreRun';
import { event } from '../narration/buildNarrationContext';

export function hasConvictingEvidence(state: GameState): boolean {
  const hasPackagePhoto = state.clues.some(c => c.id === 'package_photo') || Boolean(state.room.package.state.photographed);
  const hasExternalRecord = state.clues.some(c => c.id === 'linyue_has_photo')
    || state.linYuePhase === 'calling_police'
    || state.linYuePhase === 'safe'
    || Boolean(state.room.phone.state.recording)
    || Boolean(state.room.package.state.backedUp)
    || state.clues.some(c => c.id === 'police_verified')
    || state.policePhase === 'real_police_en_route'
    || state.policePhase === 'arrived';

  return hasPackagePhoto && hasExternalRecord;
}

export function markEnding(
  state: GameState,
  ending: NonNullable<GameState['ending']>,
  reason: NonNullable<GameState['endingReason']>,
  title: string,
  text: string,
): RuleResult {
  state.ending = ending;
  state.endingReason = reason;
  state.phase = ending === 'death' ? 'death' : 'survived';
  state.score = scoreRun(state);

  const result = {
    title,
    text,
    tone: state.phase === 'death' ? 'death' : 'win',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [event('ending', ending, text, [title, reason])],
  } satisfies Omit<RuleResult, 'state'>;

  return { ...result, state };
}
