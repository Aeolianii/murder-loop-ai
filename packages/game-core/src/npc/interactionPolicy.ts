import type { NpcReply } from '@murder-loop-ai/shared';

function normalizeInteractionText(input: string) {
  return input.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?：:“”"'（）()]/g, '');
}

export function isPackageHandoffToChen(input: string) {
  const text = normalizeInteractionText(input);
  const mentionsPackage = /(包裹|快递|纸箱)/.test(text);
  const mentionsChen = /(房东|陈怀民)/.test(text);
  const refusesTransfer = /(?:不把|别把|不要把|不能把|拒绝把).{0,12}(?:包裹|快递|纸箱).{0,8}(?:给|交|递|还|送)/.test(text)
    || /(?:包裹|快递|纸箱).{0,6}(?:不能|不要|别)(?:给|交|递|还|送)/.test(text)
    || /(?:不给|不交给|不递给|不还给|不送给)(?:门外(?:的)?)?(?:自称)?(?:房东|陈怀民)/.test(text);
  const transfersToChen = /(?:包裹|快递|纸箱).{0,10}(?:交给|递给|还给|送给|给)(?:门外(?:的)?)?(?:自称)?(?:房东|陈怀民)/.test(text)
    || /(?:交给|递给|还给|送给|给)(?:门外(?:的)?)?(?:自称)?(?:房东|陈怀民).{0,10}(?:包裹|快递|纸箱)/.test(text);

  return mentionsPackage && mentionsChen && transfersToChen && !refusesTransfer;
}

export function resolveNpcInteractionPolicyReply(
  speaker: NpcReply['speaker'],
  input: string,
): NpcReply | null {
  if (speaker !== 'chen_huaimin' || !isPackageHandoffToChen(input)) return null;

  return {
    speaker,
    text: '“对，是我的。给我吧。”',
    intent: 'accept_package_handoff',
    riskWarning: '陈怀民的目标正是收回包裹；开门会让玩家直接暴露在他面前。',
    suggestedExternalAction: '交接后立刻拉开距离，优先保证人身安全。',
  };
}
