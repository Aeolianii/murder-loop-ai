import assert from 'node:assert/strict';
import { shouldShowStartMenu } from './App';
import { INITIAL_STATE } from './constants';

assert.equal(shouldShowStartMenu(INITIAL_STATE), true);
assert.equal(shouldShowStartMenu({ ...INITIAL_STATE, phase: 'investigating' }), false);
assert.equal(shouldShowStartMenu({ ...INITIAL_STATE, ending: 'death' }), false);
