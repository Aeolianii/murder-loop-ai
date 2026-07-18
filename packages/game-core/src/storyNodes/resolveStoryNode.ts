import type { ActionPlan, GameState } from '@murder-loop-ai/shared';
import { DEADLINE_MINUTE } from '@murder-loop-ai/shared';
import type { StoryNodeDefinition, StoryNodeResolution } from './storyNodeTypes';

function hasClue(state: GameState, clueId: string) {
  return state.clues.some((clue) => clue.id === clueId);
}

function isUsingPhone(plan: ActionPlan) {
  const phoneIntents = new Set([
    'preserve_evidence',
    'record',
    'communicate',
    'call_police',
    'verify_identity',
  ]);

  return plan.actions.some((action) =>
    phoneIntents.has(action.intent) ||
    action.target === 'phone' ||
    `${action.raw} ${action.method ?? ''} ${action.target}`.includes('手机')
  );
}

function actionText(plan: ActionPlan) {
  return plan.actions
    .map((action) => `${action.raw} ${action.method ?? ''} ${action.target}`)
    .join(' ')
    .toLowerCase();
}

function hasIntent(plan: ActionPlan, intents: string[]) {
  return plan.actions.some((action) => intents.includes(action.intent));
}

function hasTarget(plan: ActionPlan, targets: string[]) {
  return plan.actions.some((action) => targets.includes(action.target));
}

function isInWindow(state: GameState, startMinute: number, endMinute: number) {
  return state.minute >= startMinute && state.minute <= endMinute;
}

function hasAnyShortTermDefenseOrEvidence(state: GameState) {
  return Boolean(
    state.room.front_door.state.barricaded ||
    state.room.window.state.locked ||
    state.policePhase !== 'not_contacted' ||
    state.clues.some((clue) => clue.id === 'package_photo' || clue.id === 'linyue_has_photo') ||
    state.linYuePhase === 'calling_police' ||
    state.room.phone.state.recording,
  );
}

