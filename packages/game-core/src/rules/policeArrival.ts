import type { GameState, RuleResult } from '@murder-loop-ai/shared';
import { event } from '../narration/buildNarrationContext';
import { scoreRun } from '../scoring/scoreRun';
import { hasConvictingEvidence } from './endingRules';
import { reconcileGamePhase, transitionGamePhase } from '../machines/gamePhaseMachine';

export const POLICE_ARRIVAL_DELAY_MINUTES = 3;

export function ensurePoliceArrivalCountdown(state: GameState): void {
  if (state.ending || state.policePhase !== 'real_police_en_route') return;
  if (state.policeArrivalMinute === undefined) {
    state.policeArrivalMinute = state.minute + POLICE_ARRIVAL_DELAY_MINUTES;
  }
  state.phase = transitionGamePhase(state.phase, 'POLICE_EN_ROUTE');
}

export function isPoliceArrivalDue(state: GameState): boolean {
  return state.policePhase === 'real_police_en_route'
    && state.policeArrivalMinute !== undefined
    && state.minute >= state.policeArrivalMinute;
}

export function resolvePoliceArrival(state: GameState): Omit<RuleResult, 'state'> {
  const previousPhase = state.phase;
  state.policePhase = 'arrived';
  state.killerStatus = 'arrested';
  state.killerPhase = 'exposed';
  const hasEvidence = hasConvictingEvidence(state);
  state.ending = hasEvidence ? 'escaped_with_evidence' : 'escaped_no_evidence';
  state.endingReason = hasEvidence ? 'police_arrived_with_evidence' : 'police_arrived_without_evidence';
  state.phase = reconcileGamePhase(previousPhase, state);
  state.score = scoreRun(state);

  const text = '楼道尽头先响起的不是敲门声，而是两道稳定的脚步和对讲机短促的电流声。门外那个人终于停住了。真正的警察没有要求你立刻开门，他们隔着门确认了接线记录、门牌和你的姓名。陈怀民被按在楼梯间的墙边时，雨声还在窗外往下滑。这一次，房间没有等到 23:47 才决定你的生死。';

  return {
    title: '真警抵达',
    text,
    tone: 'win',
    addedClues: [],
    timePassed: 0,
    threatDelta: -30,
    events: [
      event('ending', state.ending, text, ['对讲机电流声', '稳定脚步', '楼道远处的警笛', state.endingReason]),
    ],
  };
}
