import assert from 'node:assert/strict';
import { createInitialGameState, type AiAdapters } from '@murder-loop-ai/game-core';
import type { RuleResult, TurnResolution } from '@murder-loop-ai/shared';
import { narrateConfirmedTurn } from './confirmedTurnNarrator';

const state = createInitialGameState();
state.room.package.inspected = true;
state.room.package.state.opened = true;
state.evidencePhase = 'package_opened';

const packageSummary = '你打开包裹，看到一本被掏空的旧书、一板药片和一张写着数字的纸条。';
const playerResult = {
  title: '包裹内容已确认',
  text: packageSummary,
  tone: 'clue',
  addedClues: [],
  timePassed: 1,
  threatDelta: 0,
  events: [{
    kind: 'clue',
    subject: 'package',
    summary: packageSummary,
    sensoryHints: ['旧书', '药板', '数字纸条'],
    visibility: 'player',
  }],
  state,
  domainEvents: [{
    eventType: 'package_opened',
    subject: 'package',
    facts: ['fact.package.interior.contents_revealed'],
  }],
} as RuleResult & {
  domainEvents: Array<{ eventType: string; subject: string; facts: string[] }>;
};

const quietResult: RuleResult = {
  title: '环境没有变化',
  text: '门外暂时没有新的动静。',
  tone: 'neutral',
  addedClues: [],
  timePassed: 0,
  threatDelta: 0,
  events: [],
  state,
};

const resolution: TurnResolution = {
  plan: {
    id: 'inspect-package-contents',
    raw: '检查包裹内容',
    summary: '检查包裹内部物品',
    actions: [{
      id: 'inspect-package',
      raw: '检查包裹内容',
      intent: 'inspect',
      target: 'package',
      method: 'interior.contents',
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low',
    }],
    confidence: 1,
    warnings: [],
  },
  playerResult,
  killerStrategy: {
    id: 'wait',
    type: 'wait_for_fatigue',
    title: '等待',
    rationale: '没有新的可见变化。',
    visibleToPlayer: false,
    risk: 'low',
  },
  killerResult: quietResult,
  narration: { title: '检查完成', text: '你检查了包裹。' },
  actionNarration: { title: '检查完成', text: '你检查了包裹。' },
  ambientNarration: { title: quietResult.title, text: quietResult.text },
  finalState: state,
};

const adapters: AiAdapters = {
  narrateAction: async () => ({ title: '检查完成', text: '你检查了包裹。' }),
  narrateAmbient: async () => ({ title: quietResult.title, text: quietResult.text }),
};

const narrated = await narrateConfirmedTurn(resolution, adapters);
assert.match(narrated.actionNarration?.text ?? '', /旧书/);
assert.match(narrated.actionNarration?.text ?? '', /药板/);
assert.match(narrated.actionNarration?.text ?? '', /数字纸条/);
assert.match(narrated.actionNarration?.text ?? '', /获得.*线索/);
assert(
  narrated.warnings.some((warning) => warning.includes('missing confirmed package contents')),
  'generic AI narration must be rejected when confirmed package contents were revealed',
);
