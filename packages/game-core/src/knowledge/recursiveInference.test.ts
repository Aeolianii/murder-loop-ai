import assert from 'node:assert/strict';
import type { KnowledgeDefinition } from '@murder-loop-ai/shared';
import { KNOWLEDGE_DEFINITIONS } from './knowledgeDefinitions';
import {
  deriveTruth,
  inferKnowledgeConclusions,
  validateKnowledgeGraph,
} from './knowledgeInference';
import { activatePlayerKnowledge } from './playerKnowledge';
import { createInitialGameState } from '../state/createInitialState';

function testMissingInputDoesNotActivateConclusion() {
  const result = inferKnowledgeConclusions({
    clueIds: ['package_label_fragment'],
  });

  assert.equal(result.activeConclusions.some((item) => item.id === 'package_not_players_order'), false);
}

function testRecursiveConclusionsReachFixedPointInOnePass() {
  const result = inferKnowledgeConclusions({
    clueIds: [
      'package_label_fragment',
      'no_matching_order',
      'package_hand_wrapped',
      'room_403_receipt',
      'chen_package_claim',
      'voice_goods_not_returned_2347',
      'false_police_overknows',
      'no_matching_dispatch_for_first_visitors',
      'chen_knew_fake_police_arrival',
      'chen_phone_upstream_order',
      'chen_fear_call',
    ],
    definitions: [...KNOWLEDGE_DEFINITIONS].reverse(),
  });

  const organization = result.activeConclusions.find(
    (item) => item.id === 'organization_controls_recovery',
  );
  assert.ok(organization, 'the engine should infer K17 through K02/K04, K08/K09 and K16');
  assert.deepEqual(
    organization.support.directKnowledgeIds,
    [
      'recovery_deadline_2347',
      'fake_police_coordinated_with_chen',
      'chen_is_field_executor',
    ],
  );
  assert.ok(organization.support.sourceClueIds.includes('room_403_receipt'));
  assert.ok(organization.support.sourceClueIds.includes('chen_phone_upstream_order'));
}

function testNestedAnyRequirementNeedsACompleteBranch() {
  const incomplete = inferKnowledgeConclusions({
    clueIds: ['false_police_overknows', 'fake_police_no_badge_number'],
  });
  assert.equal(
    incomplete.activeConclusions.some((item) => item.id === 'first_visitors_are_fake_police'),
    false,
  );

  const complete = inferKnowledgeConclusions({
    clueIds: [
      'false_police_overknows',
      'fake_police_no_badge_number',
      'police_question_mismatch',
    ],
  });
  assert.equal(
    complete.activeConclusions.some((item) => item.id === 'first_visitors_are_fake_police'),
    true,
  );
}

function testRefutedHypothesisIsRemoved() {
  const result = inferKnowledgeConclusions({
    clueIds: [
      'linyue_retracted_message',
      'linyue_master_key_access',
      'linyue_corridor_lingering',
      'li_warning_to_linyue',
      'li_last_call_to_linyue',
      'linyue_investigation_notes',
      'room_403_collection_notice',
      'room_403_cigarette_pack',
      'awning_cigarette_butt',
      'notebook_chen_schedule',
    ],
    alreadyActivatedKnowledgeIds: ['linyue_may_be_accomplice'],
  });

  assert.ok(result.invalidatedKnowledgeIds.includes('linyue_may_be_accomplice'));
  assert.equal(
    result.activeConclusions.some((item) => item.id === 'linyue_may_be_accomplice'),
    false,
  );
  assert.ok(result.activeConclusions.some((item) => item.id === 'linyue_is_investigating_li'));
}

function testFullTruthDerivationUsesAllConfirmedConclusions() {
  const result = inferKnowledgeConclusions({
    clueIds: [
      'package_label_fragment',
      'no_matching_order',
      'package_hand_wrapped',
      'vacuum_packaging',
      'usb_locked_0724',
      'room_403_receipt',
      'chen_package_claim',
      'voice_goods_not_returned_2347',
      'missed_call_4s',
      'voip_callback_dead',
      'chen_knock_2312',
      'door_scratch_new',
      'chen_keys_503',
      'false_police_overknows',
      'no_matching_dispatch_for_first_visitors',
      'chen_knew_fake_police_arrival',
      'fake_store_call',
      'room_403_collection_notice',
      'room_403_cigarette_pack',
      'awning_cigarette_butt',
      'notebook_chen_schedule',
      'li_last_warning_note',
      'li_timed_report_record',
      'li_warning_to_linyue',
      'li_last_call_to_linyue',
      'linyue_investigation_notes',
      'usb_ledger_transactions',
      'chen_phone_upstream_order',
      'chen_fear_call',
      'chen_card_1103',
      'usb_member_code_1103',
      'chen_phone_zhao_voice',
      'notebook_zhao_visit_log',
      'zhao_knew_unpublic_report',
      'real_police_dispatch_identity',
      'usb_police_badge_entry',
      'li_pinprick_note_zhao_police_inside',
    ],
  });
  const truth = deriveTruth(result.activeConclusions);

  assert.equal(result.activeConclusions.filter((item) => item.category === 'conclusion').length, 22);
  assert.equal(truth.truthLayer, 100);
  assert.equal(truth.stage, 'L4');
  assert.ok(truth.confirmedKnowledgeIds.includes('zhao_controls_org_and_insider_network'));
  assert.ok(truth.topLevelKnowledgeIds.includes('zhao_controls_org_and_insider_network'));
  assert.ok(truth.supportingClueIds.includes('usb_police_badge_entry'));
  assert.equal(new Set(truth.confirmedKnowledgeIds).size, truth.confirmedKnowledgeIds.length);
}

