import type {
  KnowledgeDefinition,
  KnowledgeRequirement,
  KnowledgeStage,
} from '@murder-loop-ai/shared';

const clue = (id: string): KnowledgeRequirement => ({ kind: 'clue', id });
const knowledge = (id: string): KnowledgeRequirement => ({ kind: 'knowledge', id });
const all = (...requirements: KnowledgeRequirement[]): KnowledgeRequirement => ({
  kind: 'all',
  requirements,
});
const any = (
  minimum: number,
  ...requirements: KnowledgeRequirement[]
): KnowledgeRequirement => ({
  kind: 'any',
  minimum,
  requirements,
});

function conclusion(
  id: string,
  label: string,
  stage: Exclude<KnowledgeStage, 0>,
  truthLayerContribution: number,
  requirement: KnowledgeRequirement,
  unlocksDirection = '',
): KnowledgeDefinition {
  return {
    id,
    label,
    category: 'conclusion',
    stage,
    requirement,
    excludes: [],
    truthLayerContribution,
    unlocksDirection,
    ruleVersion: 2,
  };
}

function hypothesis(
  id: string,
  label: string,
  requirement: KnowledgeRequirement,
  invalidatedBy: KnowledgeRequirement,
): KnowledgeDefinition {
  return {
    id,
    label,
    category: 'hypothesis',
    stage: 0,
    requirement,
    invalidatedBy,
    excludes: [],
    truthLayerContribution: 0,
    unlocksDirection: '',
    ruleVersion: 2,
  };
}

