import type { ClueRecord } from '@murder-loop-ai/shared';

/**
 * 线索模板（不含 discoveredAt——发现时才填充）。
 * 作为 AI 失败时的 fallback，也是 AI 生成线索的约束边界。
 */
export const clueBook: Record<string, Omit<ClueRecord, 'discoveredAt'>> = {
  wrong_package: {
    id: 'wrong_package',
    title: '标记模糊的包裹',
    detail: '包裹上的 5-03 / 503 标记很模糊，可能并不是寄给沈知夏。',
    source: 'player_discovered',
    weight: 12,
    isPersistent: true,
  },
  package_photo: {
    id: 'package_photo',
    title: '包裹照片',
    detail: '沈知夏拍下了旧书、药盒和数字纸条。这是外部求救链的起点。',
    source: 'player_discovered',
    weight: 16,
    isPersistent: true,
  },
  linyue_has_photo: {
    id: 'linyue_has_photo',
    title: '林越收到照片',
    detail: '林越成为包裹证据的外部备份，也因此可能被卷入风险。',
    source: 'player_discovered',
    weight: 14,
    isPersistent: true,
  },
  door_scratch: {
    id: 'door_scratch',
    title: '锁芯划痕',
    detail: '门锁边有新鲜划痕，说明有人尝试过进入。',
    source: 'player_discovered',
    weight: 10,
    isPersistent: true,
  },
  recording_pressure: {
    id: 'recording_pressure',
    title: '录音里的停顿',
    detail: '录音记录到门外人在听见屋内动静后停顿，说明对方在试探沈知夏是否醒着。',
    source: 'player_discovered',
    weight: 12,
    isPersistent: true,
  },
  police_verified: {
    id: 'police_verified',
    title: '核实出警',
    detail: '通过官方渠道核实后，假警察话术的漏洞变得明显。',
    source: 'player_discovered',
    weight: 18,
    isPersistent: true,
  },
  unknown_number_probe: {
    id: 'unknown_number_probe',
    title: '陌生号码试探包裹',
    detail: '陌生号码没有说明身份，却反复确认你是否“拿错东西”、是否看见门口的快递。',
    source: 'player_discovered',
    weight: 14,
    isPersistent: true,
  },
  // ---- 新增：战斗/杀手相关线索 ----
  chen_body: {
    id: 'chen_body',
    title: '陈怀民的尸体',
    detail: '陈怀民倒在门外。他的外套口袋鼓着——里面有东西可以搜。',
    source: 'player_discovered',
    weight: 20,
    isPersistent: true,
  },
  chen_keys: {
    id: 'chen_keys',
    title: '房东的备用钥匙',
    detail: '从陈怀民身上找到一串钥匙，其中有 503 的备用钥匙。这解释了他是怎么进来的。',
    source: 'player_discovered',
    weight: 15,
    isPersistent: true,
  },
  chen_phone_found: {
    id: 'chen_phone_found',
    title: '房东的手机',
    detail: '陈怀民的手机里有毒品交易记录、陌生号码的收发短信、和一个标注为”上游”的联系人。',
    source: 'player_discovered',
    weight: 18,
    isPersistent: true,
  },
  weapon_found: {
    id: 'weapon_found',
    title: '找到了一件可用武器',
    detail: '房间里有什么东西可以用来防身。在紧急情况下，日常物品也可以成为武器。',
    source: 'player_discovered',
    weight: 8,
    isPersistent: true,
  },
  battery_critical: {
    id: 'battery_critical',
    title: '手机快没电了',
    detail: '屏幕右上角的电量图标闪红。再过不久，手机就会彻底关机——通讯、录音、拍照，全部断掉。',
    source: 'player_discovered',
    weight: 14,
    isPersistent: true,
  },
  linyue_retracted_message: {
    id: 'linyue_retracted_message',
    title: '林越撤回的消息',
    detail: '林越发来“那个包裹你别……”后立刻撤回。语气不像试探，更像临时压下去的担心。',
    source: 'player_discovered',
    weight: 10,
    isPersistent: true,
  },
  false_police_overknows: {
    id: 'false_police_overknows',
    title: '假警察说漏的细节',
    detail: '门外自称警察的人准确说出“纸箱”，但报警时你并没有提供这个细节。',
    source: 'player_discovered',
    weight: 18,
    isPersistent: true,
  },
  room_403_receipt: {
    id: 'room_403_receipt',
    title: '403 收据',
    detail: '旧书夹层里的潮湿收据写着“青藤公寓 403”，说明包裹可能经过另一个房间中转。',
    source: 'player_discovered',
    weight: 17,
    isPersistent: true,
  },
  peephole_blind_spot: {
    id: 'peephole_blind_spot',
    title: '猫眼盲区的人影',
    detail: '门外感应灯亮着，但猫眼里没人。对方可能刻意站在视野死角。',
    source: 'player_discovered',
    weight: 12,
    isPersistent: true,
  },
  fake_store_call: {
    id: 'fake_store_call',
    title: '不存在的便利店来电',
    detail: '对方声称你在楼下便利店落了东西，但你今晚并没有去过那里。',
    source: 'player_discovered',
    weight: 13,
    isPersistent: true,
  },
  handoff_failed_2347: {
    id: 'handoff_failed_2347',
    title: '23:47 的交接失败',
    detail: '23:47 后，楼下传来“货没回去”的低声对话，说明这个时间点原本是包裹交接或回收节点。',
    source: 'player_discovered',
    weight: 20,
    isPersistent: true,
  },
};

/** 从模板创建完整 ClueRecord（填上发现时间） */
export function createClueFromTemplate(
  templateId: string,
  run: number,
  minute: number,
): ClueRecord | null {
  const template = clueBook[templateId];
  if (!template) return null;
  return {
    ...template,
    discoveredAt: { run, minute },
  };
}
