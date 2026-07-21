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

const inspectedState = createInitialGameState();
inspectedState.room.bed.inspected = true;
inspectedState.room.bed.state.checkedUnder = true;
inspectedState.room.closet.inspected = true;
inspectedState.room.closet.state.checked = true;
const inspectionSummary = '你俯身检查了床底，没有发现可疑物品或新的线索。你逐层检查了衣柜，也没有发现异常。';
const multiAreaResolution: TurnResolution = {
  ...resolution,
  plan: {
    id: 'inspect-bed-and-closet',
    raw: '检查床底和衣柜',
    summary: '检查床底和衣柜',
    actions: [
      {
        id: 'inspect-bed',
        raw: '检查床底',
        intent: 'inspect',
        target: 'bed',
        method: 'under',
        confidence: 1,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
      {
        id: 'inspect-closet',
        raw: '检查衣柜',
        intent: 'inspect',
        target: 'closet',
        method: 'interior',
        confidence: 1,
        timeCost: 1,
        noise: 0,
        risk: 'low',
      },
    ],
    confidence: 1,
    warnings: [],
  },
  playerResult: {
    ...playerResult,
    title: '检查结果',
    text: inspectionSummary,
    state: inspectedState,
    domainEvents: [
      {
        eventType: 'inspection_completed',
        subject: 'bed',
        facts: ['fact.bed.under.checked', 'fact.bed.under.no_anomaly'],
      },
      {
        eventType: 'inspection_completed',
        subject: 'closet',
        facts: ['fact.closet.interior.checked', 'fact.closet.interior.no_anomaly'],
      },
    ],
  } as RuleResult & {
    domainEvents: Array<{ eventType: string; subject: string; facts: string[] }>;
  },
  finalState: inspectedState,
};

const localizedInspection = await narrateConfirmedTurn(multiAreaResolution, {
  narrateAction: async () => ({
    title: 'Inspection complete',
    text: '你检查了bed，然后检查了closet。',
  }),
  narrateAmbient: adapters.narrateAmbient,
});
const localizedInspectionText = `${localizedInspection.actionNarration?.title ?? ''}${localizedInspection.actionNarration?.text ?? ''}`;
assert.match(localizedInspectionText, /床底/);
assert.match(localizedInspectionText, /衣柜/);
assert.match(localizedInspectionText, /未发现|没有发现|无异常/);
assert.doesNotMatch(localizedInspectionText, /[A-Za-z]/);

const medicineState = structuredClone(state);
medicineState.room.package_medicine_blister.visible = true;
medicineState.room.package_medicine_blister.inspected = true;
medicineState.room.package_medicine_blister.state.detailsChecked = true;
const medicineSummary = '你拿起药板仔细检查。铝箔有撕开的痕迹，剩余药片上没有可辨认的品牌或药名；除此之外，没有发现新的编号或异常。';
const medicineResolution: TurnResolution = {
  ...resolution,
  plan: {
    id: 'inspect-package-medicine',
    raw: '检查药板',
    summary: '检查包裹里的药板',
    actions: [{
      id: 'inspect-package-medicine',
      raw: '检查药板',
      intent: 'inspect',
      target: 'package_medicine_blister',
      method: 'details',
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low',
    }],
    confidence: 1,
    warnings: [],
  },
  playerResult: {
    ...playerResult,
    title: '药板检查结果',
    text: medicineSummary,
    state: medicineState,
    domainEvents: [{
      eventType: 'package_item_inspected',
      subject: 'package_medicine_blister',
      facts: [
        'fact.package_medicine_blister.details.checked',
        'fact.package_medicine_blister.foil.opened',
        'fact.package_medicine_blister.label.unreadable',
        'fact.package_medicine_blister.no_new_clue',
      ],
    }],
  } as RuleResult & {
    domainEvents: Array<{ eventType: string; subject: string; facts: string[] }>;
  },
  finalState: medicineState,
};

const medicineNarration = await narrateConfirmedTurn(medicineResolution, {
  narrateAction: async () => ({
    title: '包裹检查完成',
    text: packageSummary,
  }),
  narrateAmbient: adapters.narrateAmbient,
});
const medicineNarrationText = `${medicineNarration.actionNarration?.title ?? ''}${medicineNarration.actionNarration?.text ?? ''}`;
assert.match(medicineNarrationText, /药板/);
assert.match(medicineNarrationText, /铝箔|药片/);
assert.doesNotMatch(medicineNarrationText, /旧书|数字纸条|打开.*包裹/);
assert(
  medicineNarration.warnings.some((warning) => warning.includes('package_medicine_blister')),
  'a repeated package overview must be rejected for a medicine-blister inspection',
);

const openActionSummary = '你打开手机浏览了一会社区动态，几分钟过去了，没有看到与当前危险直接相关的新消息。';
let openActionNarratorCalled = false;
const openActionNarratorText = '你打开手机浏览了一会儿社区动态，没有发现新的异常。';
const openActionNarration = await narrateConfirmedTurn({
  ...resolution,
  plan: {
    id: 'open-action-plan',
    raw: '打开手机浏览社区动态',
    summary: '使用手机',
    actions: [{
      id: 'open-action',
      raw: '打开手机浏览社区动态',
      intent: 'act',
      target: 'phone',
      method: 'social.feed',
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low',
    }],
    confidence: 1,
    warnings: [],
  },
  playerResult: {
    ...playerResult,
    title: '行动已确认',
    text: openActionSummary,
    state,
    domainEvents: [{
      eventType: 'player_action_completed',
      subject: 'phone',
      facts: ['fact.player.open_action.valid'],
    }],
  } as RuleResult & {
    domainEvents: Array<{ eventType: string; subject: string; facts: string[] }>;
  },
}, {
  narrateAction: async () => {
    openActionNarratorCalled = true;
    return { title: '行动结果', text: openActionNarratorText };
  },
  narrateAmbient: adapters.narrateAmbient,
});
assert.equal(openActionNarratorCalled, true, 'confirmed open actions must still reach the action narrator');
assert.equal(openActionNarration.actionNarration?.text, openActionNarratorText);
