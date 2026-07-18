export const audioSoundFolders = {
  door_lock: '锁门声',
  door_scratch: '门锁刮擦声',
  door_knock: '敲门声',
  door_chain: '门链声',
  door_open: '开门声',
  key_insert: '钥匙插入声',
  phone_msg: '短信提示音',
  phone_call: '来电铃声',
  phone_shutter: '拍照快门声',
  phone_tap: '触屏点击声',
  phone_dial: '拨号音',
  footstep_near: '近处脚步声',
  footstep_far: '远处脚步声',
  footstep_leave: '脚步远离声',
  elevator_echo: '电梯回声',
  power_cut: '断电声',
  light_hum: '电流底噪声',
  chair_drag: '拖动家具声',
  curtain_slide: '窗帘滑动声',
  closet_open: '衣柜开关声',
  water_tank: '水箱检查声',
  bottle_cap: '拧瓶盖声',
  clue_new: '新线索提示音',
  threat_up: '威胁警告音',
  window_scrape: '窗户刮擦声',
  awning_drip: '雨棚滴水声',
  voice_dongxine: '人声短语',
  hallway_hum: '楼道底噪声',
  pipe_water: '管道水流声',
  tv_murmur: '隔壁电视声',
  heartbeat_fast: '快速心跳声',
  heartbeat_slow: '缓慢心跳声',
  silence_tense: '紧张沉默底噪',
  metal_hit: '金属撞击声',
  knife_slash: '刀具声',
  glass_break: '玻璃破碎声',
  alarm_sound: '警报声',
  ui_error_sfx: 'UI错误提示音',
  ui_success_sfx: 'UI成功提示音',
} as const;

export type AudioSoundId = keyof typeof audioSoundFolders;

export interface ActionAudioOption {
  soundId: AudioSoundId;
  label: string;
  intents: string[];
  hints: string[];
}

export interface ActionAudioCue {
  id: string;
  soundId: AudioSoundId;
  confidence: number;
  reason: string;
  source: 'ai';
}

export const actionAudioCatalog: ActionAudioOption[] = [
  {
    soundId: 'door_lock',
    label: '锁门声',
    intents: ['secure_entry'],
    hints: ['反锁', '上锁', '锁门', '门锁', '门把'],
  },
  {
    soundId: 'door_chain',
    label: '门链声',
    intents: ['secure_entry', 'open_door'],
    hints: ['门链', '挂链', '扣上门链', '先开一条缝'],
  },
  {
    soundId: 'chair_drag',
    label: '拖动家具声',
    intents: ['secure_entry'],
    hints: ['拖椅子', '搬桌子', '堵门', '顶住房门'],
  },
  {
    soundId: 'phone_shutter',
    label: '拍照快门声',
    intents: ['preserve_evidence'],
    hints: ['拍照', '截图', '留存影像', '拍下来'],
  },
  {
    soundId: 'phone_tap',
    label: '触屏点击声',
    intents: ['record', 'verify_identity', 'communicate'],
    hints: ['点开手机', '输入', '回消息', '录音', '核实'],
  },
  {
    soundId: 'phone_msg',
    label: '短信提示音',
    intents: ['communicate', 'deceive'],
    hints: ['发消息', '短信', '回复', '套话'],
  },
  {
    soundId: 'phone_dial',
    label: '拨号音',
    intents: ['call_police'],
    hints: ['拨号', '报警', '110', '拨出去'],
  },
  {
    soundId: 'phone_call',
    label: '来电铃声',
    intents: ['call_police', 'communicate'],
    hints: ['电话', '通话', '接通', '呼叫'],
  },
  {
    soundId: 'closet_open',
    label: '衣柜开关声',
    intents: ['hide_evidence', 'pick_up'],
    hints: ['拉开柜门', '翻衣柜', '塞进去', '拿东西'],
  },
  {
    soundId: 'bottle_cap',
    label: '拧瓶盖声',
    intents: ['self_care', 'use_item'],
    hints: ['药瓶', '急救', '拧开', '使用物品'],
  },
  {
    soundId: 'window_scrape',
    label: '窗户刮擦声',
    intents: ['escape', 'inspect'],
    hints: ['推窗', '扒窗', '窗框', '窗沿', '翻窗'],
  },
  {
    soundId: 'curtain_slide',
    label: '窗帘滑动声',
    intents: ['inspect'],
    hints: ['掀开窗帘', '拉窗帘', '窗边观察'],
  },
  {
    soundId: 'water_tank',
    label: '水箱检查声',
    intents: ['inspect', 'hide_evidence'],
    hints: ['水箱', '卫生间', '马桶后面', '藏进水箱'],
  },
  {
    soundId: 'knife_slash',
    label: '刀具声',
    intents: ['attack', 'pick_up', 'use_item'],
    hints: ['拿刀', '挥刀', '刀尖', '菜刀', '剪刀'],
  },
  {
    soundId: 'metal_hit',
    label: '金属撞击声',
    intents: ['attack', 'pick_up', 'use_item'],
    hints: ['砸', '敲', '金属', '台灯', '硬物'],
  },
  {
    soundId: 'door_open',
    label: '开门声',
    intents: ['open_door', 'escape'],
    hints: ['开门', '拉开门', '冲出门', '出门'],
  },
];
