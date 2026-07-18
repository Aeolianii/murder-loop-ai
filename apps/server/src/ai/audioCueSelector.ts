import { actionAudioCatalog, type ActionAudioCue, type ActionPlan, type GameState, type RuleResult, type AudioSoundId } from '@murder-loop-ai/shared';
import { completeRoleJson } from './openaiClient';

const ACTION_AUDIO_CONFIDENCE_THRESHOLD = 0.8;
const allowedSoundIds = new Set<AudioSoundId>(actionAudioCatalog.map((entry) => entry.soundId));

interface ActionAudioCueRaw {
  soundId?: string;
  confidence?: number | string;
  reason?: string;
}

function toNumericConfidence(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return 0;
}

export async function selectPrimaryActionAudioCue(args: {
  input: string;
  plan: ActionPlan;
  state: GameState;
  playerResult: RuleResult;
}): Promise<ActionAudioCue | null> {
  const { input, plan, state, playerResult } = args;
  if (!plan.actions.length) return null;

  const system = [
    '你是《23:47》的轻量音效选择 agent。',
    '你的职责只有一个：从候选列表里选出“玩家本回合行为主音效”。',
    '',
    '【边界】',
    '1. 只为玩家主行为选 1 个音效；不要负责环境音、系统提示音、结局音、UI 音。',
    '2. 只能从给定 soundId 列表中选择，绝不编造不存在的 soundId。',
    '3. 只根据已解析动作和已确认的玩家结果判断，不根据玩家口头自述脑补。',
    '4. 如果证据不足，就降低 confidence，不要硬猜。',
    '5. 如果多个动作同时发生，优先选择最有辨识度、最贴近主行为的那个声音。',
    '',
    '【confidence 规则】',
    '- 0.90~1.00: 动作与声音强一一对应，例如拍照->快门、拨号->拨号音、上门链->门链声。',
    '- 0.80~0.89: 较合理，但动作里还存在一点歧义。',
    '- <0.80: 不够确定，宁可不给高分。',
    '',
    '输出裸 JSON：{"soundId":"...","confidence":0.0,"reason":"不超过30字"}',
  ].join('\n');

  const ai = await completeRoleJson<ActionAudioCueRaw>('parse', system, {
    input,
    state: {
      phase: state.phase,
      threat: state.threat,
      playerInjury: state.player.injury,
    },
    plan: {
      summary: plan.summary,
      actions: plan.actions.map((action) => ({
        intent: action.intent,
        target: action.target,
        method: action.method ?? '',
        confidence: action.confidence,
      })),
    },
    playerResult: {
      title: playerResult.title,
      text: playerResult.text,
      events: playerResult.events.map((event) => ({
        kind: event.kind,
        subject: event.subject,
        summary: event.summary,
      })),
    },
    catalog: actionAudioCatalog,
  }, { temperature: 0.1 }).catch(() => null);

  if (!ai) return null;

  const soundId = typeof ai.soundId === 'string' ? ai.soundId.trim() as AudioSoundId : null;
  const confidence = toNumericConfidence(ai.confidence);
  if (!soundId || !allowedSoundIds.has(soundId) || !Number.isFinite(confidence) || confidence < ACTION_AUDIO_CONFIDENCE_THRESHOLD) {
    return null;
  }

  return {
    id: `audio-${plan.id}-${Date.now()}`,
    soundId,
    confidence: Math.min(1, Math.max(0, confidence)),
    reason: typeof ai.reason === 'string' && ai.reason.trim() ? ai.reason.trim().slice(0, 60) : '行为主音效匹配',
    source: 'ai',
  };
}
