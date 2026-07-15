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

const manualRuleCards: WorldInfoCard[] = [
  {
    id: 'rule.killer_visibility',
    title: 'Killer visibility boundary',
    tags: ['rule', 'killer', 'visibility', 'knowledge'],
    triggerKeywords: ['killer', 'chen', 'huaimin', 'photo', 'linyue', 'message', 'package', 'evidence', 'visibility'],
    visibleToAgents: ['killer', 'narrator', 'director'],
    content: 'Chen Huaimin must not know private player actions unless rule events, killerKnowledge, or visible physical traces support that knowledge.',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'rule.door_window_boundary',
    title: 'Door and window defenses are separate',
    tags: ['rule', 'door', 'window', 'defense'],
    triggerKeywords: ['door', 'front_door', 'window', 'chain', 'barricade', 'lock', 'chair'],
    visibleToAgents: CORE_AGENTS,
    content: 'Door defenses do not automatically secure the window. Window state must be checked separately from front_door state.',
    priority: 9,
    source: 'manual',
  },
  {
    id: 'rule.police_verification',
    title: 'Police verification matters',
    tags: ['rule', 'police', 'verification', 'fake_police'],
    triggerKeywords: ['police', 'verify', '110', 'fake_police', 'dispatch', 'call'],
    visibleToAgents: CORE_AGENTS,
    content: 'Police identity should be verified through official channels. A person claiming to be police at the door is not automatically real police.',
    priority: 9,
    source: 'manual',
  },
  {
    id: 'style.first_person_limited',
    title: 'First-person limited narration',
    tags: ['style', 'narration', 'limited_view'],
    triggerKeywords: ['narrate', 'memory', 'describe', 'scene'],
    visibleToAgents: ['narrator', 'director'],
    content: 'Narration may describe observable facts, sounds, light, positions, and object states. It must not write private thoughts for the player or reveal hidden killer intent.',
    priority: 8,
    source: 'manual',
  },
  {
    id: 'rule.phone_visibility',
    title: 'Phone activity visibility',
    tags: ['rule', 'phone', 'visibility', 'killer', 'communication'],
    triggerKeywords: ['phone', 'screen', 'button', 'call', 'message', 'record', 'photo', 'hide', 'linyue'],
    visibleToAgents: ['parser', 'rule', 'killer', 'narrator', 'director'],
    content: 'Phone screen light, button sounds, and call audio may be externally noticed, but who the player contacted, what was sent, and where the phone was hidden are private by default.',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'rule.object_creation_boundary',
    title: 'No unconfirmed object or route creation',
    tags: ['rule', 'objects', 'rooms', 'routes', 'npc', 'hallucination'],
    triggerKeywords: ['vent', 'weapon', 'exit', 'neighbor', 'route', 'object', 'room', 'npc', 'escape'],
    visibleToAgents: CORE_AGENTS,
    content: 'AI must not invent vents, weapons, exits, neighbor routes, new NPCs, or room objects that are not represented by project content, current state, or confirmed rule events.',
    priority: 10,
    source: 'manual',
  },
  {
    id: 'style.no_player_mind_reading',
    title: 'Do not write player thoughts',
    tags: ['style', 'narration', 'player', 'mind_reading', 'limited_view'],
    triggerKeywords: ['realize', 'afraid', 'decide', 'feel', 'think', 'narrate', 'describe'],
    visibleToAgents: ['narrator', 'director'],
    content: 'Narration must not write that the player realized, feared, decided, felt, or understood something. It may only describe observable player actions and external feedback.',
    priority: 9,
    source: 'manual',
  },
];

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

    return {
      id: `object.${object.id}`,
      title: object.name || object.id,
      tags: unique(['object', 'room', object.id, object.location, ...stateKeys]),
      triggerKeywords: keywords,
      visibleToAgents: CORE_AGENTS,
      content: `Object ${object.id} is located at ${object.location}. Visible: ${object.visible}. Trackable state keys: ${stateKeys.join(', ') || 'none'}.`,
      priority: object.id === 'package' || object.id === 'front_door' || object.id === 'phone' ? 8 : 6,
      source: 'derived',
    };
  });
}

function buildClueCards(): WorldInfoCard[] {
  return Object.values(clueBook).map((clue) => ({
    id: `clue.${clue.id}`,
    title: clue.title || clue.id,
    tags: unique(['clue', clue.id, ...clue.id.split('_')]),
    triggerKeywords: unique([clue.id, ...clue.id.split('_'), clue.title]),
    visibleToAgents: ['parser', 'rule', 'narrator', 'director'],
    content: `Clue ${clue.id}: ${clue.detail} Weight: ${clue.weight}. Persistent: ${clue.isPersistent}.`,
    priority: Math.min(10, Math.max(5, Math.round(clue.weight / 2))),
    source: 'derived',
  }));
}

function buildNpcCards(): WorldInfoCard[] {
  return Object.entries(npcs).map(([id, npc]) => ({
    id: `npc.${id}`,
    title: npc.name || id,
    tags: unique(['npc', id, npc.role]),
    triggerKeywords: unique([id, npc.name, npc.role, ...id.split(/(?=[A-Z])/).map((part) => part.toLowerCase())]),
    visibleToAgents: ALL_AGENTS,
    content: `NPC ${id}: ${npc.role}. ${npc.description}`,
    priority: id === 'chenHuaimin' || id === 'linYue' ? 8 : 6,
    source: 'derived',
  }));
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
