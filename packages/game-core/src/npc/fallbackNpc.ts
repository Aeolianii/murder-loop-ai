import type { GameState, NpcReply } from '@murder-loop-ai/shared';
import { buildNpcVisibleContext } from '../context/ContextBuilder';

export function fallbackNpcReply(speaker: NpcReply['speaker'], input: string, state: GameState): NpcReply {
  const visibleContext = buildNpcVisibleContext(state, speaker, input);

  if (speaker === 'police_dispatch') {
    return {
      speaker,
      text: '接线员让我压低声音，确认门窗是否锁好。她没有让我开门，只重复了一遍：如果门外有人自称警察，也要等官方回拨核实。',
      intent: '稳定玩家并要求官方核验',
      riskWarning: state.policePhase === 'not_contacted' ? '还没有形成有效报警记录。' : '门外身份仍需核验。',
      suggestedExternalAction: '保持通话，等待官方渠道确认。',
    };
  }

  if (speaker === 'chen_huaimin') {
    return {
      speaker,
      text: '陈怀民的声音还是很平，问我是不是拿错了什么东西。他没有说包裹里有什么，只说如果不是我的，最好现在交出来，免得之后解释不清。',
      intent: '试探玩家是否掌握包裹内容',
      riskWarning: '继续通话可能暴露玩家已经警觉。',
      suggestedExternalAction: '不要承认已经打开或备份证据，尽量录音。',
    };
  }

  if (speaker === 'linyue' && !visibleContext.canReference.doorActivity && !visibleContext.canReference.policeReport) {
    return {
      speaker: 'linyue',
      text: 'Lin Yue replies: I do not recognize this package from the photo alone. Do not open the package yet. Keep the photo and any delivery markings, and tell me if there is a sender name, room number, or tracking code.',
      intent: 'identify_package_from_player_message',
      riskWarning: 'Lin Yue only knows about the package photo at this point.',
      suggestedExternalAction: 'Ask Lin Yue to preserve the photo and help verify the package source from a safe place.',
    };
  }

  return {
    speaker: 'linyue',
    text: '林越直接回：不太对劲。我还没看到真正到你门口的警察，门外压低声音说“进不去”的人更像同伙在露馅，可能是假警察或者冒充警察。你别开门，别靠门缝，继续保持门窗反锁，等官方回拨核实。我会留在楼下安全位置，把照片、门外原话和你的位置交给真正的警察。',
    intent: '识别疑似假警察并协助真警察',
    riskWarning: state.linYuePhase === 'received_photo' ? '林越已经看见异常警服人员，不能让他靠近 503 或单独上楼。' : '林越还没有拿到足够证据，但门外身份必须先按冒充警察处理。',
    suggestedExternalAction: input.includes('上楼') ? '让林越留在楼下找真警察，不要上楼。' : '让林越备份照片、报警，并通过真警察或官方回拨核实门外身份。',
  };
}
