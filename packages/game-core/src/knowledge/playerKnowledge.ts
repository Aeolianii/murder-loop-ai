import type { GameState, PlayerKnowledge } from '@murder-loop-ai/shared';
import { getActivatableKnowledge } from './knowledgeDefinitions';

const KNOWLEDGE_FEEDBACK: Record<string, string> = {
  package_not_for_503: '这不是我的快递。403——这栋楼里有另一个人。',
  chen_has_spare_key: '锁芯上的划痕是新的。他有备用钥匙——或者说，他用过。',
  chen_is_monitoring: '他知道我在家。23:01 那通电话不是打错了。他在确认。',
  chen_not_mastermind: '他不是发号施令的人。名片背面那个数字——不是他的。',
  linyue_investigating: '他不是在盯我。他在盯这栋楼。他说的"那个人"——是寄包裹的人。',
  fake_police: '没有警车声。他问的问题太具体了——像在套话，不像在核验。',
  liventao_is_dead: '403 那个人不会再回来了。他留下这些东西，是因为他知道自己会死。',
  zhao_is_1103: '1103。账本里每一行都有这个编号。陈怀民的名片背面，也是它。',
  org_has_inside_man: '报警被压下来了。他们不是第一次这么做。',
};

export function activatePlayerKnowledge(state: GameState): { state: GameState; newlyActivated: PlayerKnowledge[]; feedbackTexts: string[] } {
  const ownedClueIds = [...state.clues.map((c) => c.id), ...state.discoveredClueIds];
  if (state.room.package?.state?.opened) ownedClueIds.push('package_opened');
  if (state.room.package?.state?.photographed) ownedClueIds.push('package_photo');
  if (state.policePhase !== 'not_contacted') ownedClueIds.push('police_contacted');

  const alreadyActivated = state.activatedKnowledge.map((k) => k.id);
  const activatable = getActivatableKnowledge(ownedClueIds, alreadyActivated);
  if (activatable.length === 0) return { state, newlyActivated: [], feedbackTexts: [] };

  const newlyActivated: PlayerKnowledge[] = activatable.map((def) => ({
    id: def.id, label: def.label,
    activatedAt: { run: state.run, minute: state.minute },
    sourceClueIds: [...def.requiredClueIds, ...(def.anyOf?.clueIds ?? [])],
    truthLayerContribution: def.truthLayerContribution,
    excludes: def.excludes,
  }));

  const feedbackTexts = newlyActivated.map((k) => KNOWLEDGE_FEEDBACK[k.id]).filter(Boolean);

  let merged = [...state.activatedKnowledge, ...newlyActivated];
  if (newlyActivated.some((k) => k.id === 'linyue_is_accomplice') && newlyActivated.some((k) => k.id === 'linyue_investigating')) {
    merged = merged.filter((k) => k.id !== 'linyue_is_accomplice');
  }

  return {
    state: {
      ...state,
      activatedKnowledge: merged,
      currentRunKnowledge: [...state.currentRunKnowledge, ...newlyActivated],
      discoveredClueIds: [...new Set([...state.discoveredClueIds, ...state.clues.map((c) => c.id)])],
    },
    newlyActivated,
    feedbackTexts,
  };
}

export function canAccuse(state: GameState): boolean {
  return state.activatedKnowledge.filter((k) => k.truthLayerContribution > 0).length >= 3;
}

export function getActivatedClueFragments(state: GameState): string[] {
  const map: Record<string, string[]> = {
    package_not_for_503: ['包裹面单上残破的"青荷 5-0"', '403 收据上那个陌生的名字'],
    chen_is_monitoring: ['23:01 那通四秒的空号来电', '23:12 的敲门——他知道你在家'],
    chen_not_mastermind: ['陈怀民接电话时的语气', '名片背面手写的数字 1103'],
    linyue_investigating: ['林越压低声音说的那句话'],
    fake_police: ['门外的人——问话方式不像警察'],
    zhao_is_1103: ['U盘账本里每一行都有的那个编号'],
    org_has_inside_man: ['报警之后——楼下迟迟没有警车声'],
  };
  const fragments: string[] = [];
  for (const k of state.activatedKnowledge) {
    for (const f of map[k.id] ?? []) { if (!fragments.includes(f)) fragments.push(f); }
  }
  return fragments.slice(0, 6);
}
