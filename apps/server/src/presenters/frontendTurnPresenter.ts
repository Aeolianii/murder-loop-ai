import { minuteLabel, type GameState, type RecommendedAction, type StoryLogEntry } from '@murder-loop-ai/shared';
import type { createHarness, SidebarPayload } from '@murder-loop-ai/game-core';

export interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
  recommendedActions?: RecommendedAction[];
}

interface ChineseRecommendationCopy {
  matches: RegExp;
  label: string;
  rationale: string;
}

const CHINESE_RECOMMENDATION_COPY: ChineseRecommendationCopy[] = [
  {
    matches: /(?:(?:photograph|photo|camera|拍照|拍摄).*(?:package|parcel|包裹|快递)|(?:package|parcel|包裹|快递).*(?:photograph|photo|camera|拍照|拍摄))/i,
    label: '拍摄并保存包裹标签',
    rationale: '先保存包裹标签的可见信息，可以为后续核对寄件情况保留依据。',
  },
  {
    matches: /bathroom|washroom|toilet|water[_ -]?tank|卫生间|洗手间|水箱|马桶/i,
    label: '检查卫生间水箱',
    rationale: '卫生间水箱尚未检查，隐蔽位置可能存放物品或留下线索。',
  },
  {
    matches: /package|parcel|cardboard[_ -]?box|包裹|快递|纸箱/i,
    label: '检查桌上的包裹',
    rationale: '桌上的包裹内容尚未确认，检查后可能获得与当前处境有关的信息。',
  },
  {
    matches: /window|窗户|窗边|窗台/i,
    label: '检查窗户',
    rationale: '窗户状态尚未确认，检查后可以判断它是否安全或能否作为备用出口。',
  },
  {
    matches: /under[_ -]?(?:the[_ -]?)?bed|bed|床下|床底/i,
    label: '检查床底',
    rationale: '床底尚未检查，那里可能藏有物品或留下可见线索。',
  },
  {
    matches: /closet|wardrobe|衣柜|壁橱/i,
    label: '检查衣柜',
    rationale: '衣柜尚未检查，里面可能有可用物品或需要留意的藏身空间。',
  },
  {
    matches: /charge|charger|充电|充电器/i,
    label: '给手机充电',
    rationale: '手机电量需要留意，及时充电可以保留与外界联络的能力。',
  },
  {
    matches: /phone|battery|mobile|手机|电量/i,
    label: '检查手机状态',
    rationale: '手机是联络外界的重要工具，确认电量和功能可以避免紧急时失联。',
  },
  {
    matches: /police|emergency|call[_ -]?police|报警|警方|民警/i,
    label: '联系警方',
    rationale: '当前情况可能涉及人身安全，联系警方并说明已经确认的事实更稳妥。',
  },
  {
    matches: /secure.*(?:door|entry)|lock.*(?:door|entry)|barricad|锁门|反锁|加固.*门/i,
    label: '锁好并加固前门',
    rationale: '入口存在风险，锁门或加固可以降低他人进入的可能。',
  },
  {
    matches: /door|entry|门锁|前门|房门/i,
    label: '检查前门门锁',
    rationale: '前门状态需要确认，检查门锁和门缝可以判断入口是否安全。',
  },
  {
    matches: /record|photograph|camera|录音|录像|拍照|保存证据/i,
    label: '记录并保存现场信息',
    rationale: '保存当前可见和可听的信息，可以为后续核实情况提供依据。',
  },
];

const HAN_CHARACTER = /[\u3400-\u9fff]/;
const ASCII_LETTER = /[A-Za-z]/;

function isChineseUiCopy(value: string): boolean {
  return HAN_CHARACTER.test(value) && !ASCII_LETTER.test(value);
}

function chineseCopyForRecommendation(action: RecommendedAction): ChineseRecommendationCopy {
  const semanticText = [action.intent, action.target, action.label, action.rationale]
    .filter(Boolean)
    .join(' ');
  return CHINESE_RECOMMENDATION_COPY.find((copy) => copy.matches.test(semanticText)) ?? {
    matches: /(?:)/,
    label: '检查房间',
    rationale: '房间里仍有尚未确认的区域，先从安全的位置继续检查。',
  };
}

export function presentRecommendedActionsInChinese(
  actions: RecommendedAction[],
): RecommendedAction[] {
  return actions.map((action) => {
    const fallback = chineseCopyForRecommendation(action);
    return {
      ...action,
      label: isChineseUiCopy(action.label) ? action.label : fallback.label,
      rationale: isChineseUiCopy(action.rationale) ? action.rationale : fallback.rationale,
    };
  });
}

export async function buildSidebarPayload(
  harness: ReturnType<typeof createHarness>,
  finalState: GameState,
): Promise<SidebarPayload | null> {
  const existing = harness.dispatcher.getLatestArtifact('sidebar', 'TurnCompleted');
  if (existing !== undefined) return existing as SidebarPayload;
  await harness.dispatcher.runCommand('TurnCompleted', { finalState });
  const generated = harness.dispatcher.getLatestArtifact('sidebar', 'TurnCompleted');
  return generated === undefined ? null : generated as SidebarPayload;
}

export function toFrontendClues(state: GameState) {
  return state.clues.map((clue, i) => ({
    id: clue.id,
    name: clue.title,
    description: clue.detail,
    status: (
      clue.discoveredAt.run === state.run && i === state.clues.length - 1 ? 'new' : 'known'
    ) as 'new' | 'known',
    source: clue.source,
  }));
}

export function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action')
    return { id: entry.id, type: 'action_result', content: `${entry.title ? `${entry.title}: ` : ''}${entry.text}`, timestamp: minuteLabel(entry.minute) };
  if (entry.tone === 'system')
    return { id: entry.id, type: 'system', content: entry.title || entry.text, timestamp: minuteLabel(entry.minute) };
  return { id: entry.id, type: 'narrative', content: entry.text, timestamp: minuteLabel(entry.minute) };
}

export function applyConfirmedTurnNarration(
  nodes: FrontendStoryNode[],
  input: {
    turnId: string;
    timestamp: string;
    actionNarration?: { text: string };
    ambientNarration?: { text: string };
  },
): FrontendStoryNode[] {
  const presented = input.ambientNarration
    ? nodes.filter((node) => node.type !== 'narrative')
    : [...nodes];
  let actionIndex = -1;
  for (let index = presented.length - 1; index >= 0; index -= 1) {
    if (presented[index].type === 'action_result') {
      actionIndex = index;
      break;
    }
  }

  if (input.actionNarration && actionIndex >= 0) {
    presented[actionIndex] = {
      ...presented[actionIndex],
      content: input.actionNarration.text,
    };
  }
  if (input.ambientNarration) {
    presented.push({
      id: `narration-ambient-${input.turnId}`,
      type: 'narrative',
      content: input.ambientNarration.text,
      timestamp: input.timestamp,
    });
  }

  return presented;
}
