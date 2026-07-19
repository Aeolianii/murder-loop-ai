import { clueBook } from '@murder-loop-ai/content';
import { DEADLINE_MINUTE, type ActionPlan, type ClueRecord, type GameState, type RuleResult, type StoryLogEntry } from '@murder-loop-ai/shared';
import { cloneGameState } from '../state/createInitialState';
import { event } from '../narration/buildNarrationContext';
import { ensurePoliceArrivalCountdown, isPoliceArrivalDue, resolvePoliceArrival } from './policeArrival';
import { absorbReviveProtection, hasReviveProtection } from '../loop/reviveProtection';
import { hasConvictingEvidence, markEnding } from './endingRules';
import { buildPlayerCommandsFromActionPlan } from '../domain/playerCommands';
import { applyPlayerDomainEventsToState, buildPlayerOutcomeDomainEvents, evaluatePlayerCommandDomainEvents } from '../domain/playerActionDomain';
import type { DomainEvent } from '../domain/domainEvents';

export interface PlayerRuleResult extends RuleResult {
  domainEvents: DomainEvent[];
}

/** 直接添加一条 ClueRecord（用于 AI 动态生成的线索） */
export function addDynamicClue(state: GameState, clue: ClueRecord): void {
  if (state.clues.some(c => c.id === clue.id)) return;
  state.clues.push(clue);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function calculateTurnTime(actions: ActionPlan['actions']) {
  if (actions.length === 0) return 1;
  const onlyWaiting = actions.every((action) => action.intent === 'wait');
  if (onlyWaiting) return 1;
  const analyzedMinutes = actions.reduce((sum, action) => {
    const timeCost = Number.isFinite(action.timeCost) ? action.timeCost : 1;
    return sum + clamp(Math.round(timeCost), 1, 5);
  }, 0);
  return clamp(analyzedMinutes, 1, 5);
}

const usableItemIds = new Set([
  'tape',
  'first_aid_kit',
  'phone_charger',
  'lighter',
  'screwdriver',
  'hanger',
  'mirror',
  'bleach',
  'pen_paper',
  'newspaper',
  'belt',
  'flashlight',
]);

function resolveUsableItemId(action: ActionPlan['actions'][number]) {
  const explicit = (action as any).itemId as string | undefined;
  if (explicit) return explicit;
  if (usableItemIds.has(action.target)) return action.target;

  const actionText = `${action.raw} ${action.method ?? ''} ${action.target}`.toLowerCase();
  const chargesPhone = action.target === 'phone'
    && (actionText.includes('充电') || actionText.includes('charger') || actionText.includes('charge'));
  return chargesPhone ? 'phone_charger' : undefined;
}

function extractReplyText(raw: string) {
  const quoted = raw.match(/[“"']([^”"']+)[”"']/)?.[1]?.trim();
  if (quoted) return quoted;
  return raw
    .replace(/我(回了|回复|回)他[:：]?/g, '')
    .replace(/(回消息|回短信|回复消息|回复短信|打字回复)[:：]?/g, '')
    .trim();
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function isAskingAboutLinYueRetraction(text: string) {
  return includesAny(text, ['撤回', '为什么', '包裹你别', '哪里不对', '怎么了', '说清楚']);
}

function isPhysicalDoorBlock(text: string) {
  const lower = text.toLowerCase();
  return includesAny(lower, [
    '堵门',
    '抵住门',
    '顶住门',
    '椅子',
    '行李箱',
    '胶带',
    '封门',
    '挡住门',
    'barricade',
    'block the door',
    'chair',
    'luggage',
    'suitcase',
  ]);
}

function pushEntry(state: GameState, result: Omit<RuleResult, 'state'>) {
  const entry: StoryLogEntry = {
    id: `log-${state.run}-${state.minute}-${Math.random().toString(36).slice(2, 8)}`,
    run: state.run,
    minute: state.minute,
      title: result.title,
      text: result.text,
      tone: result.tone,
      channel: result.tone === 'system' ? 'system' : 'action',
    };
  state.log.push(entry);
}

function advanceLinYueRiskIfIgnored(state: GameState, plan: ActionPlan, texts: string[]) {
  const contactedLinYue = plan.actions.some((action) => action.intent === 'communicate' && action.target === 'linyue');
  if (contactedLinYue) return;

  if (state.linYuePhase === 'worried') {
    state.linYuePhase = 'coming_to_apartment';
    texts.push('林越没有再发消息。几分钟后，聊天框里只跳出一句：“你别怕，我上楼看看。”');
    return;
  }

  if (state.linYuePhase === 'coming_to_apartment') {
    state.linYuePhase = 'endangered';
    state.threat = clamp(state.threat + 8);
    texts.push('林越的头像停在“正在输入”，却迟迟没有新消息。楼道里传来一声被雨声吞掉的闷响，他可能已经进入危险。');
  }
}

export function applyPlayerActions(current: GameState, plan: ActionPlan): PlayerRuleResult {
  const commands = buildPlayerCommandsFromActionPlan(plan, { run: current.run, minute: current.minute });
  const confirmedEvents = current.ending ? [] : evaluatePlayerCommandDomainEvents(current, commands);
  const result = applyPlayerActionsInternal(current, plan, confirmedEvents);
  return {
    ...result,
    domainEvents: buildPlayerOutcomeDomainEvents(confirmedEvents, current, result.state),
  };
}

function applyPlayerActionsInternal(
  current: GameState,
  plan: ActionPlan,
  domainEvents: DomainEvent[],
): RuleResult {
  const state = cloneGameState(current);
  const addedClues: ClueRecord[] = [];
  let complexityCost = 0;
  let threatDelta = 0;
  const texts: string[] = [];
  let title = '行动开始';
  let tone: RuleResult['tone'] = 'neutral';
  let phoneChargedThisTurn = false;

  if (state.ending) {
    return { title: '循环已经结束', text: '这一轮已经抵达结局。', tone: 'system', addedClues, timePassed: 0, threatDelta, events: [event('ending', 'loop', '这一轮已经抵达结局。')], state };
  }

  applyPlayerDomainEventsToState(state, domainEvents, { addedClues });
  phoneChargedThisTurn = domainEvents.some(
    (domainEvent) => domainEvent.eventType === 'item_used' && domainEvent.payload?.itemId === 'phone_charger',
  );

  for (const action of plan.actions) {
    complexityCost += action.timeCost;
    threatDelta += Math.max(0, action.noise - 1);

    switch (action.intent) {
      case 'inspect':
        if (action.target === 'package') {
          title = '包裹不是我的';
          tone = 'clue';
          texts.push(`检查包裹：纸箱已被拖到台灯下；旧书、药板和数字纸条暴露；新增线索：${clueBook.wrong_package.title}。`);
        } else if (action.target === 'front_door') {
          title = '锁芯有划痕';
          tone = 'clue';
          texts.push('检查门锁：锁芯旁有新划痕，边缘发亮，像刚被工具碰过。');
        } else if (action.target === 'window') {
          title = '窗外是雨棚';
          tone = 'clue';
          texts.push('检查窗户：窗外有雨棚，位置接近窗沿；窗锁需要确认。');
        } else if (action.target === 'room') {
          title = '房间被重新看见';
          texts.push('检查房间：床底、衣柜和卫生间门缝被确认；暂未发现屋内藏人。');
        }
        break;
      case 'preserve_evidence':
        title = '照片留下来了';
        tone = 'clue';
        texts.push('保存证据：快递面单、旧书、药板和数字纸条被拍照；快门声已尽量压低。');
        break;
      case 'communicate':
        if (action.target === 'linyue') {
          if (state.linYuePhase === 'calling_police') {
            title = '林越被劝住';
            tone = 'clue';
            texts.push('联系林越：你明确让他不要上楼，也不要靠近门口。林越终于停下：“好，我不上楼。我在楼下安全的地方报警，也帮你备份照片和聊天记录。”');
          } else if (state.linYuePhase === 'calling_player') {
            title = '林越坦白怀疑';
            tone = 'clue';
            texts.push('追问林越：他隔了几秒才回。“我不知道那是什么，但它不对劲。我刚才想说别碰，又怕你害怕。我现在上去看看。”');
          } else if (state.linYuePhase === 'coming_to_apartment') {
            title = '林越准备上楼';
            tone = 'threat';
            texts.push('联系林越：他把你的话理解成需要当面确认。“你别开门，我上来看看。”这句话落下时，你意识到他正在靠近危险。');
          } else {
            title = '林越收到消息';
            texts.push('联系林越：照片/信息已发送；林越回复会在楼下报警，不上楼。');
          }
        } else if (action.target === 'chen_huaimin') {
          title = '房东在试探';
          tone = 'threat';
          const replyText = extractReplyText(action.raw);
          texts.push(`联系陈怀民：你把“${replyText}”发了出去；这次回合只确认这句回复已经送达，不替你补出额外动作。`);
        }
        break;
      case 'deceive':
        title = '假装不知道';
        tone = 'threat';
        texts.push('伪装无知：对外表现为刚醒、没处理包裹；陈怀民暂停追问，但疑心上升。');
        break;
      case 'record':
        title = '录音红点亮起';
        tone = 'clue';
        texts.push('录音开启：手机开始保存室内和门外声音，麦克风位置已避开遮挡。');
        break;
      case 'secure_entry':
        if (action.target === 'front_door') {
          const actionText = `${action.raw} ${action.method ?? ''}`;
          const physicallyBlocked = isPhysicalDoorBlock(actionText);
          title = '门被临时加固';
          texts.push(physicallyBlocked
            ? '加固门：门锁和门链扣上，椅子或行李箱被移到门后形成临时阻挡；拖动家具产生轻微噪音。'
            : '反锁门：门锁和门链从屋内扣上；没有搬动家具，也没有制造新的物理堵门。');
        } else if (action.target === 'window') {
          title = '窗帘合上';
          texts.push('处理窗户：窗锁扣紧，窗帘拉严；雨棚路线暂时被挡住视线。');
        } else if (action.target === 'phone') {
          texts.push('处理手机：铃声和震动关闭，屏幕亮度压低，暴露风险下降。');
        }
        break;
      case 'hide_evidence':
        title = '证据被藏起';
        texts.push('隐藏证据：包裹位置改变；短期可拖延搜找，但现场痕迹增加。');
        break;
      case 'call_police':
        title = '报警不是终点';
        tone = 'clue';
        texts.push('报警：110 已接通；地址、当前处境和门窗状态被告知接线员。');
        break;
      case 'verify_identity':
        title = '先核实，再决定';
        tone = 'clue';
        texts.push('核实身份：要求对方报单位和警号，并等待官方回拨确认。');
        break;
      case 'escape':
        // 窗户路线：检查窗户/找消防梯/逃生路线
        if (action.target === 'window') {
          if (state.room.window.state.locked) {
            title = '窗户锁着';
            texts.push('窗户路线：窗锁扣紧，暂时打不开。窗外是雨棚，距离地面至少四层楼高。雨声很响，雨棚上的积水在滴。');
          } else {
            title = '窗户可以打开';
            texts.push('窗户路线：窗锁一拧就开，冷风和雨丝灌了进来。窗外是一个铁皮雨棚，踩上去会响——但它确实通向走廊尽头另一侧的窗户。');
          }
          break;
        }
        // 冲出门/逃跑
        threatDelta += 25;
        title = '门被撞开';
        texts.push('冲出门：门被猛地推开。' + (action.method || ''));
        break;
      case 'open_door':
        threatDelta += 18;
        title = '门开了一条缝';
        texts.push('打开门：门锁和门链被取下，门开了一条缝。走廊里的空气涌进来，带着雨水和灰尘的味道。');
        // 不判死——让 Killer AI 根据叙事上下文决定后果
        break;
      case 'self_care':
        title = '厨房灯没有打开';
        tone = 'neutral';
        texts.push('自我调整：短暂喝水/进食，动作压低；压力略微下降，但时间继续推进。');
        break;
      case 'wait':
        title = '雨声变清楚';
        texts.push('等待观察：保持原位，降低主动暴露；继续监听门外和楼道变化。');
        break;
      case 'attack': {
        // 叙事驱动的战斗——规则引擎只验证前置条件，AI 判断结果
        const weaponId = (action as any).weaponId as string | undefined;
        if (!state.combatTriggered && weaponId) {
          texts.push(`攻击（武器不可及）：你声称使用${weaponId}，但手边没有。叙事 AI 将揭示这一事实。`);
        } else {
          texts.push(`${action.method || '攻击'}：${action.raw}（战斗触发，AI 叙事判断结果）`);
        }
        title = '战斗爆发';
        tone = 'threat';
        break;
      }
      case 'pick_up': {
        const itemId = (action as any).itemId as string | undefined;
        if (itemId) {
          texts.push(`拾取：${itemId}——现在在你手中。`);
          title = '手指握紧了';
        } else {
          texts.push('你扫视了一圈，不确定要拿什么。');
        }
        break;
      }
      case 'use_item': {
        const itemId = resolveUsableItemId(action);
        if (itemId === 'tape' && state.playerHolding === 'tape') {
          texts.push('使用胶带：门缝被胶带封住，加固了临时防御。');
          title = '胶带嘶啦一声';
        } else if (itemId === 'first_aid_kit') {
          texts.push('使用急救包：伤口被简单处理，疼痛减轻了一些。');
          title = '绷带的触感';
        } else if (itemId === 'phone_charger') {
          texts.push('充电器插上——屏幕亮起，电量图标从红色跳回绿色。');
          title = '电量回升';
        } else {
          texts.push(`使用物品：${itemId || '未知'}——效果取决于具体物品。`);
        }
        break;
      }
      default:
        // 不阻止任何行动——记录玩家意图，交给 AI 叙事判断
        title = action.method || action.intent;
        texts.push(`${action.method || action.intent}：${action.raw}`);
        break;
    }
  }

  const timePassed = calculateTurnTime(plan.actions);
  const compressedTime = complexityCost > timePassed;

  state.minute += timePassed;
  state.threat = clamp(state.threat + threatDelta + (state.minute >= DEADLINE_MINUTE - 10 ? 4 : 0));

  // ---- 战斗触发的结局检测（在 23:47 之前也可能结束） ----
  if (state.combatTriggered && !state.ending) {
    const hasEvidence = hasConvictingEvidence(state);
    if (state.killerStatus === 'dead' && hasEvidence) {
      return markEnding(state, 'escaped_with_evidence', 'killer_dead_with_evidence', '不是你死，就是我活', '刀落在瓷砖上，声音比想象中轻。陈怀民的身体滑倒在地，手机从外套口袋里滑出来，屏幕还亮着——上面是他和"上游"的对话。你捡起手机，把录音和照片一起按下了发送。这一次，证据比你更早抵达外面。');
    }
    if (state.killerStatus === 'dead' && !hasEvidence) {
      return markEnding(state, 'escaped_no_evidence', 'killer_dead_no_evidence', '门外的身体还有余温', '陈怀民不再动了。你靠着门框喘气，手指还在发抖。但当你低头看向自己空空的手机相册和没有发送的消息记录时，你意识到——你杀了一个人，但没有任何证据证明他该死。警笛声从远处传来，留给你的时间以秒计算。');
    }
  }

  if (state.minute >= DEADLINE_MINUTE && !state.ending) {
    const hasEvidence = hasConvictingEvidence(state);
    const hasDefense = Boolean(state.room.front_door.state.barricaded) && Boolean(state.room.window.state.locked);
    const policeTrusted = state.policePhase === 'real_police_en_route'
      || state.clues.some(c => c.id === 'police_verified')
      || state.linYuePhase === 'calling_police';

    if (hasEvidence && hasDefense && policeTrusted) {
      return markEnding(state, 'escaped_with_evidence', 'deadline_survived_with_evidence', '23:47 没有吞掉我', '电子钟跳到 23:47 的时候，我几乎不敢眨眼。门外的人没有等到我开门，锁芯也没有再转动。录音、照片和官方回拨把这间屋子从孤岛变成了现场。我还活着，但我知道这不只是因为运气——是因为这一轮，我终于把证据送出了房间。');
    }

    if (hasReviveProtection(state)) {
      const protection = absorbReviveProtection(state, 'deadline');
      pushEntry(state, protection);
      return { ...protection, state };
    }

    return markEnding(state, 'death', 'deadline_murder', '23:47', '电子钟跳到 23:47。门外的人不再敲门，锁芯却轻轻响了一声。我那一瞬间才明白，自己还是慢了一步：证据没有送到足够远的地方，门窗也没有把危险挡在外面。黑暗从门缝里挤进来，像上一轮死亡时一样熟悉。');
  }

  if (state.policePhase === 'dispatch_pending' && state.clues.some(c => c.id === 'police_verified')) {
    state.policePhase = 'real_police_en_route';
  }

  ensurePoliceArrivalCountdown(state);

  if (isPoliceArrivalDue(state) && !state.ending) {
    const policeResult = resolvePoliceArrival(state);
    pushEntry(state, policeResult);
    return { ...policeResult, state };
  }

  state.phase = state.minute >= DEADLINE_MINUTE - 5
    ? 'pre_2347_countdown'
    : state.policePhase === 'real_police_en_route'
      ? 'confrontation'
    : state.policePhase !== 'not_contacted'
      ? 'police_called'
      : state.threat >= 48
        ? 'killer_pressure'
        : 'investigating';

  advanceLinYueRiskIfIgnored(state, plan, texts);

  const result = {
    title,
    text: texts.join('\n\n') || '我把这个想法压低到一次可执行的动作。房间仍旧安静，但安静本身也在变化。窗外的雨、门外的走廊、手机屏幕上没有发出的消息，都像在等我做下一个决定。',
    tone,
    addedClues,
    timePassed,
    threatDelta,
    events: [
      event('action', 'player', plan.summary || '玩家执行了一组行动', texts.slice(0, 3)),
      ...addedClues.map((clue) => event('clue', clue.id, `新增线索：${clue.title}`, [], 'player')),
      event('state_change', 'time', compressedTime ? '一连串动作被压缩在短短几分钟内完成；电子钟只往后跳了一小格。' : '墙上的电子钟往后跳了一小段；走廊里的动静比刚才更靠近房门。', ['电子钟', '走廊声']),
    ],
  } satisfies Omit<RuleResult, 'state'>;
  // ---- 手机电量管理 ----
  if (state.phoneFunctional) {
    if (!phoneChargedThisTurn) {
      const perMin = state.room.phone?.state?.recording ? 3 : 1.5;
      state.phoneBattery = Math.max(0, state.phoneBattery - Math.round(perMin * timePassed));
    }
    // 同步到 room.phone.state 供旧逻辑读取
    if (state.room.phone?.state) {
      (state.room.phone.state as any).battery = state.phoneBattery;
    }
    if (state.phoneBattery <= 0) {
      state.phoneFunctional = false;
      if (state.room.phone?.state) {
        state.room.phone.state.recording = false;
        state.room.phone.state.muted = true;
      }
      return markEnding(
        state,
        'death',
        'phone_battery_depleted',
        '手机黑屏',
        '屏幕最后闪了一下，红色电池图标熄灭。报警、录音、照片和外界的声音一起断掉。房间重新变成一座孤岛，而门外的人还在。',
      );
    }
  }
  pushEntry(state, result);
  return { ...result, state };
}
