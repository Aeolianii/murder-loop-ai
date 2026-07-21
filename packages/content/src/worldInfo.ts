import type { GameState, RuleEvent } from '@murder-loop-ai/shared';
import { clueBook } from './clues';
import { initialRoomObjects } from './room';
import { npcs } from './npcs';
import { storyBible } from './storyBible';

export type WorldInfoAgent = 'parser' | 'rule' | 'killer' | 'narrator' | 'director' | 'npc' | 'ui-adapter' | 'sidebar';

export interface WorldInfoCard {
  id: string;
  title: string;
  tags: string[];
  triggerKeywords: string[];
  visibleToAgents: WorldInfoAgent[];
  content: string;
  priority: number;
  source: 'derived' | 'manual';
}

export interface SelectWorldInfoInput {
  agent: WorldInfoAgent;
  input?: string;
  state?: GameState;
  events?: RuleEvent[];
  limit?: number;
}

const ALL_AGENTS: WorldInfoAgent[] = ['parser', 'rule', 'killer', 'narrator', 'director', 'npc', 'ui-adapter', 'sidebar'];
const CORE_AGENTS: WorldInfoAgent[] = ['parser', 'rule', 'killer', 'narrator', 'director'];
const PLAYER_PRIVATE_OBJECT_AGENTS: WorldInfoAgent[] = ['parser', 'rule', 'narrator'];

const manualRuleCards: WorldInfoCard[] = [
  {
    id: 'rule.killer_visibility',
    title: '凶手信息边界',
    tags: ['rule', 'killer', 'visibility', 'knowledge'],
    triggerKeywords: ['killer', 'chen', 'huaimin', 'photo', 'linyue', 'message', 'package', 'evidence', 'visibility'],
    visibleToAgents: ['killer', 'narrator', 'director'],
    content: '陈怀民不能天然知道玩家的私密行动。只有当规则事件、killerKnowledge、可观察物理痕迹或已建立的监听/目击渠道支持时，他才可以据此行动。',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'rule.door_window_boundary',
    title: '门窗防御互不替代',
    tags: ['rule', 'door', 'window', 'defense'],
    triggerKeywords: ['door', 'front_door', 'window', 'chain', 'barricade', 'lock', 'chair'],
    visibleToAgents: CORE_AGENTS,
    content: '堵门、上门链、反锁前门只影响 front_door。窗户路线必须单独检查 window 的锁、窗帘、检查状态，不能因为门被堵住就自动安全。',
    priority: 9,
    source: 'manual',
  },
  {
    id: 'rule.police_verification',
    title: '警察身份核验',
    tags: ['rule', 'police', 'verification', 'fake_police'],
    triggerKeywords: ['police', 'verify', '110', 'fake_police', 'dispatch', 'call'],
    visibleToAgents: CORE_AGENTS,
    content: '门外自称警察不等于真警察。玩家需要通过官方渠道、报警回拨、调度信息或出示警官证等可信证据核验身份。',
    priority: 9,
    source: 'manual',
  },
  {
    id: 'rule.narrator_no_rule_change',
    title: '叙事不能改规则',
    tags: ['rule', 'narrator', 'state', 'ending', 'clue'],
    triggerKeywords: ['narrator', 'ending', 'fatal', 'death', 'arrest', 'escape', 'clue', 'state'],
    visibleToAgents: ['narrator', 'director'],
    content: 'Narrator 只能表达规则结果，不能新增死亡、逮捕、逃脱、关键线索、角色到场或物品状态变化。',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'rule.world_info_not_authority',
    title: 'World Info 不是规则裁判',
    tags: ['rule', 'world_info', 'authority', 'state'],
    triggerKeywords: ['world info', 'rule', 'success', 'death', 'ending', 'state', 'escape'],
    visibleToAgents: CORE_AGENTS,
    content: 'World Info 只提供设定上下文，不直接判定行动是否成功、生死、结局或状态变更。最终状态只能由规则系统和已确认事件改变。',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'style.first_person_limited',
    title: '第一人称有限视角',
    tags: ['style', 'narration', 'limited_view'],
    triggerKeywords: ['narrate', 'memory', 'describe', 'scene'],
    visibleToAgents: ['narrator', 'director'],
    content: 'Narration may describe observable facts, sounds, light, positions, and object states. It must not write private thoughts for the player or reveal hidden killer intent.',
    priority: 8,
    source: 'manual',
  },
  {
    id: 'rule.phone_visibility',
    title: '手机活动可见性',
    tags: ['rule', 'phone', 'visibility', 'killer', 'communication'],
    triggerKeywords: ['phone', 'screen', 'button', 'call', 'message', 'record', 'photo', 'hide', 'linyue'],
    visibleToAgents: ['parser', 'rule', 'killer', 'narrator', 'director'],
    content: '手机亮屏、按键声、通话声可能被外部察觉，但“发给谁、发了什么、藏在哪里”默认不可见。',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'rule.object_creation_boundary',
    title: '禁止凭空新增物品和路线',
    tags: ['rule', 'objects', 'rooms', 'routes', 'npc', 'hallucination'],
    triggerKeywords: ['vent', 'weapon', 'exit', 'neighbor', 'route', 'object', 'room', 'npc', 'escape'],
    visibleToAgents: CORE_AGENTS,
    content: 'AI 不能凭空添加房间里没有的通风管、武器、出口、邻居家通道或新 NPC。',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'style.no_player_mind_reading',
    title: '叙事不能替玩家读心',
    tags: ['style', 'narration', 'player', 'mind_reading', 'limited_view'],
    triggerKeywords: ['realize', 'afraid', 'decide', 'feel', 'think', 'narrate', 'describe'],
    visibleToAgents: ['narrator', 'director'],
    content: '叙事不能替玩家写“我意识到/我害怕/我决定”，只能写可观察动作和外部反馈。',
    priority: 9,
    source: 'manual',
  },
];

