import type { ActionIntent, ActionPlan, ActionTarget, ParsedAction } from '@murder-loop-ai/shared';
import { isPackageHandoffToChen } from '../npc/interactionPolicy';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));
const firstIndexOfAny = (text: string, words: string[]) => {
  const indexes = words.map((word) => text.indexOf(word)).filter(index => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : Number.MAX_SAFE_INTEGER;
};
const includesOpenDoorNegation = (text: string) =>
  includesAny(text, [
    '不开门',
    '不要开门',
    '别开门',
    '不能开门',
    '先不开门',
    '暂不开门',
    '不直接开门',
    '不要直接开门',
    '不打开门',
    '不要打开门',
    '不给他开门',
    '绝不开门',
    '不让他进来',
    '别让他进来',
    '不要让他进来',
  ]);

const directReplyMarkers = [
  '我回了他',
  '我回复他',
  '我回他',
  '回了他',
  '回复他',
  '给他回',
  '回消息',
  '回短信',
  '回复消息',
  '回复短信',
  '打字回复',
];

function normalize(input: string) {
  return input.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '');
}

function createAction(raw: string, intent: ActionIntent, target: ActionTarget, method: string, confidence: number, timeCost: number, noise: number, risk: ParsedAction['risk']): ParsedAction {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    raw,
    intent,
    target,
    method,
    confidence,
    timeCost,
    noise,
    risk,
  };
}

function actionOrderIndex(action: ParsedAction, text: string) {
  if (action.intent === 'open_door' && action.target === 'front_door') {
    return firstIndexOfAny(text, ['开门', '打开门', '让他进来']);
  }
  if (action.intent === 'secure_entry' && action.target === 'front_door') {
    return firstIndexOfAny(text, ['锁门', '锁上门', '把门锁上', '门锁上', '锁好门', '扣上门锁', '反锁', '门链', '堵门', '抵住门', '顶住门', '椅子', '行李箱']);
  }
  if (action.intent === 'inspect' && action.target === 'front_door') {
    return firstIndexOfAny(text, ['猫眼', '看门外', '查看门外', '观察门外', '门外', '门缝', '检查门锁', '查看门锁', '观察门锁', '看门锁', '锁芯', '锁链', '链条']);
  }
  if (action.target === 'package') {
    return firstIndexOfAny(text, ['包裹', '纸箱', '快递', '旧书', '药盒', '药板']);
  }
  if (action.target === 'linyue') {
    return firstIndexOfAny(text, ['林越', '维修工', '发给他', '让他报警', '让他在楼下', '别上楼', '不要上楼', '短信']);
  }
  if (action.target === 'police') return firstIndexOfAny(text, ['报警', '110', '警察', '警方']);
  if (action.target === 'phone') return firstIndexOfAny(text, ['手机', '拍照', '拍下来', '照片', '录音', '录像', '静音', '勿扰']);
  if (action.target === 'window') return firstIndexOfAny(text, ['窗', '阳台', '窗帘', '雨棚', '窗台']);
  if (action.target === 'room') return firstIndexOfAny(text, ['衣柜', '床底', '卫生间', '检查房间', '搜一遍', '通风口']);
  if (action.target === 'chen_huaimin') return firstIndexOfAny(text, ['房东', '陈怀民', '陌生号码', '回复', '套话', '假装', '问他']);
  return Number.MAX_SAFE_INTEGER;
}