function testGraphValidationRejectsCyclesAndUnknownReferences() {
  const invalid: KnowledgeDefinition[] = [
    {
      id: 'a',
      label: 'A',
      category: 'conclusion',
      stage: 1,
      requirement: { kind: 'knowledge', id: 'b' },
      excludes: [],
      truthLayerContribution: 1,
      unlocksDirection: '',
    },
    {
      id: 'b',
      label: 'B',
      category: 'conclusion',
      stage: 1,
      requirement: {
        kind: 'all',
        requirements: [
          { kind: 'knowledge', id: 'a' },
          { kind: 'knowledge', id: 'missing' },
        ],
      },
      excludes: [],
      truthLayerContribution: 1,
      unlocksDirection: '',
    },
  ];

  const errors = validateKnowledgeGraph(invalid);
  assert.ok(errors.some((error) => error.includes('unknown knowledge "missing"')));
  assert.ok(errors.some((error) => error.includes('cycle')));
}

function testProductionGraphIsValidAndScoresExactlyOneHundred() {
  assert.deepEqual(validateKnowledgeGraph(KNOWLEDGE_DEFINITIONS), []);
  assert.equal(
    KNOWLEDGE_DEFINITIONS.reduce((sum, definition) => sum + definition.truthLayerContribution, 0),
    100,
  );
}

function testTruthDerivationUsesRuleValuesInsteadOfClientPayload() {
  const truth = deriveTruth([{
    id: 'package_not_players_order',
    sourceClueIds: ['spoofed_clue'],
    truthLayerContribution: 99,
    category: 'hypothesis',
    stage: 4,
  }]);

  assert.equal(truth.truthLayer, 3);
  assert.equal(truth.stage, 'L1');
  assert.deepEqual(truth.confirmedKnowledgeIds, ['package_not_players_order']);
}

function testPlayerKnowledgeActivationStoresRecursiveProvenanceAndIsIdempotent() {
  const state = createInitialGameState();
  const clueIds = [
    'package_label_fragment',
    'no_matching_order',
    'package_hand_wrapped',
    'room_403_receipt',
    'chen_package_claim',
    'voice_goods_not_returned_2347',
    'false_police_overknows',
    'no_matching_dispatch_for_first_visitors',
    'chen_knew_fake_police_arrival',
    'chen_phone_upstream_order',
    'chen_fear_call',
  ];
  state.clues = clueIds.map((id) => ({
    id,
    title: id,
    detail: id,
    source: 'player_discovered',
    weight: 1,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  }));

  const first = activatePlayerKnowledge(state);
  const organization = first.newlyActivated.find(
    (item) => item.id === 'organization_controls_recovery',
  );
  assert.ok(organization);
  assert.deepEqual(
    organization.sourceKnowledgeIds,
    [
      'recovery_deadline_2347',
      'fake_police_coordinated_with_chen',
      'chen_is_field_executor',
    ],
  );
  assert.ok(organization.sourceClueIds.includes('package_label_fragment'));

  const second = activatePlayerKnowledge(first.state);
  assert.equal(second.newlyActivated.length, 0);
  assert.equal(
    second.state.activatedKnowledge.filter(
      (item) => item.id === 'organization_controls_recovery',
    ).length,
    1,
  );
}

testMissingInputDoesNotActivateConclusion();
testRecursiveConclusionsReachFixedPointInOnePass();
testNestedAnyRequirementNeedsACompleteBranch();
testRefutedHypothesisIsRemoved();
testFullTruthDerivationUsesAllConfirmedConclusions();
testGraphValidationRejectsCyclesAndUnknownReferences();
testProductionGraphIsValidAndScoresExactlyOneHundred();
testTruthDerivationUsesRuleValuesInsteadOfClientPayload();
testPlayerKnowledgeActivationStoresRecursiveProvenanceAndIsIdempotent();