const reviewedCardContent: Record<string, { title?: string; content: string }> = {
  'object.package': {
    title: '标记模糊的包裹',
    content: '包裹位于桌边，是误收事件和证据链的核心物品。它可能被打开、拍照、隐藏或恢复原状，但包裹内容和证据有效性必须由规则/线索确认。',
  },
  'object.front_door': {
    title: '入户门',
    content: '入户门位于玄关，是敲门、开门、反锁、门链、防堵和强入压力的主要交互点。它不代表窗户或其它入口的安全状态。',
  },
  'object.window': {
    title: '窗户',
    content: '窗户位于卧室墙面，和窗帘、锁、外部路线有关。窗户是否安全必须看 window 自身状态，不能从门的状态推断。',
  },
  'object.phone': {
    title: '手机',
    content: '手机可用于拍照、录音、通信和报警，但受电量、静音、是否可用等状态限制。手机行为不应自动对凶手可见。',
  },
  'object.phone_charger': {
    title: '手机充电器',
    content: '充电器位于桌边，可影响手机续航。是否能充电取决于插入状态、电源条件和玩家动作是否成立。',
  },
  'object.chair': {
    title: '椅子',
    content: '椅子可移动，可能参与堵门或制造噪音，但不能自动成为万能防御或稳定武器。',
  },
  'object.closet': {
    title: '衣柜',
    content: '衣柜可被检查或用于短暂藏身。是否安全取决于凶手位置、噪音、时间和是否被检查过。',
  },
  'object.bed': {
    title: '床和床底',
    content: '床底可检查，也可能被玩家用于寻找或藏匿小物。不能默认存在新道具。',
  },
  'object.bathroom': {
    title: '卫生间',
    content: '卫生间可锁门、检查水箱或临时躲避，但它仍在房间内部，不等于安全逃脱。',
  },
  'clue.wrong_package': {
    title: '包裹标记异常',
    content: '包裹上的 5-03 / 503 标记模糊，说明它可能并不是寄给沈知夏。（开局可知道）',
  },
  'clue.package_photo': {
    title: '包裹照片',
    content: '玩家拍下包裹内容后，获得可外传的证据起点。（拍照需要消耗一定电量）',
  },
  'clue.linyue_has_photo': {
    title: '林越收到照片',
    content: '林越成为外部证据备份点，但也可能因此被卷入危险。',
  },
  'clue.police_verified': {
    title: '已核实警方',
    content: '玩家通过可信渠道确认警方信息，使假警察话术更容易被识破。',
  },
  'clue.chen_phone_found': {
    title: '陈怀民手机',
    content: '陈怀民手机里可能有交易记录、陌生号码短信和上游联系。',
  },
  'clue.chen_keys': {
    title: '备用钥匙',
    content: '陈怀民持有 503 备用钥匙，可解释强入或提前进入路线。',
  },
  'npc.linYue': {
    title: '林越',
    content: '林越是青荷公寓的维修工，陈怀民的同事，也是外部求救和证据备份角色，不是凶手。他能协助报警、保存照片、观察楼下，但行动不当会有风险。',
  },
  'npc.chenHuaimin': {
    title: '陈怀民',
    content: '陈怀民是房东/凶手，熟悉楼内结构，目标是回收包裹、灭证和自保。他不应拥有玩家私密行动的全知视角。',
  },
  'npc.police': {
    title: '真警察',
    content: '真警察是外部权威，但不是万能按钮。响应速度和可信度取决于玩家证据与叙述质量。',
  },
  'npc.liWentao': {
    title: '李汶涛（前租客/已死）',
    content: '李汶涛是前青荷公寓403住户，组织的前财务人员。他在发现组织内幕后寄出了包裹、设置了定时报警、给林越留了警告。他在一周前被处理，但他留下的证据链还在。',
  },
  'npc.zhaoHongyuan': {
    title: '赵鸿远（幕后）',
    content: '赵鸿远是青荷公寓的产权代理人，实为洗钱网络的控制者。他从不亲自出现在楼里，命令通过电话和陈怀民传达。他的信息延迟——需要下属汇报后才能反应——是玩家循环优势的关键。',
  },
};