export const storyNodes: StoryNodeDefinition[] = [
  {
    id: 'story_handoff_failed_2347',
    priority: 0,
    resolve: (state) => {
      if (state.minute < DEADLINE_MINUTE) return null;
      if (state.ending) return null;
      if (hasClue(state, 'handoff_failed_2347')) return null;
      if (!hasAnyShortTermDefenseOrEvidence(state)) return null;

      return {
        storyNodeId: 'story_handoff_failed_2347',
        title: '23:47 的交接失败',
        text: [
          '23:47。',
          '门外没有立刻传来撞击声。',
          '几秒后，楼下有人压低声音说：“货没回去。”',
          '另一个声音回答：“那就换方案。”',
        ].join('\n\n'),
        tone: 'threat',
        addedClueIds: ['handoff_failed_2347'],
        recommendedActions: [
          {
            id: 'keep_defense_after_handoff',
            label: '继续保持防守，不要因为门外暂时安静就开门或下楼。',
            rationale: '对方已经意识到原计划失败，安静不代表危险解除。',
            intent: 'wait',
            target: 'front_door',
          },
          {
            id: 'report_handoff_dialogue',
            label: '立即把“23:47 货没回去”的对话补充给警方和可信联系人。',
            rationale: '这句话能证明包裹原本存在交接或回收节点。',
            intent: 'communicate',
            target: 'police',
          },
          {
            id: 'inspect_after_plan_change',
            label: '检查门、窗和手机电量，准备应对对方换方案后的下一轮试探。',
            rationale: '对方换方案后，门窗和通讯资源都会变得更关键。',
            intent: 'inspect',
            target: 'room',
          },
        ],
        timePassed: 0,
        threatDelta: 12,
        phase: 'post_2347_escalation',
      };
    },
  },
  {
    id: 'story_false_police_overknows',
    priority: 1,
    resolve: (state, plan) => {
      if (!isInWindow(state, 23 * 60 + 30, 23 * 60 + 43)) return null;
      if (state.policePhase === 'not_contacted') return null;
      if (state.policePhase === 'verifying_report' || state.policePhase === 'real_police_en_route' || state.policePhase === 'arrived') return null;
      if (hasClue(state, 'police_verified')) return null;
      if (hasClue(state, 'false_police_overknows')) return null;
      if (!state.killerKnowledge.knowsPoliceCalled && state.threat < 45) return null;
      if (!hasIntent(plan, ['open_door', 'verify_identity', 'inspect', 'communicate'])) return null;
      if (!hasTarget(plan, ['front_door', 'police', 'hallway', 'phone'])) return null;

      return {
        storyNodeId: 'story_false_police_overknows',
        title: '假警察说漏的细节',
        text: [
          '门外的人敲了两下。',
          '“派出所的。我们接到报警，说你这里有一个纸箱。”',
          '你记得很清楚，报警时你只说了“可疑包裹”，没有说过纸箱。',
        ].join('\n\n'),
        tone: 'threat',
        addedClueIds: ['false_police_overknows'],
        recommendedActions: [
          {
            id: 'do_not_open_verify_police',
            label: '不要开门，先通过官方报警电话或接警回拨核验身份。',
            rationale: '门外的人知道报警时没有提供过的细节，身份需要重新核验。',
            intent: 'verify_identity',
            target: 'police',
          },
          {
            id: 'record_false_police_words',
            label: '记录门外人的原话，尤其是他说出你没有提供过的细节。',
            rationale: '这能作为假冒身份和过度知情的证据。',
            intent: 'record',
            target: 'front_door',
          },
        ],
        timePassed: 1,
        threatDelta: 8,
        phase: 'false_police_arrived',
        statePatch: (nextState) => {
          (nextState as unknown as Record<string, unknown>).policeTrustDamaged = true;
        },
      };
    },
  },
  {
    id: 'story_battery_critical',
    priority: 2,
    resolve: (state, plan) => {
      if (hasClue(state, 'battery_critical')) return null;
      if (!state.phoneFunctional) return null;
      if (state.phoneBattery > 25) return null;
      if (!isUsingPhone(plan)) return null;

      return {
        storyNodeId: 'story_battery_critical',
        title: '手机快没电了',
        text: [
          '屏幕右上角跳出低电量提示。',
          '红色电池图标像一枚倒计时。',
          '房间里的充电器还在，但如果手机彻底关机，报警、核验身份和对外求助都会一起断掉。',
        ].join('\n\n'),
        tone: 'clue',
        addedClueIds: ['battery_critical'],
        recommendedActions: [
          {
            id: 'charge_phone_now',
            label: '立刻找到房间里的充电器，把手机接上电源。',
            rationale: '手机没电后会切断报警、核验身份和对外求助。',
            intent: 'inspect',
            target: 'room',
          },
          {
            id: 'prioritize_critical_phone_tasks',
            label: '充电期间保持手机可用，优先完成报警、身份核验和关键证据备份。',
            rationale: '电量恢复前，手机能力仍然是最脆弱的生存资源。',
            intent: 'preserve_evidence',
            target: 'phone',
          },
        ],
        timePassed: 0,
        threatDelta: 0,
      };
    },
  },
  {
    id: 'story_room_403_receipt',
    priority: 3,
    resolve: (state, plan) => {
      if (state.minute < 23 * 60 + 10) return null;
      if (!hasClue(state, 'wrong_package')) return null;
      if (hasClue(state, 'room_403_receipt')) return null;
      if (state.evidencePhase === 'evidence_destroyed') return null;
      if (!state.room.package.visible) return null;

      const text = actionText(plan);
      const deepInspection = hasIntent(plan, ['inspect']) && hasTarget(plan, ['package', 'book', 'note', 'paper', 'receipt']);
      const evidenceInspection = hasIntent(plan, ['preserve_evidence']) &&
        hasTarget(plan, ['package']) &&
        ['仔细', '翻书', '夹层', '收据', '纸条'].some((word) => text.includes(word));
      if (!deepInspection && !evidenceInspection) return null;

      return {
        storyNodeId: 'story_room_403_receipt',
        title: '403 收据',
        text: [
          '旧书封底的夹层被潮气粘住。',
          '你用指甲轻轻挑开，里面露出半张收据。',
          '上面写着：青藤公寓 403。',
          '可你住的是 503。',
        ].join('\n\n'),
        tone: 'clue',
        addedClueIds: ['room_403_receipt'],
        recommendedActions: [
          {
            id: 'photograph_403_receipt',
            label: '拍下 403 收据和包裹整体，保留它们在同一现场的证据关系。',
            rationale: '单独的收据不如和包裹一起留存更有证明力。',
            intent: 'preserve_evidence',
            target: 'package',
          },
          {
            id: 'verify_room_403_safely',
            label: '不要立刻去 403，先通过报警或可信联系人核验这个房间。',
            rationale: '403 可能是中转点，也可能是诱导你离开安全位置的钩子。',
            intent: 'verify_identity',
            target: 'police',
          },
        ],
        timePassed: 2,
        threatDelta: 2,
      };
    },
  },
  {
    id: 'story_linyue_retracted_message',
    priority: 4,
    resolve: (state, plan) => {
      if (!isInWindow(state, 23 * 60 + 4, 23 * 60 + 12)) return null;
      if (hasClue(state, 'linyue_retracted_message')) return null;
      if (['received_photo', 'calling_police', 'coming_to_apartment', 'endangered', 'dead'].includes(state.linYuePhase)) return null;
      if (!hasIntent(plan, ['inspect', 'wait', 'preserve_evidence'])) return null;
      if (!hasTarget(plan, ['phone', 'package', 'room'])) return null;

      return {
        storyNodeId: 'story_linyue_retracted_message',
        title: '林越撤回的消息',
        text: [
          '手机屏幕亮了一下。',
          '林越发来一句：“那个包裹你别……”',
          '下一秒，消息被撤回。',
          '聊天框上方短暂显示“对方正在输入”，又很快消失。',
        ].join('\n\n'),
        tone: 'clue',
        addedClueIds: ['linyue_retracted_message'],
        recommendedActions: [
          {
            id: 'ask_linyue_about_retraction',
            label: '追问林越为什么撤回，不要让他自己判断要不要上楼。',
            rationale: '撤回消息更像临时压下去的担心，不追问可能让他独自行动。',
            intent: 'communicate',
            target: 'linyue',
          },
          {
            id: 'send_package_photo_to_linyue_safely',
            label: '把包裹照片和当前情况发给林越，但明确要求他留在安全位置。',
            rationale: '林越可以协助报警和备份证据，但不能靠近现场。',
            intent: 'preserve_evidence',
            target: 'phone',
          },
        ],
        timePassed: 1,
        threatDelta: 0,
        statePatch: (nextState) => {
          nextState.linYuePhase = 'worried';
        },
      };
    },
  },
  {
    id: 'story_fake_store_call',
    priority: 5,
    resolve: (state, plan) => {
      if (!isInWindow(state, 23 * 60 + 16, 23 * 60 + 34)) return null;
      if (hasClue(state, 'fake_store_call')) return null;
      if (!state.phoneFunctional) return null;
      if (hasClue(state, 'police_verified')) return null;
      if (!state.room.front_door.state.barricaded && !state.room.front_door.state.chainLocked && state.threat < 42) return null;
      if (!hasIntent(plan, ['wait', 'inspect', 'communicate'])) return null;
      if (!hasTarget(plan, ['phone', 'room', 'front_door'])) return null;

      return {
        storyNodeId: 'story_fake_store_call',
        title: '不存在的便利店来电',
        text: [
          '电话那头是一个年轻女人的声音。',
          '“你好，这里是楼下便利店。你刚才是不是落了一个东西？”',
          '你今晚没有去过便利店。',
        ].join('\n\n'),
        tone: 'threat',
        addedClueIds: ['fake_store_call'],
        recommendedActions: [
          {
            id: 'do_not_go_downstairs_for_store_call',
            label: '不要按对方要求下楼，先挂断并记录来电号码和通话内容。',
            rationale: '你今晚没有去过便利店，对方的话术本身就是异常点。',
            intent: 'record',
            target: 'phone',
          },
          {
            id: 'report_fake_store_call',
            label: '把“今晚没有去过便利店”作为异常点补充给警方或林越。',
            rationale: '这能帮助外部联系人判断对方正在诱导你离开房间。',
            intent: 'communicate',
            target: 'police',
          },
        ],
        timePassed: 1,
        threatDelta: 6,
      };
    },
  },
  {
    id: 'story_peephole_blind_spot',
    priority: 6,
    resolve: (state, plan) => {
      if (!isInWindow(state, 23 * 60 + 12, 23 * 60 + 35)) return null;
      if (hasClue(state, 'peephole_blind_spot')) return null;
      if (state.room.front_door.state.opened) return null;
      if (state.threat < 30 && !state.killerKnowledge.suspectsPlayerIsAlert) return null;
      if (!hasIntent(plan, ['inspect'])) return null;
      if (!hasTarget(plan, ['front_door', 'hallway', 'peephole'])) return null;

      return {
        storyNodeId: 'story_peephole_blind_spot',
        title: '猫眼盲区的人影',
        text: [
          '猫眼里没有人。',
          '但门外的感应灯亮着。',
          '那片光停在猫眼看不到的角落，像有人刻意站在盲区里。',
        ].join('\n\n'),
        tone: 'threat',
        addedClueIds: ['peephole_blind_spot'],
        recommendedActions: [
          {
            id: 'do_not_open_for_blind_spot',
            label: '不要开门，也不要贴近门缝回应门外的人。',
            rationale: '对方可能故意站在猫眼盲区，开门会让你失去主动权。',
            intent: 'wait',
            target: 'front_door',
          },
          {
            id: 'record_hallway_blind_spot',
            label: '用手机录下门外感应灯、脚步声或敲门声，作为后续报警证据。',
            rationale: '门外无人但感应灯亮着，是值得保留的异常证据。',
            intent: 'record',
            target: 'front_door',
          },
        ],
        timePassed: 1,
        threatDelta: 5,
      };
    },
  },
];

export function resolveStoryNode(state: GameState, plan: ActionPlan): StoryNodeResolution | null {
  const orderedNodes = [...storyNodes].sort((a, b) => a.priority - b.priority);
  for (const node of orderedNodes) {
    const resolution = node.resolve(state, plan);
    if (resolution) return resolution;
  }
  return null;
}
