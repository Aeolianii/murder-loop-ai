import type { NarrationContext, RuleEvent, RuleResult } from '@murder-loop-ai/shared';
import { buildVisibleMemoryForAgent } from '../memory/loopMemory';

export function event(kind: RuleEvent['kind'], subject: string, summary: string, sensoryHints: string[] = [], visibility: RuleEvent['visibility'] = 'player'): RuleEvent {
  return { kind, subject, summary, sensoryHints, visibility };
}

export function mergeEvents(...results: Array<Pick<RuleResult, 'events'>>): RuleEvent[] {
  return results.flatMap((result) => result.events);
}

export function buildNarrationContext(playerResult: RuleResult, killerResult: RuleResult, playerActionSummary: string, playerInput?: string): NarrationContext {
  const state = killerResult.state;

  const phaseDescriptions: Record<string, string> = {
    loop_started: '循环刚开始，沈知夏刚从23:00醒来，还不确定发生了什么。',
    investigating: '沈知夏在调查房间和包裹，试图理解自己的处境。',
    killer_pressure: '陈怀民在门外施压，危险在逼近。',
    police_called: '警方已介入，但真假未辨。',
    pre_2347_countdown: '23:47 正在逼近，时间不多了。',
  };

  const playerSituation = [
    state.playerHolding ? `手持${state.playerHolding}` : '空手',
    state.room.front_door.state.opened ? '门开着' : state.room.front_door.state.barricaded ? '门已堵住' : '门关着',
    state.phoneFunctional ? `手机电量${state.phoneBattery}分钟` : '手机已关机',
    state.player.injury !== 'none' ? `身体状况：${state.player.injury}` : '',
  ].filter(Boolean).join('，');

  return {
    run: state.run,
    minute: state.minute,
    turnIndex: state.log.length,
    playerActionSummary,
    playerInput,
    events: mergeEvents(playerResult, killerResult),
    stateSnapshot: {
      phase: state.phase,
      killerPhase: state.killerPhase,
      killerStatus: state.killerStatus,
      policePhase: state.policePhase,
      linYuePhase: state.linYuePhase,
      evidencePhase: state.evidencePhase,
      threat: state.threat,
      suspicion: state.suspicion,
      injury: state.player.injury,
      stress: state.player.stress,
      clues: state.clues,
      ending: state.ending,
      endingReason: state.endingReason,
      phoneBattery: state.phoneBattery,
      phoneFunctional: state.phoneFunctional,
      playerHolding: state.playerHolding,
      combatTriggered: state.combatTriggered,
    },
    recentLog: state.log.slice(-5).map((entry) => ({
      minute: entry.minute,
      title: entry.title,
      text: entry.text.slice(0, 160),
      channel: entry.channel,
    })),
    knownClueTitles: state.clues.map(c => c.title),
    memorySummary: buildVisibleMemoryForAgent(state.memory, 'narrator'),
    combatContext: state.combatTriggered ? {
      playerWeapon: state.playerHolding,
      killerArmed: state.killerStatus === 'confronting' || state.threat > 60,
      advantage: state.playerHolding && state.killerStatus !== 'confronting' ? 'player' : state.killerStatus === 'confronting' ? 'killer' : 'mutual',
    } : undefined,
    plotPhase: phaseDescriptions[state.phase] || '剧情正在推进。',
    playerSituation,
    forbiddenFacts: [
      '不要新增房间里不存在的人或物。',
      '不要让警察、林越或凶手突然进入现场，除非事件中明确发生。',
      '不要改变死亡、生还、证据、时间和 NPC 状态。',
      '不要透露主角无法看见或合理推断的凶手内心。',
      '不要替玩家写心理感受、内心独白、恐惧、担忧、领悟或判断。',
      '不要写”我害怕””我明白””我意识到””我感觉””我知道他在想什么”。',
      '不要照抄规则 fallback 文本。',
      '不要复述 recentLog 里最近两回合已经出现过的具体句子、短信问法或敲门借口。',
    ],
    styleGuide: [
      '第一人称限知视角，但只呈现现实反馈，不替玩家思考。',
      '写可观察事实：声音、光线、位置、距离、物体状态、他人行为、时间变化。',
      '可以写身体外部动作：手停住、呼吸变浅、脚步后撤；不要解释心理原因。',
      '少用恐惧感、压迫感、危险感、可怕、绝望这类抽象词。',
      '每段推进一个明确变化，不要重复同一信息，不要总结主题。',
    ],
  };
}
