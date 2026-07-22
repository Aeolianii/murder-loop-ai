import type { KnowledgeDefinition } from '@murder-loop-ai/shared';

export const KNOWLEDGE_DEFINITIONS: KnowledgeDefinition[] = [
  { id: 'package_not_for_503', label: '包裹是寄错到 503 的', requiredClueIds: ['wrong_package'], excludes: [], truthLayerContribution: 10, unlocksDirection: '403' },
  { id: 'chen_has_spare_key', label: '有人用工具开过 503 的锁', requiredClueIds: ['door_scratch'], excludes: [], truthLayerContribution: 5, unlocksDirection: '门锁安全' },
  { id: 'chen_is_monitoring', label: '陈怀民在监控我', requiredClueIds: ['unknown_number_probe'], excludes: [], truthLayerContribution: 10, unlocksDirection: '陈怀民的动机' },
  { id: 'chen_not_mastermind', label: '陈怀民不是主谋', anyOf: { clueIds: ['chen_phone_found', 'handoff_failed_2347'], count: 1 }, requiredClueIds: [], excludes: [], truthLayerContribution: 15, unlocksDirection: '名片背后的数字' },
  { id: 'linyue_investigating', label: '林越在追查李汶涛失踪', anyOf: { clueIds: ['linyue_retracted_message', 'room_403_receipt'], count: 1 }, requiredClueIds: [], excludes: ['linyue_is_accomplice'], truthLayerContribution: 15, unlocksDirection: '林越同盟' },
  { id: 'linyue_is_accomplice', label: '林越是帮凶', requiredClueIds: ['peephole_blind_spot'], excludes: ['linyue_investigating'], truthLayerContribution: 0, unlocksDirection: '' },
  { id: 'fake_police', label: '门外警察是假的', anyOf: { clueIds: ['false_police_overknows', 'police_verified'], count: 1 }, requiredClueIds: [], excludes: [], truthLayerContribution: 15, unlocksDirection: '假警察的来源' },
  { id: 'liventao_is_dead', label: '李汶涛预感到死亡', anyOf: { clueIds: ['room_403_receipt', 'handoff_failed_2347'], count: 1 }, requiredClueIds: [], excludes: [], truthLayerContribution: 15, unlocksDirection: '李汶涛的遗产' },
  { id: 'zhao_is_1103', label: '1103 = 赵鸿远', requiredClueIds: ['chen_phone_found', 'handoff_failed_2347'], excludes: [], truthLayerContribution: 25, unlocksDirection: '赵鸿远的身份' },
  { id: 'org_has_inside_man', label: '组织有公安内线', requiredClueIds: ['police_verified', 'handoff_failed_2347'], excludes: [], truthLayerContribution: 15, unlocksDirection: '绕过内线传证据' },
];

export function getActivatableKnowledge(ownedClueIds: string[], alreadyActivated: string[]): KnowledgeDefinition[] {
  const clueSet = new Set(ownedClueIds);
  const activatedSet = new Set(alreadyActivated);
  return KNOWLEDGE_DEFINITIONS.filter((def) => {
    if (activatedSet.has(def.id)) return false;
    if (def.excludes.some((excluded) => activatedSet.has(excluded))) return false;
    const requiredMet = def.requiredClueIds.length === 0 || def.requiredClueIds.every((id) => clueSet.has(id));
    let anyOfMet = true;
    if (def.anyOf) { const matched = def.anyOf.clueIds.filter((id) => clueSet.has(id)).length; anyOfMet = matched >= def.anyOf.count; }
    return requiredMet && anyOfMet;
  });
}

export function computeTruthLayer(activatedKnowledgeIds: string[]): number {
  const activatedSet = new Set(activatedKnowledgeIds);
  const raw = KNOWLEDGE_DEFINITIONS.filter((def) => activatedSet.has(def.id)).reduce((sum, def) => sum + def.truthLayerContribution, 0);
  return Math.min(100, raw);
}
