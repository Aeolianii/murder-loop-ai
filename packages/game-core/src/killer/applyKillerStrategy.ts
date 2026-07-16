import type { GameState, KillerStrategy, RuleResult, StoryLogEntry } from '@murder-loop-ai/shared';
import { cloneGameState } from '../state/createInitialState';
import { event } from '../narration/buildNarrationContext';
import { absorbReviveProtection, hasReviveProtection } from '../loop/reviveProtection';
import { markEnding } from '../rules/endingRules';

function pickVariant<T>(items: T[], seed: number) {
  return items[Math.abs(seed) % items.length];
}

function pushEntry(state: GameState, result: Omit<RuleResult, 'state'>) {
  const entry: StoryLogEntry = {
    id: `killer-log-${state.run}-${state.minute}-${Math.random().toString(36).slice(2, 8)}`,
    run: state.run,
    minute: state.minute,
      title: result.title,
      text: result.text,
      tone: result.tone,
      channel: result.tone === 'system' ? 'system' : 'ambient',
    };
  state.log.push(entry);
}

function end(state: GameState, reason: NonNullable<GameState['endingReason']>, title: string, text: string): RuleResult {
  const result = markEnding(state, 'death', reason, title, text);
  pushEntry(state, result);
  return result;
}

export function applyKillerStrategy(current: GameState, strategy: KillerStrategy): RuleResult {
  const state = cloneGameState(current);
  let title = strategy.title;
  let text = '门外暂时没有新的可见动作；楼道里的底噪仍压在门缝外。';
  let threatDelta = strategy.risk === 'high' ? 10 : strategy.risk === 'medium' ? 5 : 1;

  if (state.ending) {
    return { title: '对抗结束', text: '这一轮已经结束。', tone: 'system', addedClues: [], timePassed: 0, threatDelta: 0, events: [event('ending', 'loop', '这一轮已经结束。')], state };
  }

  // ---- 杀手状态守卫 ----
  if (state.killerStatus === 'dead' || state.killerStatus === 'arrested' || state.killerStatus === 'fled') {
    return {
      title: '威胁消失', text: '陈怀民已无法继续施加压力。', tone: 'system',
      addedClues: [], timePassed: 0, threatDelta: -10,
      events: [event('state_change', 'killer_gone', '陈怀民已无法继续施加压力。')],
      state,
    };
  }
  if (state.killerStatus === 'incapacitated') {
    return {
      title: '无力继续', text: '陈怀民已无力反抗。', tone: 'system',
      addedClues: [], timePassed: 0, threatDelta: -5,
      events: [event('state_change', 'killer_down', '陈怀民已无力反抗。')],
      state,
    };
  }

  switch (strategy.type) {
    case 'phone_probe':
      text = pickVariant([
        '陌生号码发来房东名义的信息，询问是否睡着、是否看见快递。',
        '陌生号码只发来一句：“门口那个包裹你拿进去了吗？”发送时间卡在这一分钟。',
        '手机屏幕亮起，陌生号码没有自报姓名，只说房东让他确认 503 门口的快递。',
      ], state.minute);
      state.killerPhase = 'soft_pressure';
      break;
    case 'soft_knock':
    case 'landlord_excuse':
      text = pickVariant([
        '门外出现两次轻敲；陈怀民用漏水检查作为开门理由。',
        '猫眼边缘掠过一小片深色袖口，随后门外有人压低声音说要核对住户登记。',
        '走廊感应灯亮了一下，门外的人没有立刻敲门，只把“房东检查”四个字说得很轻。',
      ], state.minute + state.threat);
      state.killerPhase = 'soft_pressure';
      break;
    case 'fake_police':
      state.phase = 'false_police_arrived';
      state.killerPhase = 'deception';
      text = '门外有人自称派出所民警，要求开门配合，但身份尚未核实。';
      break;
    case 'direct_confrontation':
      threatDelta = 6;
      state.phase = state.policePhase === 'real_police_en_route' ? 'confrontation' : state.phase;
      state.killerPhase = 'exposed';
      text = strategy.responseHint || '门外的人失去伪装，压低声音做最后一次威胁；楼道远处的真实动静正在逼近。';
      break;
    case 'spare_key_entry':
      if (!state.room.front_door.state.locked && !state.room.front_door.state.barricaded) {
        if (hasReviveProtection(state)) {
          const protection = absorbReviveProtection(state, 'forced_entry');
          pushEntry(state, protection);
          return { ...protection, state };
        }
        return end(state, 'forced_entry', '锁芯转动', '锁芯响起来的时候，我先以为是自己听错了。那声音太轻，像有人用指甲碰了一下金属。紧接着，门把手往下压。门缝里漏进来一线楼道的白光，我还没来得及后退，一个人已经用肩膀顶住门板。没有争吵，没有威胁，只有熟练到近乎安静的动作。');
      }
      text = '锁芯被尝试拨动；门的加固阻止了直接进入，但暴露了防备状态。';
      break;
    case 'window_route':
      if (!state.room.window.state.locked && state.threat >= 55) {
        if (hasReviveProtection(state)) {
          const protection = absorbReviveProtection(state, 'window_route');
          pushEntry(state, protection);
          return { ...protection, state };
        }
        return end(state, 'window_route', '窗外有人', '窗帘没有完全合上。雨声里，一只手从窗沿下方摸上来，指节被雨水泡得发白。我终于明白，门不是唯一入口。可这个念头出现得太晚，晚到我只能看见玻璃上自己的倒影被另一个影子覆盖。');
      }
      text = '窗外雨棚有轻微刮擦声，窗沿下方的雨水被蹭出一道断痕。';
      break;
    case 'framing_pressure':
      state.killerPhase = 'framing';
      text = '陌生号码开始用“私藏违禁品”的后果施压，逼我把包裹交出去或开门解释。';
      break;
    case 'power_cut':
      // 不再使用电表箱——改用更直接的压力
      threatDelta = 8;
      state.killerPhase = 'forced_entry';
      text = '门外的脚步不再试探。门把手被用力压下——锁舌发出短促的金属呻吟。';
      break;
    case 'lure_linyue':
      threatDelta = 7;
      state.killerPhase = 'deception';
      text = '林越收到可疑引导：有人试图让他上楼登记。';
      break;
    case 'fake_neighbor':
      threatDelta = 6;
      state.killerPhase = 'soft_pressure';
      text = '隔壁方向有人声要求查看漏水，位置避开猫眼正面。';
      break;
    case 'fake_callback':
      threatDelta = 9;
      state.killerPhase = 'deception';
      text = '本地座机号码来电，自称官方回拨，但背景声音异常单一。';
      break;
    case 'message_reply':
      threatDelta = strategy.risk === 'high' ? 7 : strategy.risk === 'medium' ? 4 : 1;
      state.killerPhase = 'deception';
      text = strategy.responseHint || '陌生号码很快回了消息，没有继续敲门，只把问题往包裹上拽：他要确认我到底看见了什么。';
      break;
    case 'wait_for_fatigue':
      threatDelta = 3;
      text = '门外长时间安静；电梯井偶尔传来一声很轻的金属回响。';
      break;
    case 'retreat':
      threatDelta = -6;
      text = '门外脚步声撤离到楼梯间；本次尝试暂时中止。';
      break;
  }

  state.threat = Math.max(0, Math.min(100, state.threat + threatDelta));
  const result = {
    title,
    text,
    tone: 'threat',
    addedClues: [],
    timePassed: 0,
    threatDelta,
    events: [event('threat', strategy.type, text, [strategy.title], strategy.visibleToPlayer ? 'player' : 'hidden')],
  } as Omit<RuleResult, 'state'>;
  pushEntry(state, result);
  return { ...result, state };
}
