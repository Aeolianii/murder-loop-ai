import type { GameState, PlayerKnowledge } from '@murder-loop-ai/shared';
import {
  deriveTruth,
  inferKnowledgeConclusions,
} from './knowledgeInference';

const KNOWLEDGE_FEEDBACK: Record<string, string> = {
  package_not_players_order: '这不是我订购的快递，但它确实被人留在了 503。',
  package_prepared_by_room_403: '胶带、收据和 403——这个包裹是有人刻意准备的。',
  package_hides_digital_material: '真空包装保护的不是普通货物，是那只加密 U 盘。',
  recovery_deadline_2347: '“货没回去。”23:47 不是偶然，是他们的回收压力点。',
  anonymous_call_is_presence_probe: '四秒，空号。那通电话只是在确认屋里有没有人。',
  chen_monitors_room_503: '电话之后就是敲门。陈怀民一直在确认 503 和包裹的状态。',
  chen_attempted_entry_503: '新划痕、备用钥匙和他的监控行动连上了。',
  first_visitors_are_fake_police: '第一批来的人没有匹配的身份和出警记录。',
  fake_police_coordinated_with_chen: '陈怀民提前知道假警察会来。他们不是偶遇。',
  store_call_is_lure_operation: '便利店电话只是另一次诱离。',
  li_monitored_chen_from_403: '李汶涛在 403 记录陈怀民的巡视和交接。',
  li_expected_imminent_danger: '纸条和定时报警都是李汶涛提前留下的预案。',
  linyue_is_li_trusted_relay: '李汶涛最后选择联系的人是林越。',
  linyue_is_investigating_li: '林越掌握的是调查碎片，不是组织内幕。',
  li_created_evidence_drop: '这不是交易货物，是李汶涛留下的证据包。',
  chen_is_field_executor: '陈怀民在听命行事。现场之外还有上游。',
  organization_controls_recovery: '时间、假警察和现场执行者属于同一套回收行动。',
  code_1103_is_org_upstream: '1103 不是房号，是组织的上游代号。',
  code_1103_is_zhao_hongyuan: '名片、账本和语音把 1103 指向赵鸿远。',
  police_report_was_leaked: '赵鸿远知道了只进入报警系统的信息。',
  organization_has_police_insider: '警号、泄露和异常调度指向公安内线。',
  zhao_controls_org_and_insider_network: '赵鸿远、回收组织和公安内线终于连成了完整网络。',
};

export interface ActivatePlayerKnowledgeResult {
  state: GameState;
  newlyActivated: PlayerKnowledge[];
  invalidatedKnowledgeIds: string[];
  feedbackTexts: string[];
}

export function activatePlayerKnowledge(
  state: GameState,
): ActivatePlayerKnowledgeResult {
  const ownedClueIds = [
    ...state.clues.map((clue) => clue.id),
    ...state.discoveredClueIds,
  ];
  if (state.room.package?.state?.opened) ownedClueIds.push('package_opened');
  if (state.room.package?.state?.photographed) ownedClueIds.push('package_photo');
  if (state.policePhase !== 'not_contacted') ownedClueIds.push('police_contacted');

  const existingById = new Map(
    state.activatedKnowledge.map((item) => [item.id, item]),
  );
  const inference = inferKnowledgeConclusions({
    clueIds: ownedClueIds,
    alreadyActivatedKnowledgeIds: existingById.keys(),
  });
  const activeKnowledge = inference.activeConclusions.map((conclusion): PlayerKnowledge => {
    const existing = existingById.get(conclusion.id);
    return {
      id: conclusion.id,
      label: conclusion.label,
      activatedAt: existing?.activatedAt ?? { run: state.run, minute: state.minute },
      sourceClueIds: conclusion.support.sourceClueIds,
      directSourceClueIds: conclusion.support.directClueIds,
      sourceKnowledgeIds: conclusion.support.directKnowledgeIds,
      truthLayerContribution: conclusion.truthLayerContribution,
      excludes: conclusion.excludes,
      category: conclusion.category,
      stage: conclusion.stage,
      ruleVersion: conclusion.ruleVersion,
    };
  });
  const activeIds = new Set(activeKnowledge.map((item) => item.id));
  const newlyActivated = activeKnowledge.filter(
    (item) => !existingById.has(item.id),
  );
  const retainedCurrentRun = state.currentRunKnowledge.filter((item) =>
    activeIds.has(item.id),
  );
  const currentRunIds = new Set(retainedCurrentRun.map((item) => item.id));
  const nextCurrentRun = [
    ...retainedCurrentRun,
    ...newlyActivated.filter((item) => !currentRunIds.has(item.id)),
  ];
  const feedbackTexts = newlyActivated
    .map((item) => KNOWLEDGE_FEEDBACK[item.id])
    .filter((text): text is string => Boolean(text));

  const nextState: GameState = {
    ...state,
    activatedKnowledge: activeKnowledge,
    currentRunKnowledge: nextCurrentRun,
    discoveredClueIds: [
      ...new Set([
        ...state.discoveredClueIds,
        ...state.clues.map((clue) => clue.id),
      ]),
    ],
  };

  return {
    state: nextState,
    newlyActivated,
    invalidatedKnowledgeIds: inference.invalidatedKnowledgeIds,
    feedbackTexts,
  };
}

export function canAccuse(state: GameState): boolean {
  return deriveTruth(state.activatedKnowledge).confirmedKnowledgeIds.length >= 3;
}

export function getActivatedClueFragments(state: GameState): string[] {
  const truth = deriveTruth(state.activatedKnowledge);
  const knowledgeById = new Map(
    state.activatedKnowledge.map((item) => [item.id, item]),
  );
  const clueTitleById = new Map(state.clues.map((clue) => [clue.id, clue.title]));

  return truth.topLevelKnowledgeIds.slice(0, 6).map((knowledgeId) => {
    const item = knowledgeById.get(knowledgeId);
    if (!item) return knowledgeId;
    const sources = item.sourceClueIds
      .map((clueId) => clueTitleById.get(clueId))
      .filter((title): title is string => Boolean(title))
      .slice(0, 3);
    return sources.length > 0
      ? `${item.label}（依据：${sources.join('、')}）`
      : item.label;
  });
}
