import assert from 'node:assert/strict';
import { evaluateKnowledgeCombination } from './knowledgeInference';

const incompletePackage = evaluateKnowledgeCombination({
  clueIds: ['package_label_fragment'],
  knowledgeIds: [],
});
assert.equal(incompletePackage.status, 'incomplete');
assert.equal(incompletePackage.closestMissingInputCount, 1);
assert.deepEqual(incompletePackage.matchedKnowledgeIds, []);

const confirmedPackage = evaluateKnowledgeCombination({
  clueIds: ['package_label_fragment', 'no_matching_order'],
  knowledgeIds: [],
});
assert.equal(confirmedPackage.status, 'confirmed');
assert.ok(
  confirmedPackage.matchedKnowledgeIds.includes('package_not_players_order'),
);

const recursiveConclusion = evaluateKnowledgeCombination({
  clueIds: [],
  knowledgeIds: [
    'recovery_deadline_2347',
    'fake_police_coordinated_with_chen',
    'chen_is_field_executor',
  ],
});
assert.equal(recursiveConclusion.status, 'confirmed');
assert.deepEqual(recursiveConclusion.matchedKnowledgeIds, [
  'organization_controls_recovery',
]);

const incompleteNestedAlternative = evaluateKnowledgeCombination({
  clueIds: ['false_police_overknows', 'fake_police_no_badge_number'],
  knowledgeIds: [],
});
assert.equal(incompleteNestedAlternative.status, 'incomplete');
assert.equal(incompleteNestedAlternative.closestMissingInputCount, 1);

const confirmedNestedAlternative = evaluateKnowledgeCombination({
  clueIds: [
    'false_police_overknows',
    'fake_police_no_badge_number',
    'police_question_mismatch',
  ],
  knowledgeIds: [],
});
assert.equal(confirmedNestedAlternative.status, 'confirmed');
assert.ok(
  confirmedNestedAlternative.matchedKnowledgeIds.includes(
    'first_visitors_are_fake_police',
  ),
);

const unrelated = evaluateKnowledgeCombination({
  clueIds: ['weapon_found', 'battery_critical'],
  knowledgeIds: [],
});
assert.equal(unrelated.status, 'unrelated');
assert.equal(unrelated.closestMissingInputCount, null);
assert.deepEqual(unrelated.matchedKnowledgeIds, []);