export function fallbackParseAction(input: string): ActionPlan {
  const raw = input.trim();
  const text = normalize(raw);
  const actions: ParsedAction[] = [];
  const warnings: string[] = [];
  const packageHandoffToChen = isPackageHandoffToChen(raw);

  if (!raw) {
    actions.push(createAction('沉默等待', 'wait', 'self', '保持安静并倾听门外变化', 0.8, 1, 0, 'medium'));
  }

  if (!packageHandoffToChen && includesAny(text, ['包裹', '纸箱', '快递', '旧书', '药盒'])) {
    const intent: ActionIntent = includesAny(text, ['藏', '水箱', '卫生间', '放到'])
      ? 'hide_evidence'
      : includesAny(text, ['拍照', '拍下来', '照片', '发给', '备份'])
        ? 'preserve_evidence'
        : 'inspect';
    actions.push(createAction(raw, intent, 'package', intent === 'hide_evidence' ? '处理包裹位置' : '检查或保存包裹信息', 0.86, 2, 1, 'medium'));
  }

  if (includesAny(text, ['拍照', '拍下来', '照片', '备份', '上传', '云盘', '定时发送'])) {
    // 如果前面已为包裹生成 preserve_evidence 动作，不再重复生成
    const alreadyPhotographedPackage = includesAny(text, ['包裹', '纸箱', '快递', '旧书', '药盒']);
    if (!alreadyPhotographedPackage) {
      actions.push(createAction(raw, 'preserve_evidence', 'phone', '拍摄并保留证据', 0.88, 1, 0, 'low'));
    }
  }

  if (includesAny(text, ['小红书', '社交平台', '发帖', '发布', '发到网上', '公开求认领'])) {
    actions.push(createAction(raw, 'preserve_evidence', 'social_media', '将照片发布到社交平台留证并求证', 0.84, 2, 0, 'medium'));
  }

  if (includesAny(text, ['林越', '维修工', '发给他', '让他报警', '让他在楼下', '别上楼', '不要上楼', '短信'])) {
    actions.push(createAction(raw, 'communicate', 'linyue', '联系林越并传递外部任务', 0.88, 2, 0, 'medium'));
  }

  if (
    includesAny(raw, directReplyMarkers)
    || /[“"'].*[”"']/.test(raw)
    || includesAny(text, ['有啊怎么了', '看到了怎么了', '拿进去了怎么了', '你是谁', '你要干什么'])
  ) {
    actions.push(createAction(raw, 'communicate', 'chen_huaimin', `回复陌生号码或门外的人：${raw}`, 0.9, 1, 0, 'medium'));
  }

  if (includesAny(text, ['报警', '110', '警察', '警方'])) {
    const intent: ActionIntent = includesAny(text, ['核实', '确认', '回拨', '警号', '真假']) ? 'verify_identity' : 'call_police';
    actions.push(createAction(raw, intent, 'police', intent === 'verify_identity' ? '核实警察身份' : '报警求助', 0.9, 2, 1, 'medium'));
  }

  if (includesAny(text, ['录音', '录像', '录下来', '打开录音', '拍视频'])) {
    actions.push(createAction(raw, 'record', 'phone', '打开手机录音或录像', 0.92, 1, 0, 'low'));
  }

  if (includesAny(text, ['静音', '勿扰', '关铃声', '不震动', '关灯', '灯关', '屏幕调暗', '降低亮度'])) {
    actions.push(createAction(raw, 'secure_entry', 'phone', '让手机保持安静', 0.84, 1, 0, 'low'));
  }

  if (includesAny(text, ['锁门', '锁上门', '把门锁上', '门锁上', '锁好门', '扣上门锁', '反锁', '门链', '堵门', '抵住门', '顶住门', '椅子', '行李箱'])) {
    actions.push(createAction(raw, 'secure_entry', 'front_door', '处理门锁和门链', 0.92, 2, includesAny(text, ['悄悄', '轻轻', '小声', '尽量不要']) ? 1 : 3, 'medium'));
  }

  if (!includesOpenDoorNegation(text) && includesAny(text, ['开门', '打开门', '让他进来'])) {
    actions.push(createAction(raw, 'open_door', 'front_door', '打开入户门', 0.94, 1, 1, 'high'));
  }

  if (includesAny(text, ['猫眼', '看门外', '查看门外', '观察门外', '门外', '门缝', '检查门锁', '查看门锁', '观察门锁', '看门锁', '锁芯', '锁链', '链条'])) {
    actions.push(createAction(raw, 'inspect', 'front_door', '观察门外和门锁状态', 0.86, 2, 0, 'medium'));
  }

  if (includesAny(text, ['窗', '阳台', '窗帘', '雨棚', '窗台'])) {
    const intent: ActionIntent = includesAny(text, ['锁', '关上', '拉上']) ? 'secure_entry' : 'inspect';
    actions.push(createAction(raw, intent, 'window', intent === 'secure_entry' ? '锁窗并处理窗帘' : '检查窗户路线', 0.86, 2, 1, 'medium'));
  }

  if (includesAny(text, ['衣柜', '床底', '卫生间', '检查房间', '搜一遍', '通风口'])) {
    actions.push(createAction(raw, 'inspect', 'room', '检查可能藏人的位置', 0.82, 2, 2, 'medium'));
  }

  if (includesAny(text, ['房东', '陈怀民', '套话', '假装不知道', '问他'])) {
    actions.push(createAction(
      raw,
      includesAny(text, ['假装', '套话', '骗']) ? 'deceive' : 'communicate',
      'chen_huaimin',
      packageHandoffToChen ? '把包裹交给门外自称房东的人' : '与房东沟通并控制信息暴露',
      0.87,
      2,
      0,
      'high',
    ));
  }

  if (includesAny(text, ['睡着', '装睡', '假装睡', '没拆', '不知道包裹'])) {
    actions.push(createAction(raw, 'deceive', 'chen_huaimin', '制造自己没有察觉包裹异常的假象', 0.82, 1, 0, 'medium'));
  }

  if (includesAny(text, ['吃', '吃点', '吃东西', '喝水', '倒水', '压惊', '缓一缓', '缓一下', '冷静', '镇定', '深呼吸'])) {
    actions.push(createAction(raw, 'self_care', 'self', '短暂补充体力并让自己冷静下来', 0.78, 1, 1, 'medium'));
  }

  if (includesAny(text, ['等', '等待', '听', '安静', '不动'])) {
    // 但如果同时有明确动作动词，不解析为 wait
    if (!includesAny(text, ['追', '冲', '砍', '杀', '打', '刺', '捅', '砸', '逃', '跑', '开门', '拿', '捡'])) {
      actions.push(createAction(raw, 'wait', 'self', '等待并倾听变化', 0.75, 1, 0, 'medium'));
    }
  }

  // ---- 追击/冲刺（之前被误判为 wait 的核心 bug） ----
  if (includesAny(text, ['追', '冲过去', '追上去', '追出去', '冲出门', '追他', '追她', '冲出去', '跑出去'])) {
    actions.push(createAction(raw, 'escape', 'front_door', '冲出房门追击门外的人', 0.78, 2, 5, 'high'));
  }

  // ---- 攻击类（叙事驱动战斗） ----
  if (includesAny(text, ['砍', '捅', '刺', '砸', '打他', '打她', '攻击', '搏斗', '杀', '干掉', '弄死', '开枪', '射杀', '射'])) {
    let weaponId: string | undefined;
    if (includesAny(text, ['枪', '开枪', '射', '射击', '子弹', '炸弹', '闪光弹', '手雷'])) {
      warnings.push('你手边没有枪或爆炸物。这是普通出租屋，不是军火库。');
    } else if (includesAny(text, ['刀', '厨刀', '厨房刀', '菜刀'])) {
      weaponId = 'kitchen_knife';
    } else if (includesAny(text, ['剪刀'])) {
      weaponId = 'scissors';
    } else if (includesAny(text, ['台灯', '灯'])) {
      weaponId = 'desk_lamp';
    } else if (includesAny(text, ['雨伞', '伞'])) {
      weaponId = 'umbrella';
    } else {
      weaponId = 'fists';
    }
    const a = createAction(raw, 'attack', 'chen_huaimin',
      weaponId ? `使用${weaponId}攻击陈怀民` : '徒手攻击',
      weaponId && weaponId !== 'fists' ? 0.72 : 0.35, 2, weaponId ? 5 : 3, 'high');
    (a as any).weaponId = weaponId;
    actions.push(a);
  }

  // ---- 拾取物品 ----
  if (includesAny(text, ['拿起', '捡起', '取出', '拿出', '翻出', '找到', '拎起', '抓起', '握起', '拿'])) {
    let itemId: string | undefined;
    if (includesAny(text, ['刀', '厨刀', '菜刀', '厨房'])) itemId = 'kitchen_knife';
    else if (includesAny(text, ['剪刀'])) itemId = 'scissors';
    else if (includesAny(text, ['台灯', '灯'])) itemId = 'desk_lamp';
    else if (includesAny(text, ['雨伞', '伞'])) itemId = 'umbrella';
    else if (includesAny(text, ['胶带', '透明胶', '封箱'])) itemId = 'tape';
    else if (includesAny(text, ['急救包', '绷带', '药', '消毒'])) itemId = 'first_aid_kit';
    else if (includesAny(text, ['充电器', '充电线', '充电'])) itemId = 'phone_charger';
    else if (includesAny(text, ['打火机', '火机', '点火'])) itemId = 'lighter';
    else if (includesAny(text, ['螺丝刀', '螺丝批', '改锥'])) itemId = 'screwdriver';
    else if (includesAny(text, ['衣架', '铁丝', '衣挂'])) itemId = 'hanger';
    else if (includesAny(text, ['镜子'])) itemId = 'mirror';
    else if (includesAny(text, ['漂白水', '清洁剂', '消毒水', '氨水'])) itemId = 'bleach';
    else if (includesAny(text, ['笔', '便签', '纸', '纸条'])) itemId = 'pen_paper';
    else if (includesAny(text, ['报纸', '杂志'])) itemId = 'newspaper';
    else if (includesAny(text, ['皮带', '腰带'])) itemId = 'belt';
    else if (includesAny(text, ['手电', '手电筒', '电筒'])) itemId = 'flashlight';
    if (itemId) {
      const a = createAction(raw, 'pick_up', itemId, `拿起${itemId}`, 0.82, 1, 1, 'low');
      (a as any).itemId = itemId;
      a.itemKind = ['kitchen_knife', 'scissors', 'desk_lamp', 'umbrella'].includes(itemId)
        ? 'weapon'
        : 'utility';
      actions.push(a);
    }
  }

  // ---- 使用物品 ----
  if (includesAny(text, ['用', '使用', '封住', '封门', '包扎', '处理伤口',
    '充电', '插上', '手机没电', '点火', '烧', '照亮', '照',
    '撬', '拧', '拆', '勾', '钩', '反射', '写', '记'])) {
    let itemId: string | undefined;
    if (includesAny(text, ['胶带', '封住', '封门', '贴'])) itemId = 'tape';
    else if (includesAny(text, ['急救包', '包扎', '伤口', '绷带'])) itemId = 'first_aid_kit';
    else if (includesAny(text, ['充电', '插上', '充电器', '手机没电'])) itemId = 'phone_charger';
    else if (includesAny(text, ['打火机', '火', '烧', '点'])) itemId = 'lighter';
    else if (includesAny(text, ['螺丝刀', '撬', '拧', '拆'])) itemId = 'screwdriver';
    else if (includesAny(text, ['衣架', '铁丝', '勾', '钩'])) itemId = 'hanger';
    else if (includesAny(text, ['镜子', '反射'])) itemId = 'mirror';
    else if (includesAny(text, ['漂白水', '清洁剂', '消毒'])) itemId = 'bleach';
    else if (includesAny(text, ['笔', '便签', '写', '记', '纸条'])) itemId = 'pen_paper';
    else if (includesAny(text, ['报纸', '杂志', '塞'])) itemId = 'newspaper';
    else if (includesAny(text, ['皮带', '腰带', '绑', '捆'])) itemId = 'belt';
    else if (includesAny(text, ['手电', '照亮', '照'])) itemId = 'flashlight';
    if (itemId) {
      const a = createAction(raw, 'use_item', itemId, `使用${itemId}`, 0.84, 1, 1, 'low');
      (a as any).itemId = itemId;
      actions.push(a);
    }
  }

  // ---- 智斗/陷阱/误导类 ----
  if (includesAny(text, ['设陷阱', '绊线', '绊倒', '制造假象', '误导', '伪装', '假装',
    '骗', '火警', '触发警报', '制造混乱', '声东击西', '调虎离山',
    '引诱', '引开', '支开', '拖延时间', '争取时间'])) {
    actions.push(createAction(raw, 'deceive', 'chen_huaimin', '用计策误导或拖延杀手', 0.76, 2, 2, 'medium'));
  }

  // ---- 搜身/搜尸体 ----
  if (includesAny(text, ['搜身', '搜尸体', '翻口袋', '检查尸体', '看他身上', '他身上有什么'])) {
    actions.push(createAction(raw, 'inspect', 'chen_huaimin', '搜索尸体上的物品和信息', 0.85, 2, 1, 'medium'));
  }

  // ---- 答非所问防护：有明确动作动词但没匹配到任何规则 ----
  if (actions.length === 0 && includesAny(text, ['追', '冲', '砍', '杀', '打', '刺', '捅', '砸', '逃', '跑', '开门', '踹'])) {
    // 宁可低置信度匹配最接近的意图，绝不默认 wait
    actions.push(createAction(raw, 'escape', 'front_door', '冲出房门采取行动', 0.42, 2, 4, 'high'));
    warnings.push('无法精确理解你的意图，但检测到动作意图——绝不会让你停在原地。');
  }

  if (actions.length === 0) {
    actions.push(createAction(raw, 'wait', 'self', '把这个想法压低成一次谨慎的停顿和观察', 0.46, 1, 0, 'medium'));
    warnings.push('这个行动比较开放，当前版本会先按谨慎观察处理。');
  }

  const orderedActions = actions
    .map((action, index) => ({ action, index, order: actionOrderIndex(action, text) }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index))
    .map(entry => entry.action);
  const confidence = orderedActions.reduce((sum, action) => sum + action.confidence, 0) / orderedActions.length;

  return {
    id: `plan-${Date.now()}`,
    raw,
    summary: orderedActions.map((action) => action.method).join('；'),
    actions: orderedActions.slice(0, 6),
    confidence,
    warnings,
  };
}