export const KNOWLEDGE_DEFINITIONS: KnowledgeDefinition[] = [
  conclusion(
    'package_not_players_order',
    '包裹不是沈知夏订购的快递',
    1,
    3,
    all(clue('package_label_fragment'), clue('no_matching_order')),
    '包裹来源',
  ),
  conclusion(
    'package_prepared_by_room_403',
    '包裹由 403 住户刻意准备',
    1,
    4,
    all(
      knowledge('package_not_players_order'),
      clue('package_hand_wrapped'),
      clue('room_403_receipt'),
    ),
    '403 与李汶涛',
  ),
  conclusion(
    'package_hides_digital_material',
    '包裹在刻意隐藏数字资料',
    1,
    3,
    all(clue('vacuum_packaging'), clue('usb_locked_0724')),
    'U 盘密码',
  ),
  conclusion(
    'recovery_deadline_2347',
    '23:47 是包裹回收的压力点',
    1,
    4,
    all(
      knowledge('package_prepared_by_room_403'),
      clue('chen_package_claim'),
      clue('voice_goods_not_returned_2347'),
    ),
    '回收行动',
  ),
  conclusion(
    'anonymous_call_is_presence_probe',
    '匿名来电是在确认 503 是否有人',
    1,
    2,
    all(clue('missed_call_4s'), clue('voip_callback_dead')),
    '匿名来电来源',
  ),
  conclusion(
    'chen_monitors_room_503',
    '陈怀民在监控 503 和包裹状态',
    1,
    5,
    all(
      knowledge('anonymous_call_is_presence_probe'),
      clue('chen_knock_2312'),
      clue('chen_package_claim'),
    ),
    '陈怀民动机',
  ),
  conclusion(
    'chen_attempted_entry_503',
    '陈怀民具备并尝试过进入 503',
    1,
    4,
    all(
      knowledge('chen_monitors_room_503'),
      clue('door_scratch_new'),
      clue('chen_keys_503'),
    ),
    '门锁安全',
  ),
  conclusion(
    'first_visitors_are_fake_police',
    '第一批自称警察的来客是假的',
    2,
    5,
    all(
      clue('false_police_overknows'),
      any(
        1,
        clue('no_matching_dispatch_for_first_visitors'),
        all(clue('fake_police_no_badge_number'), clue('police_question_mismatch')),
      ),
    ),
    '假警察来源',
  ),
  conclusion(
    'fake_police_coordinated_with_chen',
    '假警察与陈怀民协同行动',
    2,
    4,
    all(
      knowledge('first_visitors_are_fake_police'),
      clue('chen_knew_fake_police_arrival'),
    ),
    '组织资源',
  ),
  conclusion(
    'store_call_is_lure_operation',
    '便利店来电是诱使玩家离开 503 的行动',
    2,
    3,
    all(
      clue('fake_store_call'),
      knowledge('chen_monitors_room_503'),
      knowledge('fake_police_coordinated_with_chen'),
    ),
    '诱离行动',
  ),
  conclusion(
    'li_monitored_chen_from_403',
    '李汶涛曾从 403 观察并记录陈怀民',
    2,
    4,
    all(
      clue('room_403_collection_notice'),
      clue('room_403_cigarette_pack'),
      clue('awning_cigarette_butt'),
      clue('notebook_chen_schedule'),
    ),
    '李汶涛的调查',
  ),
  conclusion(
    'li_expected_imminent_danger',
    '李汶涛预感自己即将遭遇危险',
    2,
    5,
    any(
      2,
      clue('li_last_warning_note'),
      clue('li_warning_to_linyue'),
      clue('li_timed_report_record'),
    ),
    '李汶涛的预案',
  ),
  conclusion(
    'linyue_is_li_trusted_relay',
    '林越是李汶涛选定的信息中继者',
    2,
    3,
    all(clue('li_warning_to_linyue'), clue('li_last_call_to_linyue')),
    '林越同盟',
  ),
  conclusion(
    'linyue_is_investigating_li',
    '林越在自行核查李汶涛失踪',
    2,
    5,
    all(
      knowledge('linyue_is_li_trusted_relay'),
      clue('linyue_investigation_notes'),
      knowledge('li_monitored_chen_from_403'),
    ),
    '林越同盟',
  ),
  conclusion(
    'li_created_evidence_drop',
    '李汶涛留下的是证据包',
    2,
    6,
    all(
      knowledge('package_prepared_by_room_403'),
      knowledge('package_hides_digital_material'),
      knowledge('li_expected_imminent_danger'),
      clue('usb_ledger_transactions'),
    ),
    '证据包内容',
  ),
  conclusion(
    'chen_is_field_executor',
    '陈怀民受上游指令，是现场执行者',
    3,
    6,
    all(clue('chen_phone_upstream_order'), clue('chen_fear_call')),
    '陈怀民的上游',
  ),
  conclusion(
    'organization_controls_recovery',
    '包裹回收由组织统一调度',
    3,
    6,
    all(
      knowledge('recovery_deadline_2347'),
      knowledge('fake_police_coordinated_with_chen'),
      knowledge('chen_is_field_executor'),
    ),
    '组织网络',
  ),
  conclusion(
    'code_1103_is_org_upstream',
    '1103 是组织上游代号',
    3,
    5,
    all(clue('chen_card_1103'), clue('usb_member_code_1103')),
    '1103 身份',
  ),
  conclusion(
    'code_1103_is_zhao_hongyuan',
    '1103 指向赵鸿远',
    4,
    8,
    all(
      knowledge('code_1103_is_org_upstream'),
      clue('chen_phone_zhao_voice'),
      any(1, clue('notebook_zhao_visit_log'), clue('linyue_saw_zhao')),
    ),
    '赵鸿远身份',
  ),
  conclusion(
    'police_report_was_leaked',
    '报警信息从官方链路泄露给赵鸿远',
    4,
    4,
    all(clue('zhao_knew_unpublic_report'), clue('real_police_dispatch_identity')),
    '报警泄露路径',
  ),
  conclusion(
    'organization_has_police_insider',
    '组织存在公安内线',
    4,
    6,
    all(
      knowledge('police_report_was_leaked'),
      clue('usb_police_badge_entry'),
      any(1, clue('real_police_delayed'), clue('li_pinprick_note_zhao_police_inside')),
    ),
    '绕过内线传证据',
  ),
  conclusion(
    'zhao_controls_org_and_insider_network',
    '赵鸿远控制组织及公安内线网络',
    4,
    5,
    all(
      knowledge('organization_controls_recovery'),
      knowledge('code_1103_is_zhao_hongyuan'),
      knowledge('organization_has_police_insider'),
    ),
    '主动结案',
  ),
  hypothesis(
    'package_is_drug_shipment',
    '包裹可能只是毒品交易货物',
    all(clue('vacuum_packaging'), clue('serial_cash')),
    knowledge('li_created_evidence_drop'),
  ),
  hypothesis(
    'room_403_occupant_is_active',
    '403 住户可能仍在活动',
    all(clue('room_403_cigarette_pack'), clue('room_403_collection_notice')),
    all(clue('li_missing_confirmation'), knowledge('li_expected_imminent_danger')),
  ),
  hypothesis(
    'linyue_may_be_accomplice',
    '林越可能是帮凶',
    all(
      clue('linyue_retracted_message'),
      clue('linyue_master_key_access'),
      clue('linyue_corridor_lingering'),
    ),
    all(
      knowledge('linyue_is_li_trusted_relay'),
      knowledge('linyue_is_investigating_li'),
    ),
  ),
  hypothesis(
    'real_police_may_be_complicit',
    '真警察可能与陈怀民同谋',
    all(clue('real_police_delayed'), clue('real_police_questioned_chen')),
    all(
      clue('real_police_dispatch_identity'),
      clue('real_police_challenged_first_group'),
    ),
  ),
];

export function computeTruthLayer(activatedKnowledgeIds: string[]): number {
  const activatedSet = new Set(activatedKnowledgeIds);
  const score = KNOWLEDGE_DEFINITIONS
    .filter(
      (definition) =>
        definition.category === 'conclusion' && activatedSet.has(definition.id),
    )
    .reduce((sum, definition) => sum + definition.truthLayerContribution, 0);
  return Math.min(100, score);
}
