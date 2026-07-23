import assert from 'node:assert/strict';
import { DEADLINE_MINUTE } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  reconcileGamePhase,
  transitionGamePhase,
} from './gamePhaseMachine';

assert.equal(transitionGamePhase('loop_started', 'INVESTIGATE'), 'investigating');
assert.equal(
  transitionGamePhase('investigating', 'OPEN_DOOR'),
  'investigating',
  'an event without a legal transition must not mutate phase',
);

const activeState = createInitialGameState();
assert.equal(
  reconcileGamePhase(activeState.phase, activeState, { activityConfirmed: true }),
  'investigating',
);

const countdownState = createInitialGameState();
countdownState.minute = DEADLINE_MINUTE - 5;
assert.equal(
  reconcileGamePhase('investigating', countdownState, { activityConfirmed: true }),
  'pre_2347_countdown',
);

const deadlineState = createInitialGameState();
deadlineState.minute = DEADLINE_MINUTE;
assert.equal(
  reconcileGamePhase('investigating', deadlineState, { activityConfirmed: true }),
  'post_2347_escalation',
);
assert.equal(
  reconcileGamePhase('post_2347_escalation', deadlineState, { activityConfirmed: true }),
  'post_2347_escalation',
  'late-game progress must never regress to a countdown phase',
);

const deathState = createInitialGameState();
deathState.ending = 'death';
assert.equal(reconcileGamePhase('investigating', deathState), 'death');
