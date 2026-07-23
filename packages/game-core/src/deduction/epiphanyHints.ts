import type { GameState } from '@murder-loop-ai/shared';

const HINTS: Array<{ knowledgeId: string; levels: [string, string, string] }> = [
  { knowledgeId: 'linyue_is_investigating_li', levels: ['她脑子里忽然闪过一个画面——林越那天在走廊，不是在看她的门。他在看楼下。', '等一下。林越提到过一个人。"之前住 403 的那个"。他说这话的时候把声音压得很低。', '403。李汶涛。林越不是在盯她——他在找这个人。'] },
  { knowledgeId: 'chen_is_field_executor', levels: ['她想起陈怀民接电话时的样子——背对着门，声音压得很低。不像在汇报。像在挨骂。', '名片。他递名片的时候手在抖。背面那个数字——不是他的号码。', '"1103"。那不是房号，不是电话。那是某个人在组织里的编号。'] },
  { knowledgeId: 'first_visitors_are_fake_police', levels: ['她忽然意识到——那个人说"503 有人报警"的时候，没有出示过证件。', '不对。真警察不会问"你一个人住吗"——他们会先报自己的警号和接警编号。', '她回拨 110 确认过——第一批来客没有对应的出警记录。那个人不是警察。'] },
  { knowledgeId: 'code_1103_is_zhao_hongyuan', levels: ['陈怀民名片背面的数字……她在另一个地方也见过。', 'U盘。账本。每一行转账记录的备注栏——都有同一个编号。', '1103 是组织内部的编号。账本里每一个转运点、每一个人——都是数字。'] },
  { knowledgeId: 'organization_has_police_insider', levels: ['她报过警。但每次真警察都被拖住了。不是巧合。', '23:23——那个自动报警电话。她查过接警记录。有人标记为"已处理"。', '公安内线。赵鸿远的人在系统里。报警走不通——必须换一条路传证据。'] },
];

export function generateEpiphanyHint(state: GameState, consecutiveFailures: number, previousHintIds: string[] = []): string | null {
  const levelIndex = consecutiveFailures >= 6 ? 2 : consecutiveFailures >= 4 ? 1 : consecutiveFailures >= 2 ? 0 : -1;
  if (levelIndex < 0) return null;
  const activatedIds = new Set(state.activatedKnowledge.map((k) => k.id));
  const candidates = HINTS.filter((h) => !activatedIds.has(h.knowledgeId)).filter((h) => !previousHintIds.includes(h.knowledgeId));
  if (candidates.length === 0) return null;
  return candidates[0].levels[levelIndex as 0 | 1 | 2] ?? null;
}
