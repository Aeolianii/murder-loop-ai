import assert from 'node:assert/strict';
import type { PlayerKnowledge } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { validateDeductionClaims } from './deductionEngine';

function knowledge(
  id: string,
  label: string,
  category: PlayerKnowledge['category'],
  contribution: number,
): PlayerKnowledge {
  return {
    id,
    label,
    activatedAt: { run: 1, minute: 1 },
    sourceClueIds: [],
    truthLayerContribution: contribution,
    excludes: [],
    category,
  };
}

const hypothesisState = createInitialGameState();
hypothesisState.activatedKnowledge = [
  knowledge('package_is_drug_shipment', '包裹可能只是毒品交易货物', 'hypothesis', 0),
  knowledge('linyue_may_be_accomplice', '林越可能是帮凶', 'hypothesis', 0),
  knowledge('real_police_may_be_complicit', '真警察可能与陈怀民同谋', 'hypothesis', 0),
];
const hypothesisResult = validateDeductionClaims(
  hypothesisState,
  '包裹可能只是毒品交易货物。林越可能是帮凶。真警察可能与陈怀民同谋。',
);
assert.equal(hypothesisResult.confirmedCount, 0);
assert.equal(hypothesisResult.passed, false);

const conclusionState = createInitialGameState();
conclusionState.activatedKnowledge = [
  knowledge('package_not_players_order', '包裹不是沈知夏订购的快递', 'conclusion', 3),
  knowledge('package_hides_digital_material', '包裹在刻意隐藏数字资料', 'conclusion', 3),
  knowledge('chen_is_field_executor', '陈怀民受上游指令，是现场执行者', 'conclusion', 6),
];
const conclusionResult = validateDeductionClaims(
  conclusionState,
  '包裹不是沈知夏订购的快递。包裹在刻意隐藏数字资料。陈怀民受上游指令，是现场执行者。',
);
assert.equal(conclusionResult.confirmedCount, 3);
assert.equal(conclusionResult.passed, true);
