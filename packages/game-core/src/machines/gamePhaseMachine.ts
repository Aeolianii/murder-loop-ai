import {
  DEADLINE_MINUTE,
  type GamePhase,
  type GameState,
} from '@murder-loop-ai/shared';
import { createMachine, getNextSnapshot } from 'xstate';

export type GamePhaseEventType =
  | 'START'
  | 'INVESTIGATE'
  | 'PRESSURE'
  | 'CALL_POLICE'
  | 'FAKE_POLICE'
  | 'POLICE_EN_ROUTE'
  | 'POLICE_ARRIVED'
  | 'COUNTDOWN'
  | 'DEADLINE'
  | 'VERIFY'
  | 'OPEN_DOOR'
  | 'ESCAPE'
  | 'CONFRONT'
  | 'DIE'
  | 'SURVIVE'
  | 'REWIND'
  | 'END';

type GamePhaseEvent = { type: GamePhaseEventType };

export const gamePhaseMachine = createMachine({
  types: {} as { events: GamePhaseEvent },
  id: 'gamePhase',
  initial: 'loop_started',
  states: {
    intro: { on: { START: 'loop_started', DIE: 'death', SURVIVE: 'survived' } },
    loop_started: {
      on: {
        INVESTIGATE: 'investigating',
        PRESSURE: 'killer_pressure',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    investigating: {
      on: {
        PRESSURE: 'killer_pressure',
        CALL_POLICE: 'police_called',
        FAKE_POLICE: 'false_police_arrived',
        POLICE_EN_ROUTE: 'confrontation',
        POLICE_ARRIVED: 'survived',
        COUNTDOWN: 'pre_2347_countdown',
        DEADLINE: 'post_2347_escalation',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    killer_pressure: {
      on: {
        CALL_POLICE: 'police_called',
        FAKE_POLICE: 'false_police_arrived',
        POLICE_EN_ROUTE: 'confrontation',
        POLICE_ARRIVED: 'survived',
        COUNTDOWN: 'pre_2347_countdown',
        DEADLINE: 'post_2347_escalation',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    police_called: {
      on: {
        FAKE_POLICE: 'false_police_arrived',
        POLICE_EN_ROUTE: 'confrontation',
        POLICE_ARRIVED: 'survived',
        COUNTDOWN: 'pre_2347_countdown',
        DEADLINE: 'post_2347_escalation',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    false_police_arrived: {
      on: {
        VERIFY: 'confrontation',
        OPEN_DOOR: 'death',
        POLICE_EN_ROUTE: 'confrontation',
        POLICE_ARRIVED: 'survived',
        COUNTDOWN: 'pre_2347_countdown',
        DEADLINE: 'post_2347_escalation',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    pre_2347_countdown: {
      on: {
        POLICE_EN_ROUTE: 'confrontation',
        POLICE_ARRIVED: 'survived',
        DEADLINE: 'post_2347_escalation',
        CONFRONT: 'confrontation',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    post_2347_escalation: {
      on: {
        ESCAPE: 'escape_attempt',
        CONFRONT: 'confrontation',
        POLICE_ARRIVED: 'survived',
        DIE: 'death',
        SURVIVE: 'survived',
      },
    },
    escape_attempt: { on: { DIE: 'death', SURVIVE: 'survived' } },
    confrontation: { on: { POLICE_ARRIVED: 'survived', DIE: 'death', SURVIVE: 'survived' } },
    death: { on: { REWIND: 'loop_started' } },
    survived: { on: { END: 'ending' } },
    ending: { type: 'final' },
  },
});

export function transitionGamePhase(
  currentPhase: GamePhase,
  eventType: GamePhaseEventType,
): GamePhase {
  const current = gamePhaseMachine.resolveState({ value: currentPhase });
  const next = getNextSnapshot(gamePhaseMachine, current, { type: eventType });
  return next.value as GamePhase;
}

const PHASE_EVENT_BY_TARGET: Partial<Record<GamePhase, GamePhaseEventType>> = {
  loop_started: 'REWIND',
  investigating: 'INVESTIGATE',
  killer_pressure: 'PRESSURE',
  police_called: 'CALL_POLICE',
  false_police_arrived: 'FAKE_POLICE',
  pre_2347_countdown: 'COUNTDOWN',
  post_2347_escalation: 'DEADLINE',
  escape_attempt: 'ESCAPE',
  confrontation: 'CONFRONT',
  death: 'DIE',
  survived: 'SURVIVE',
  ending: 'END',
};

export function transitionGamePhaseTo(
  currentPhase: GamePhase,
  requestedPhase: GamePhase,
): GamePhase {
  if (currentPhase === requestedPhase) return currentPhase;
  if (currentPhase === 'intro' && requestedPhase === 'loop_started') {
    return transitionGamePhase(currentPhase, 'START');
  }
  const eventType = PHASE_EVENT_BY_TARGET[requestedPhase];
  return eventType ? transitionGamePhase(currentPhase, eventType) : currentPhase;
}

export function reconcileGamePhase(
  previousPhase: GamePhase,
  state: Pick<GameState, 'minute' | 'threat' | 'policePhase' | 'ending'>,
  signals: { activityConfirmed?: boolean } = {},
): GamePhase {
  if (previousPhase === 'ending') return previousPhase;

  if (state.ending) {
    return transitionGamePhase(
      previousPhase,
      state.ending === 'death' ? 'DIE' : 'SURVIVE',
    );
  }

  let phase = previousPhase === 'intro'
    ? transitionGamePhase(previousPhase, 'START')
    : previousPhase;

  if (phase === 'loop_started' && signals.activityConfirmed) {
    phase = transitionGamePhase(phase, 'INVESTIGATE');
  }

  if (state.minute >= DEADLINE_MINUTE) {
    return transitionGamePhase(phase, 'DEADLINE');
  }
  if (state.minute >= DEADLINE_MINUTE - 5) {
    return transitionGamePhase(phase, 'COUNTDOWN');
  }
  if (state.policePhase === 'arrived') {
    return transitionGamePhase(phase, 'POLICE_ARRIVED');
  }
  if (state.policePhase === 'real_police_en_route') {
    return transitionGamePhase(phase, 'POLICE_EN_ROUTE');
  }
  if (state.policePhase !== 'not_contacted') {
    return transitionGamePhase(phase, 'CALL_POLICE');
  }
  if (state.threat >= 48) {
    return transitionGamePhase(phase, 'PRESSURE');
  }
  return phase;
}
