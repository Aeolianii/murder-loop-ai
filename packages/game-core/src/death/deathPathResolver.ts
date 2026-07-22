import type { DeathPathResult, DeathPathType, GameState } from '@murder-loop-ai/shared';

export function shouldTriggerDeath(state: GameState): boolean {
  return state.minute >= 1427 || state.threat >= 90;
}

export function resolveDeathPath(state: GameState): DeathPathResult {
  const evidenceShared = state.clues.some((c) => c.id === 'linyue_has_photo' || c.id === 'police_verified') || state.linYuePhase === 'calling_police' || ['real_police_en_route', 'arrived'].includes(state.policePhase);
  const zhaoIntervened = ['evidence_erasure', 'framing'].includes(state.killerPhase) || (evidenceShared && state.run > 5);
  if (zhaoIntervened) return { path: 'cleanup', killer: 'zhao_hongyuan', rationale: evidenceShared ? '证据传到了外面。赵鸿远决定亲自收线。' : '赵鸿远注意到 503 的异常。不再等陈怀民的汇报。', triggeredBy: ['zhaoIntervened'] };

  const fakePoliceCalled = ['deception', 'forced_entry'].includes(state.killerPhase) || state.policePhase === 'misled';
  const policeNearby = ['real_police_en_route', 'arrived', 'dispatch_pending'].includes(state.policePhase);
  if (fakePoliceCalled || policeNearby) return { path: 'enforcement', killer: 'fake_police', rationale: fakePoliceCalled ? '陈怀民搞不定——叫了假警察。' : '真警察到了附近。假警察必须抢先。', triggeredBy: [fakePoliceCalled ? 'fakePoliceCalled' : 'policeNearby'] };

  const linYueInvolved = ['coming_to_apartment', 'endangered'].includes(state.linYuePhase);
  const chenCanFrame = state.killerStatus === 'alive' && linYueInvolved;
  if (linYueInvolved && chenCanFrame) return { path: 'frameup', killer: 'chen_huaimin', rationale: '陈怀民需要替罪羊。林越上楼了——正好。', triggeredBy: ['linYueInvolved'] };

  const packageOpened = state.room.package?.state?.opened || state.clues.some((c) => c.id === 'package_contents');
  return { path: 'suppression', killer: 'chen_huaimin', rationale: packageOpened ? '陈怀民确认包裹被拆了。必须灭口。' : '23:47。陈怀民来确认包裹。', triggeredBy: packageOpened ? ['playerOpenedPackage'] : ['deadline'] };
}
