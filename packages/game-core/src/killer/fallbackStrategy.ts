import type { GameState, KillerStrategy } from '@murder-loop-ai/shared';

function recentlyUsed(state: GameState, type: KillerStrategy['type'], windowSize = 5) {
  const recent = state.log.slice(-windowSize);
  return recent.some((entry) => entry.title.includes(type) || entry.text.includes(type) || (
    type === 'phone_probe' && entry.text.includes('是否睡着') && entry.text.includes('快递')
  ));
}

function wasPhoneProbeUsed(state: GameState) {
  return state.log.some((entry) => entry.text.includes('是否睡着') && entry.text.includes('快递'));
}

/** 统计连续无有效行动的回合数（wait/open_door 且无防御加固） */
function countIdleTurns(state: GameState): number {
  let count = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i];
    if (entry.channel !== 'action') continue;
    const isIdle = entry.text.includes('等待') || entry.text.includes('保持原位') || entry.text.includes('停在原地')
      || entry.text.includes('没有新的主动') || entry.text.includes('时间继续走');
    if (isIdle) { count++; } else { break; }
  }
  return count;
}

export function chooseFallbackKillerStrategy(state: GameState): KillerStrategy {
  const k = state.killerKnowledge;

  if (state.ending) {
    return {
      id: `killer-${Date.now()}`,
      type: 'retreat',
      title: '对抗结束',
      rationale: '这一轮已经结束。',
      visibleToPlayer: false,
      risk: 'low',
    };
  }

  // ---- 杀手状态守卫（新） ----
  // 杀手已死/被捕 → 无法继续施压
  if (state.killerStatus === 'dead' || state.killerStatus === 'arrested') {
    return {
      id: `killer-${Date.now()}`,
      type: 'retreat',
      title: '威胁消失',
      rationale: '陈怀民已无法继续施加压力。',
      visibleToPlayer: false,
      risk: 'low',
    };
  }
  // 杀手已逃跑
  if (state.killerStatus === 'fled') {
    return {
      id: `killer-${Date.now()}`,
      type: 'retreat',
      title: '房东已逃离',
      rationale: '陈怀民逃离了公寓，后续压力仅来自环境。',
      visibleToPlayer: false,
      risk: 'low',
    };
  }
  // 杀手受重伤 → 更绝望/激进的策略
  if (state.killerStatus === 'injured') {
    return {
      id: `killer-${Date.now()}`,
      type: state.threat > 60 ? 'spare_key_entry' : 'retreat',
      title: state.threat > 60 ? '孤注一掷' : '负伤撤退',
      rationale: state.threat > 60 ? '受伤后陈怀民选择赌上一切。' : '受伤后陈怀民暂时撤退。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }
  // 杀手无力反抗
  if (state.killerStatus === 'incapacitated') {
    return {
      id: `killer-${Date.now()}`,
      type: 'retreat',
      title: '无力继续',
      rationale: '陈怀民已无力继续施加压力。',
      visibleToPlayer: false,
      risk: 'low',
    };
  }

  const lastAction = state.log.slice().reverse().find((entry) => entry.channel === 'action');
  if (state.policePhase === 'real_police_en_route') {
    return {
      id: `killer-${Date.now()}`,
      type: 'direct_confrontation',
      title: '最后施压',
      rationale: '真警已经确认并在路上，陈怀民不再适合伪装权威，只会尝试最后一次现实施压或撤离。',
      responseHint: '门外的人第一次失去耐心。他没有再装成警察，只压低声音让你撤回报警、交出包裹；楼道远处有真实的对讲机电流声逼近。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (lastAction?.title.includes('房东在试探') || lastAction?.text.includes('发了出去')) {
    return {
      id: `killer-${Date.now()}`,
      type: 'message_reply',
      title: '消息接上了',
      rationale: '玩家刚刚回复了陈怀民或陌生号码，本回合应该先承接对话，而不是切到新的敲门/断电压力。',
      responseHint: '手机屏幕在十几秒后再次亮起。陌生号码只回：“哪个包裹？你先别动，我上来确认一下。”字句很短，却把话题钉回了门口那只纸箱。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  if (state.policePhase !== 'not_contacted' && !state.clues.some(c => c.id === 'police_verified') && state.threat >= 55) {
    return {
      id: `killer-${Date.now()}`,
      type: 'fake_callback',
      title: '伪造回拨',
      rationale: '玩家已经等待官方核验，陈怀民尝试抢先制造一个假的权威声音。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (state.linYuePhase === 'received_photo' && state.threat >= 45) {
    return {
      id: `killer-${Date.now()}`,
      type: 'lure_linyue',
      title: '引林越上楼',
      rationale: '外部联系人已经介入，陈怀民会尝试把外部支援变成新的弱点。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  // 高压阶段 → 不再用电表箱，直接施压
  if (state.threat >= 58 && state.player.stress >= 35 && !state.room.front_door.state.barricaded) {
    return {
      id: `killer-${Date.now()}`,
      type: 'spare_key_entry',
      title: '钥匙入锁孔',
      rationale: '耐心耗尽，直接尝试备用钥匙进入。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (state.threat >= 52 && !state.room.window.state.locked) {
    return {
      id: `killer-${Date.now()}`,
      type: 'window_route',
      title: '窗外有人',
      rationale: '窗户没锁，陈怀民考虑替代入口。',
      visibleToPlayer: false,
      risk: 'high',
    };
  }

  if (state.policePhase !== 'not_contacted' && !state.clues.some(c => c.id === 'police_verified')) {
    return {
      id: `killer-${Date.now()}`,
      type: 'fake_police',
      title: '假警察抢先到场',
      rationale: '玩家已经报警但尚未核实身份，陈怀民会利用等待权威的心理。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (k.knowsDoorBarricaded && !k.knowsWindowLocked) {
    return {
      id: `killer-${Date.now()}`,
      type: 'window_route',
      title: '窗外路线被考虑',
      rationale: '门被堵住后，陈怀民会寻找替代入口。',
      visibleToPlayer: false,
      risk: 'high',
    };
  }

  if (!k.suspectsPlayerIsAlert && state.minute < 23 * 60 + 28 && state.killerPhase === 'confirming_package' && !wasPhoneProbeUsed(state)) {
    return {
      id: `killer-${Date.now()}`,
      type: 'phone_probe',
      title: '陌生号码试探',
      rationale: '陈怀民还不确定沈知夏是否意识到包裹价值，先用电话试探。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  if (state.threat >= 64 && !state.room.front_door.state.barricaded) {
    return {
      id: `killer-${Date.now()}`,
      type: 'spare_key_entry',
      title: '备用钥匙靠近锁芯',
      rationale: '门没有形成有效阻挡，陈怀民可能直接使用备用钥匙。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }


  if (!recentlyUsed(state, 'landlord_excuse')) {
    return {
      id: `killer-${Date.now()}`,
      type: 'landlord_excuse',
      title: '房东借口靠近',
      rationale: '温和试探仍然是低风险方式。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  return {
    id: `killer-${Date.now()}`,
    type: 'wait_for_fatigue',
    title: '走廊短暂停顿',
    rationale: '最近已经用过房东借口，改用沉默和位置变化制造压力，避免重复。',
    visibleToPlayer: true,
    risk: 'low',
  };
}
