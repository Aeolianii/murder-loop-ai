import assert from 'node:assert/strict';
import { resolveEndingTier } from './multiDimensionScorer';

assert.equal(resolveEndingTier(100).tier, 'S');
assert.equal(resolveEndingTier(90).tier, 'S');
assert.equal(resolveEndingTier(89).tier, 'A');
assert.equal(resolveEndingTier(70).tier, 'A');
assert.equal(resolveEndingTier(69).tier, 'B');
assert.equal(resolveEndingTier(50).tier, 'B');
assert.equal(resolveEndingTier(49).tier, 'C');
assert.equal(resolveEndingTier(30).tier, 'C');
assert.equal(resolveEndingTier(29).tier, 'D');
assert.equal(resolveEndingTier(0).tier, 'D');
