import { createMachine } from 'xstate';

export const gamePhaseMachine = createMachine({
  id: 'gamePhase',
  initial: 'loop_started',
  states: {
    intro: { on: { START: 'loop_started' } },
    loop_started: { on: { INVESTIGATE: 'investigating', PRESSURE: 'killer_pressure', DIE: 'death' } },
    investigating: { on: { PRESSURE: 'killer_pressure', CALL_POLICE: 'police_called', DEADLINE: 'post_2347_escalation', DIE: 'death', SURVIVE: 'survived' } },
    killer_pressure: { on: { CALL_POLICE: 'police_called', FAKE_POLICE: 'false_police_arrived', DEADLINE: 'post_2347_escalation', DIE: 'death', SURVIVE: 'survived' } },
    police_called: { on: { FAKE_POLICE: 'false_police_arrived', REAL_POLICE: 'survived', DEADLINE: 'post_2347_escalation', DIE: 'death' } },
    false_police_arrived: { on: { VERIFY: 'confrontation', OPEN_DOOR: 'death', SURVIVE: 'survived' } },
    pre_2347_countdown: { on: { DEADLINE: 'post_2347_escalation', DIE: 'death' } },
    post_2347_escalation: { on: { ESCAPE: 'escape_attempt', CONFRONT: 'confrontation', DIE: 'death', SURVIVE: 'survived' } },
    escape_attempt: { on: { DIE: 'death', SURVIVE: 'survived' } },
    confrontation: { on: { DIE: 'death', SURVIVE: 'survived' } },
    death: { on: { REWIND: 'loop_started' } },
    survived: { on: { END: 'ending' } },
    ending: { type: 'final' },
  },
});