export function getWorldInfoCards(): WorldInfoCard[] {
  return [
    ...buildObjectCards(),
    ...buildClueCards(),
    ...buildNpcCards(),
    buildStoryBibleCard(),
    ...manualRuleCards,
  ];
}

export function selectWorldInfoCards(options: SelectWorldInfoInput): WorldInfoCard[] {
  const limit = options.limit ?? 6;
  const query = buildQuery(options);
  const cards = getWorldInfoCards().filter((card) => card.visibleToAgents.includes(options.agent));

  return cards
    .map((card, index) => ({ card, index, score: scoreCard(card, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.card.priority - a.card.priority || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.card);
}

function buildObjectCards(): WorldInfoCard[] {
  return Object.values(initialRoomObjects).map((object) => {
    const stateKeys = Object.keys(object.state);
    const keywords = unique([
      object.id,
      object.name,
      object.location,
      ...object.id.split('_'),
      ...stateKeys,
      ...objectKeywords(object.id),
    ]);

    const id = `object.${object.id}`;
    const reviewed = reviewedCardContent[id];
    return {
      id,
      title: reviewed?.title ?? object.name ?? object.id,
      tags: unique(['object', 'room', object.id, object.location, ...stateKeys]),
      triggerKeywords: keywords,
      visibleToAgents: object.location === 'package' ? PLAYER_PRIVATE_OBJECT_AGENTS : CORE_AGENTS,
      content: reviewed?.content ?? `Object ${object.id} is located at ${object.location}. Visible: ${object.visible}. Trackable state keys: ${stateKeys.join(', ') || 'none'}.`,
      priority: object.id === 'package' || object.id === 'front_door' || object.id === 'phone' ? 8 : 6,
      source: 'derived',
    };
  });
}

function buildClueCards(): WorldInfoCard[] {
  return Object.values(clueBook).map((clue) => {
    const id = `clue.${clue.id}`;
    const reviewed = reviewedCardContent[id];
    return {
      id,
      title: reviewed?.title ?? clue.title ?? clue.id,
      tags: unique(['clue', clue.id, ...clue.id.split('_')]),
      triggerKeywords: unique([clue.id, ...clue.id.split('_'), clue.title, reviewed?.title]),
      visibleToAgents: ['parser', 'rule', 'narrator', 'director'],
      content: reviewed?.content ?? `Clue ${clue.id}: ${clue.detail} Weight: ${clue.weight}. Persistent: ${clue.isPersistent}.`,
      priority: Math.min(10, Math.max(5, Math.round(clue.weight / 2))),
      source: 'derived',
    };
  });
}

function buildNpcCards(): WorldInfoCard[] {
  return Object.entries(npcs).map(([id, npc]) => {
    const cardId = `npc.${id}`;
    const reviewed = reviewedCardContent[cardId];
    return {
      id: cardId,
      title: reviewed?.title ?? npc.name ?? id,
      tags: unique(['npc', id, npc.role]),
      triggerKeywords: unique([id, npc.name, npc.role, reviewed?.title, ...id.split(/(?=[A-Z])/).map((part) => part.toLowerCase())]),
      visibleToAgents: ALL_AGENTS,
      content: reviewed?.content ?? `NPC ${id}: ${npc.role}. ${npc.description}`,
      priority: id === 'chenHuaimin' || id === 'linYue' ? 8 : 6,
      source: 'derived',
    };
  });
}

function buildStoryBibleCard(): WorldInfoCard {
  return {
    id: 'story.core',
    title: storyBible.title,
    tags: ['story', 'premise', 'tone', 'rules'],
    triggerKeywords: ['story', 'loop', '23:47', 'package', 'chen', 'linyue', 'police', 'truth'],
    visibleToAgents: ALL_AGENTS,
    content: `${storyBible.premise} Truth boundary: ${storyBible.truth} Tone: ${storyBible.tone} Rules: ${storyBible.rules.join(' ')}`,
    priority: 7,
    source: 'derived',
  };
}

function buildQuery(options: SelectWorldInfoInput): string {
  return [
    options.input,
    options.state?.phase,
    options.state?.killerPhase,
    options.state?.policePhase,
    options.state?.linYuePhase,
    options.state?.evidencePhase,
    options.state?.playerHolding,
    ...(options.events ?? []).flatMap((event) => [event.subject, event.summary, ...event.sensoryHints]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreCard(card: WorldInfoCard, query: string): number {
  let score = 0;
  const haystack = `${card.id} ${card.title} ${card.tags.join(' ')} ${card.triggerKeywords.join(' ')}`.toLowerCase();
  for (const keyword of card.triggerKeywords) {
    const normalized = keyword.toLowerCase();
    if (!normalized) continue;
    if (query.includes(normalized)) score += 4;
  }
  for (const tag of card.tags) {
    const normalized = tag.toLowerCase();
    if (normalized && query.includes(normalized)) score += 2;
  }
  if (query && haystack.split(/\s+/).some((term) => term.length > 2 && query.includes(term))) score += 1;
  return score + (score > 0 ? card.priority : 0);
}

function objectKeywords(id: string): string[] {
  const keywords: Record<string, string[]> = {
    package: ['box', 'parcel', 'drug', 'evidence', 'photo', 'photograph'],
    front_door: ['door', 'entry', 'knock', 'barricade', 'chain', 'lock'],
    window: ['curtain', 'outside', 'route', 'lock'],
    phone: ['call', 'message', 'record', 'photo', 'battery', 'linyue', 'police'],
    phone_charger: ['charger', 'battery', 'plug'],
    chair: ['move', 'barricade', 'block', 'door'],
    closet: ['hide', 'check'],
    bed: ['under', 'hide', 'check'],
    bathroom: ['water', 'tank', 'hide', 'lock'],
  };
  return keywords[id] ?? [];
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()).filter(Boolean)));
}
