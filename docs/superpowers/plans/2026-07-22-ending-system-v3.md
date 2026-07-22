# 结局系统 v3.0 实现计划

> **For agentic workers:** 使用 `superpowers:subagent-driven-development` 逐任务实现。Step 用 `- [ ]` 语法追踪。

**目标:** 将结局系统从三结局改为五档多维评分；新增知识激活引擎、可变凶手死亡路径、叙事式断案系统、灵光一现引导、跨循环持久化。

**架构:** 在现有 `game-core` 的 takeover/domain/facts 基础设施上，新增 player knowledge 层（区别于 NPC knowledge）、多维度评分器、死亡路径解析器、断案引擎四个独立模块，最后在 `resolveTurn` 和 `loopResetPolicy` 中串联。

**技术栈:** TypeScript, Vitest, 现有 game-core/shared 包

## 全局约束

- 所有新文件放在 `packages/game-core/src/` 下对应子目录
- 新类型放在 `packages/shared/src/types.ts`
- 遵循现有测试风格（tsx 直接运行 + vitest）
- 不改变现有 `/api/harness/turn` 对外接口结构，只扩展 payload
- 评分权重、断案阈值、灵光次数为初始值，后续玩测调整

---

## 文件结构

```
packages/shared/src/types.ts          — 修改: 新增 KnowledgeRecord, DeathPath, EndingTier 类型
packages/game-core/src/
  knowledge/
    knowledgeDefinitions.ts            — 创建: 知识定义（线索→知识激活规则）
    playerKnowledge.ts                 — 创建: 玩家知识激活引擎
  scoring/
    multiDimensionScorer.ts            — 创建: 多维度评分器
  death/
    deathPathResolver.ts               — 创建: 可变凶手死亡路径解析
  deduction/
    deductionEngine.ts                 — 创建: 断案引擎（命题校验 + 叙事式提示）
    epiphanyHints.ts                   — 创建: 灵光一现提示生成
  endings/
    endingTiers.ts                     — 创建: 结局分档解析
  loop/resolveTurn.ts                  — 修改: 集成知识激活 + 死亡路径 + 断案事件
  loop/rewind.ts                       — 修改: 知识 + 已发现线索跨循环保留
  commit/loopResetPolicy.ts            — 修改: retainFromPreviousLoop 加 player_knowledge
  index.ts                             — 修改: 导出新模块
```

---

### Task 1: 新增共享类型

**Files:**
- Modify: `packages/shared/src/types.ts`

**Interfaces:**
- Produces: `KnowledgeRecord`, `PlayerKnowledge`, `DeathPathType`, `DeathPathResult`, `EndingTier`, `DeductionClaim`, `DeductionResult`

在 `GameState` 定义之后、`RuleEvent` 之前插入新类型。同时在 `GameState` 中新增 3 个字段。

- [ ] **Step 1: 在 types.ts 末尾（ScoreResult 之后）添加新类型，并在 GameState 中添加字段**

在 `packages/shared/src/types.ts` 的 `GameState` 接口（约 265 行）中添加：

```typescript
// 在 GameState 的 world?: WorldState; 之后添加：
  /** 跨循环已激活的玩家知识 */
  activatedKnowledge: PlayerKnowledge[];
  /** 当前循环新激活的知识 */
  currentRunKnowledge: PlayerKnowledge[];
  /** 跨循环已发现的线索 ID——重置后自动可见 */
  discoveredClueIds: string[];
```

在文件末尾（`ScoreResult` 之后）添加新类型：

```typescript
// ===== v3.0 结局系统新增类型 =====

export type DeathPathType = 'suppression' | 'enforcement' | 'cleanup' | 'frameup';

export interface DeathPathResult {
  path: DeathPathType;
  killer: 'chen_huaimin' | 'fake_police' | 'zhao_hongyuan';
  rationale: string;
  /** 本轮玩家行为触发了哪条线 */
  triggeredBy: string[];
}

export interface PlayerKnowledge {
  id: string;                    // e.g. "package_not_for_503"
  label: string;                 // "包裹是寄错到 503 的"
  activatedAt: { run: number; minute: number };
  sourceClueIds: string[];       // 支撑这条知识的线索 ID
  truthLayerContribution: number;
  /** 互斥的知识 ID 列表 */
  excludes: string[];
}

export interface KnowledgeDefinition {
  id: string;
  label: string;
  /** 需要哪些线索 ID（全部满足才激活） */
  requiredClueIds: string[];
  /** 或者：任意 N 条满足即可 */
  anyOf?: { clueIds: string[]; count: number };
  excludes: string[];
  truthLayerContribution: number;
  /** 激活后解锁的调查方向（叙事提示用） */
  unlocksDirection: string;
}

export type EndingTier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface EndingTierResult {
  tier: EndingTier;
  totalScore: number;
  breakdown: {
    truthLayer: number;
    evidenceStrength: number;
    externalReach: number;
    survivors: number;
    cycleCost: number;
  };
  narrative: string;
  /** 非 S 档的回溯提示（叙事化），S 档为 null */
  backtrackHint: string | null;
}

export interface DeductionClaim {
  /** 玩家陈述中的一条命题 */
  statement: string;
  /** 匹配到的知识 ID，null = 没匹配 */
  knowledgeId: string | null;
  /** 校验结果 */
  verdict: 'confirmed' | 'contradicted' | 'unsubstantiated' | 'unrecognized';
}

export interface DeductionResult {
  claims: DeductionClaim[];
  confirmedCount: number;
  totalAsked: number;
  /** 是否达到断案门槛 */
  passed: boolean;
  /** 连续失败次数（用于灵光触发） */
  consecutiveFailures: number;
}
```

- [ ] **Step 2: 运行 typecheck 确认类型无冲突**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add v3.0 ending system types"
```

---

### Task 2: 知识定义

**Files:**
- Create: `packages/game-core/src/knowledge/knowledgeDefinitions.ts`

**Interfaces:**
- Consumes: `KnowledgeDefinition` from shared/types
- Produces: `KNOWLEDGE_DEFINITIONS: KnowledgeDefinition[]`, `getActivatableKnowledge(clueIds: string[]): KnowledgeDefinition[]`

- [ ] **Step 1: 创建知识定义文件**

```typescript
import type { KnowledgeDefinition } from '@murder-loop-ai/shared';

export const KNOWLEDGE_DEFINITIONS: KnowledgeDefinition[] = [
  {
    id: 'package_not_for_503',
    label: '包裹是寄错到 503 的',
    requiredClueIds: ['package_waybill_fragment', 'room_403_receipt'],
    excludes: [],
    truthLayerContribution: 10,
    unlocksDirection: '403',
  },
  {
    id: 'chen_is_monitoring',
    label: '陈怀民在监控我',
    requiredClueIds: ['unknown_number_4s', 'chen_knock_23_12'],
    excludes: [],
    truthLayerContribution: 10,
    unlocksDirection: '陈怀民的动机',
  },
  {
    id: 'chen_has_spare_key',
    label: '陈怀民用过备用钥匙',
    requiredClueIds: ['door_scratch'],
    excludes: [],
    truthLayerContribution: 5,
    unlocksDirection: '门锁安全',
  },
  {
    id: 'fake_police',
    label: '门外警察是假的',
    anyOf: {
      clueIds: ['police_no_siren', 'police_weird_questions', 'no_dispatch_record'],
      count: 2,
    },
    requiredClueIds: [],
    excludes: [],
    truthLayerContribution: 15,
    unlocksDirection: '谁在调动假警察',
  },
  {
    id: 'linyue_investigating',
    label: '林越在追查李汶涛失踪',
    requiredClueIds: ['linyue_last_words', 'room_403_cigarette'],
    excludes: ['linyue_is_accomplice'],
    truthLayerContribution: 15,
    unlocksDirection: '林越同盟',
  },
  {
    id: 'linyue_is_accomplice',
    label: '林越是帮凶',
    requiredClueIds: ['linyue_has_keys', 'linyue_corridor_lingering'],
    excludes: ['linyue_investigating'],
    truthLayerContribution: 0, // 红鲱鱼——不得分
    unlocksDirection: '',
  },
  {
    id: 'liventao_is_dead',
    label: '李汶涛已经死了',
    requiredClueIds: ['room_403_note', 'linyue_missing_confirm'],
    excludes: ['room_403_still_alive'],
    truthLayerContribution: 15,
    unlocksDirection: '李汶涛的遗产',
  },
  {
    id: 'zhao_is_1103',
    label: '1103 = 赵鸿远',
    requiredClueIds: ['usb_content', 'usb_password', 'room_403_notebook'],
    excludes: [],
    truthLayerContribution: 25,
    unlocksDirection: '赵鸿远的身份',
  },
  {
    id: 'org_has_inside_man',
    label: '组织有公安内线',
    requiredClueIds: ['usb_account_book', 'zhao_knew_about_police', 'real_police_delayed'],
    excludes: [],
    truthLayerContribution: 15,
    unlocksDirection: '如何绕过内线传证据',
  },
  {
    id: 'chen_not_mastermind',
    label: '陈怀民不是主谋',
    requiredClueIds: ['chen_fear_call', 'chen_name_card_1103'],
    excludes: [],
    truthLayerContribution: 10,
    unlocksDirection: '陈怀民在怕谁',
  },
];

/**
 * 根据已收集的线索 ID，找出可以激活但尚未激活的知识。
 * 线索 ID 集合来自 state.clues.map(c => c.id) + state.discoveredClueIds。
 */
export function getActivatableKnowledge(
  ownedClueIds: string[],
  alreadyActivated: string[],
): KnowledgeDefinition[] {
  const clueSet = new Set(ownedClueIds);
  const activatedSet = new Set(alreadyActivated);

  return KNOWLEDGE_DEFINITIONS.filter((def) => {
    if (activatedSet.has(def.id)) return false;

    // 检查互斥：如果某个互斥知识已激活，这条不能激活
    if (def.excludes.some((excluded) => activatedSet.has(excluded))) return false;

    // 任意 N 条满足模式
    if (def.anyOf) {
      const matched = def.anyOf.clueIds.filter((id) => clueSet.has(id)).length;
      return matched >= def.anyOf.count;
    }

    // 全部满足模式
    return def.requiredClueIds.every((id) => clueSet.has(id));
  });
}

/**
 * 根据已激活的知识，计算 truthLayer 总分（0-100）。
 */
export function computeTruthLayer(activatedKnowledgeIds: string[]): number {
  const activatedSet = new Set(activatedKnowledgeIds);
  const raw = KNOWLEDGE_DEFINITIONS
    .filter((def) => activatedSet.has(def.id))
    .reduce((sum, def) => sum + def.truthLayerContribution, 0);
  return Math.min(100, raw);
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/game-core/src/knowledge/knowledgeDefinitions.ts
git commit -m "feat(knowledge): add knowledge definitions and activation rules"
```

---

### Task 3: 玩家知识激活引擎

**Files:**
- Create: `packages/game-core/src/knowledge/playerKnowledge.ts`

**Interfaces:**
- Consumes: `KnowledgeDefinition`, `PlayerKnowledge`, `GameState` from shared; `getActivatableKnowledge` from knowledgeDefinitions
- Produces: `activatePlayerKnowledge(state: GameState): { state: GameState; newlyActivated: PlayerKnowledge[]; feedbackTexts: string[] }`

- [ ] **Step 1: 创建玩家知识激活引擎**

```typescript
import type { GameState, PlayerKnowledge } from '@murder-loop-ai/shared';
import { getActivatableKnowledge } from './knowledgeDefinitions';

/** 知识激活时的叙事反馈——角色内心认知，不是任务提示 */
const KNOWLEDGE_FEEDBACK: Record<string, string> = {
  package_not_for_503: '这不是我的快递。403——这栋楼里有另一个人。',
  chen_is_monitoring: '他知道我在家。23:01 那通电话不是打错了。他在确认。',
  chen_has_spare_key: '锁芯上的划痕是新的。他有备用钥匙——或者说，他用过。',
  fake_police: '没有警车声。他问的问题太具体了——像在套话，不像在核验。',
  linyue_investigating: '他不是在盯我。他在盯这栋楼。他说的"那个人"——是寄包裹的人。',
  linyue_is_accomplice: '', // 红鲱鱼，无反馈
  liventao_is_dead: '403 那个人不会再回来了。他留下这些东西，是因为他知道自己会死。',
  zhao_is_1103: '1103。账本里每一行都有这个编号。陈怀民的名片背面，也是它。',
  org_has_inside_man: '报警被压下来了。他们不是第一次这么做。',
  chen_not_mastermind: '他在怕——不是在怕你发现包裹，是在怕给他打电话的那个人。',
};

/**
 * 检查当前线索集合并激活新知识。
 * 在每个回合结束时调用。返回更新后的 state、新激活的知识、以及对应的叙事反馈文本。
 */
export function activatePlayerKnowledge(state: GameState): {
  state: GameState;
  newlyActivated: PlayerKnowledge[];
  feedbackTexts: string[];
} {
  const ownedClueIds = [
    ...state.clues.map((c) => c.id),
    ...state.discoveredClueIds,
  ];
  const alreadyActivated = state.activatedKnowledge.map((k) => k.id);

  const activatable = getActivatableKnowledge(ownedClueIds, alreadyActivated);
  if (activatable.length === 0) {
    return { state, newlyActivated: [], feedbackTexts: [] };
  }

  const newlyActivated: PlayerKnowledge[] = activatable.map((def) => ({
    id: def.id,
    label: def.label,
    activatedAt: { run: state.run, minute: state.minute },
    sourceClueIds: [...def.requiredClueIds, ...(def.anyOf?.clueIds ?? [])],
    truthLayerContribution: def.truthLayerContribution,
    excludes: def.excludes,
  }));

  const feedbackTexts = newlyActivated
    .map((k) => KNOWLEDGE_FEEDBACK[k.id])
    .filter(Boolean);

  return {
    state: {
      ...state,
      activatedKnowledge: [...state.activatedKnowledge, ...newlyActivated],
      currentRunKnowledge: [...state.currentRunKnowledge, ...newlyActivated],
    },
    newlyActivated,
    feedbackTexts,
  };
}

/**
 * 检查玩家是否达到断案最低门槛（已激活知识 ≥ 3 条，且排除红鲱鱼）。
 */
export function canAccuse(state: GameState): boolean {
  const validKnowledge = state.activatedKnowledge.filter(
    (k) => k.truthLayerContribution > 0,
  );
  return validKnowledge.length >= 3;
}

/**
 * 获取当前已激活知识的摘要——用于叙事式断案的线索陈列。
 */
export function getActivatedClueFragments(state: GameState): string[] {
  const knowledgeToClueMap: Record<string, string[]> = {
    package_not_for_503: ['包裹面单上残破的"青荷 5-0"', '403 收据上那个陌生的名字'],
    chen_is_monitoring: ['23:01 那通四秒的空号来电', '23:12 的敲门——他知道你在家'],
    fake_police: ['门外的人——问话方式不像警察'],
    linyue_investigating: ['林越压低声音说的那句话'],
    zhao_is_1103: ['陈怀民名片背面的数字', 'U盘里每一行都有的那个编号'],
    org_has_inside_man: ['报警之后——楼下迟迟没有警车声'],
	    chen_not_mastermind: ['陈怀民接电话时的语气——不是汇报，是挨骂'],
  };

  const fragments: string[] = [];
  for (const k of state.activatedKnowledge) {
    const mapped = knowledgeToClueMap[k.id];
    if (mapped) fragments.push(...mapped);
  }
  // 去重
  return [...new Set(fragments)];
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/game-core/src/knowledge/playerKnowledge.ts
git commit -m "feat(knowledge): add player knowledge activation engine"
```

---

### Task 4: 多维度评分器

**Files:**
- Create: `packages/game-core/src/scoring/multiDimensionScorer.ts`
- Modify: `packages/game-core/src/scoring/scoreRun.ts` — 保留旧函数，新增调用多维度评分器的入口

**Interfaces:**
- Consumes: `GameState`, `EndingTierResult`, `EndingTier` from shared; `computeTruthLayer` from knowledgeDefinitions
- Produces: `scoreEnding(state): EndingTierResult`

- [ ] **Step 1: 创建多维度评分器**

```typescript
import type { GameState, EndingTier, EndingTierResult } from '@murder-loop-ai/shared';
import { computeTruthLayer } from '../knowledge/knowledgeDefinitions';
import { hasConvictingEvidence } from '../rules/endingRules';

function scoreEvidenceStrength(state: GameState): number {
  let score = 0;
  const hasPhoto = state.clues.some((c) => c.id === 'package_photo')
    || Boolean(state.room.package?.state?.photographed);
  if (hasPhoto) score += 20;

  const hasUsb = state.clues.some((c) => c.id === 'usb_found')
    || Boolean(state.room.package?.state?.opened);
  if (hasUsb) score += 20;

  const hasPassword = state.clues.some((c) =>
    c.id === 'room_403_notebook' || c.id === 'usb_password_known',
  );
  if (hasUsb && hasPassword) score += 20;

  if (hasConvictingEvidence(state)) score += 20;

  const hasWitness = state.linYuePhase === 'safe'
    || state.linYuePhase === 'calling_police'
    || state.policePhase === 'real_police_en_route'
    || state.policePhase === 'arrived';
  if (hasWitness) score += 20;

  return Math.min(100, score);
}

function scoreExternalReach(state: GameState): number {
  let score = 0;
  const hasLinYueBackup = state.clues.some((c) => c.id === 'linyue_has_photo')
    || state.linYuePhase === 'calling_police'
    || state.linYuePhase === 'safe';
  if (hasLinYueBackup) score += 40;

  const policeHaveEvidence = state.policePhase === 'arrived'
    || state.policePhase === 'real_police_en_route'
    || state.clues.some((c) => c.id === 'police_verified');
  if (policeHaveEvidence) score += 30;

  // 公开/媒体维度暂不实现，预留
  return Math.min(100, score);
}

function scoreSurvivors(state: GameState): number {
  let score = 0;

  if (state.linYuePhase !== 'dead' && state.linYuePhase !== 'injured') {
    score += 60;
  } else if (state.linYuePhase === 'injured') {
    score += 30;
  }

  if (state.player.injury === 'none') {
    score += 40;
  } else if (state.player.injury === 'minor') {
    score += 20;
  }

  return Math.min(100, score);
}

function scoreCycleCost(state: GameState): number {
  if (state.run <= 5) return 0;
  if (state.run <= 10) return -20;
  if (state.run <= 15) return -40;
  if (state.run <= 20) return -60;
  return -100;
}

const TIER_THRESHOLDS: { tier: EndingTier; min: number }[] = [
  { tier: 'S', min: 90 },
  { tier: 'A', min: 70 },
  { tier: 'B', min: 50 },
  { tier: 'C', min: 30 },
  { tier: 'D', min: 0 },
];

const TIER_BACKTRACK_HINTS: Record<Exclude<EndingTier, 'S'>, string> = {
  A: '雨声还在。她闭眼，又睁开——有一件事她还没想通。',
  B: '陈怀民的脸她记住了。但她总觉得，那个电话号码后面还有别人。',
  C: '她活到了天亮。但 403 那扇门后面是什么，她不知道。',
  D: '她睁开眼。雨声落在窗外。又是 23:00。',
};

const TIER_NARRATIVES: Record<EndingTier, string> = {
  S: '证据链完整公开，赵鸿远被逮捕，组织网络被摧毁，李汶涛之死得到交代。',
  A: '警方拿到关键证据开始调查，但赵鸿远提前脱身，组织只是伤了元气。',
  B: '陈怀民被逮捕，组织切割了他，真相只揭露了表层。',
  C: '她知道了一切但证据不够，只能匿名举报后逃离城市。',
  D: '活下来了——不再循环——但没人知道 503 发生了什么。',
};

export function scoreEnding(state: GameState): EndingTierResult {
  const activatedIds = state.activatedKnowledge.map((k) => k.id);
  const truthLayer = computeTruthLayer(activatedIds);
  const evidenceStrength = scoreEvidenceStrength(state);
  const externalReach = scoreExternalReach(state);
  const survivors = scoreSurvivors(state);
  const cycleCost = scoreCycleCost(state);

  const totalScore = Math.round(
    truthLayer * 0.35
    + evidenceStrength * 0.30
    + externalReach * 0.25
    + survivors * 0.15
    + cycleCost * 0.05
  );

  const tier = TIER_THRESHOLDS.find((t) => totalScore >= t.min)?.tier ?? 'D';

  return {
    tier,
    totalScore,
    breakdown: { truthLayer, evidenceStrength, externalReach, survivors, cycleCost },
    narrative: TIER_NARRATIVES[tier],
    backtrackHint: tier === 'S' ? null : TIER_BACKTRACK_HINTS[tier],
  };
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/game-core/src/scoring/multiDimensionScorer.ts
git commit -m "feat(scoring): add multi-dimension ending scorer"
```

---

### Task 5: 死亡路径解析器

**Files:**
- Create: `packages/game-core/src/death/deathPathResolver.ts`

**Interfaces:**
- Consumes: `GameState`, `DeathPathResult`, `DeathPathType` from shared
- Produces: `resolveDeathPath(state, playerExposure, chenPressure): DeathPathResult`

- [ ] **Step 1: 创建死亡路径解析器**

```typescript
import type { GameState, DeathPathResult, DeathPathType } from '@murder-loop-ai/shared';

/** 按优先级排列，第一条满足条件的就是本轮死亡路径 */
const DEATH_PATH_RULES: Array<{
  path: DeathPathType;
  condition: (ctx: DeathPathContext) => boolean;
  killer: DeathPathResult['killer'];
  rationale: (ctx: DeathPathContext) => string;
}> = [
  {
    path: 'cleanup',
    condition: (ctx) => ctx.zhaoIntervened || ctx.externalReach >= 70,
    killer: 'zhao_hongyuan',
    rationale: (ctx) => ctx.zhaoIntervened
      ? '赵鸿远决定亲自收线。陈怀民已经不被信任了。'
      : '证据传到了外面。组织启动清理程序。',
  },
  {
    path: 'enforcement',
    condition: (ctx) => ctx.fakePoliceCalled || ctx.policeNearby,
    killer: 'fake_police',
    rationale: (ctx) => ctx.fakePoliceCalled
      ? '陈怀民搞不定——他叫了假警察。'
      : '真警察到了附近，假警察需要抢先行动。',
  },
  {
    path: 'frameup',
    condition: (ctx) => ctx.linYueInvolved && ctx.chenCanFrame,
    killer: 'chen_huaimin',
    rationale: () => '陈怀民需要替罪羊。林越上楼了——正好。',
  },
  {
    path: 'suppression',
    condition: () => true, // 默认
    killer: 'chen_huaimin',
    rationale: (ctx) => ctx.playerOpenedPackage
      ? '陈怀民确认包裹被拆了。必须灭口。'
      : '时间到了。陈怀民来确认包裹。',
  },
];

interface DeathPathContext {
  zhaoIntervened: boolean;
  externalReach: number;
  fakePoliceCalled: boolean;
  policeNearby: boolean;
  linYueInvolved: boolean;
  chenCanFrame: boolean;
  playerOpenedPackage: boolean;
}

function buildDeathPathContext(state: GameState): DeathPathContext {
  const packageOpened = state.clues.some((c) => c.id === 'package_opened')
    || state.room.package?.state?.opened === true;

  const evidenceShared = state.clues.some((c) =>
    c.id === 'linyue_has_photo' || c.id === 'police_verified'
  ) || state.linYuePhase === 'calling_police'
    || state.policePhase === 'real_police_en_route'
    || state.policePhase === 'arrived';

  return {
    zhaoIntervened: state.killerPhase === 'evidence_erasure'
      || state.threat >= 80
      || (evidenceShared && state.run > 5),
    externalReach: evidenceShared ? 70 : state.clues.some((c) => c.id === 'package_photo') ? 20 : 0,
    fakePoliceCalled: state.killerPhase === 'deception'
      || state.killerPhase === 'forced_entry'
      || state.policePhase === 'misled',
    policeNearby: state.policePhase === 'real_police_en_route'
      || state.policePhase === 'arrived'
      || state.policePhase === 'dispatch_pending',
    linYueInvolved: state.linYuePhase === 'coming_to_apartment'
      || state.linYuePhase === 'endangered'
      || state.linYuePhase === 'calling_police',
    chenCanFrame: state.killerStatus === 'alive'
      && state.linYuePhase === 'coming_to_apartment',
    playerOpenedPackage: packageOpened,
  };
}

export function resolveDeathPath(state: GameState): DeathPathResult {
  const ctx = buildDeathPathContext(state);

  for (const rule of DEATH_PATH_RULES) {
    if (rule.condition(ctx)) {
      return {
        path: rule.path,
        killer: rule.killer,
        rationale: rule.rationale(ctx),
        triggeredBy: Object.entries({
          zhaoIntervened: ctx.zhaoIntervened,
          fakePoliceCalled: ctx.fakePoliceCalled,
          policeNearby: ctx.policeNearby,
          linYueInvolved: ctx.linYueInvolved,
          playerOpenedPackage: ctx.playerOpenedPackage,
        }).filter(([, v]) => v).map(([k]) => k),
      };
    }
  }

  // fallback（不应到达）
  return {
    path: 'suppression',
    killer: 'chen_huaimin',
    rationale: '23:47。门开了。',
    triggeredBy: ['deadline'],
  };
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/game-core/src/death/deathPathResolver.ts
git commit -m "feat(death): add variable killer death path resolver"
```

---

### Task 6: 断案引擎

**Files:**
- Create: `packages/game-core/src/deduction/deductionEngine.ts`
- Create: `packages/game-core/src/deduction/epiphanyHints.ts`

**Interfaces:**
- Consumes: `GameState`, `DeductionResult`, `DeductionClaim` from shared; `getActivatedClueFragments` from playerKnowledge
- Produces: `buildDeductionPrompt(state): string`, `validateDeductionClaims(state, playerText): DeductionResult`, `generateEpiphanyHint(state, failureCount, previousHints): string | null`

- [ ] **Step 1: 创建灵光提示模块**

```typescript
// packages/game-core/src/deduction/epiphanyHints.ts
import type { GameState } from '@murder-loop-ai/shared';
import { KNOWLEDGE_DEFINITIONS } from '../knowledge/knowledgeDefinitions';

interface EpiphanyHint {
  knowledgeId: string;
  levels: [string, string, string]; // 微光、闪烁、骤亮
}

const EPIPHANY_HINTS: EpiphanyHint[] = [
  {
    knowledgeId: 'linyue_investigating',
    levels: [
      '她脑子里忽然闪过一个画面——林越那天在走廊，不是在看她的门。他在看楼下。',
      '等一下。林越提到过一个人。"之前住 403 的那个"。他说这话的时候把声音压得很低。',
      '403。李汶涛。林越不是在盯她——他在找这个人。李汶涛失踪之前，最后一个跟他说话的人，是林越。',
    ],
  },
  {
    knowledgeId: 'chen_not_mastermind',
    levels: [
      '她想起陈怀民接电话时的样子——背对着门，声音压得很低。不像在汇报。像在挨骂。',
      '名片。他递名片的时候手在抖。背面那个数字——不是他的号码。',
      '"1103"。那不是房号，不是电话。那是某个人在组织里的编号。陈怀民的名片上写着别人的编号。',
    ],
  },
  {
    knowledgeId: 'fake_police',
    levels: [
      '她忽然意识到——那个人说"503 有人报警说有可疑包裹"的时候，没有出示过证件。',
      '不对。真警察不会问"你一个人住吗"——他们会先报自己的警号和接警编号。',
      '她回拨 110 确认过——今晚根本没有警员派到青荷公寓。那个人不是警察。是谁调他来的？',
    ],
  },
  {
    knowledgeId: 'zhao_is_1103',
    levels: [
      '陈怀民名片背面的数字……她在另一个地方也见过。',
      'U盘。账本。每一行转账记录的备注栏——都有同一个编号。',
      '1103 是组织内部的编号。账本里每一个转运点、每一个人——都是数字。赵鸿远的编号，就是 1103。',
    ],
  },
  {
    knowledgeId: 'org_has_inside_man',
    levels: [
      '她报过警。但每次真警察都被拖住了。不是巧合。',
      '23:23——那个自动报警电话。她查过接警记录。有人把这条记录标记为"已处理"。',
      '公安内线。赵鸿远的人在系统里。报警走不通——必须换一条路传证据。',
    ],
  },
  {
    knowledgeId: 'liventao_is_dead',
    levels: [
      '403 桌上那半包烟——不是最近放的。但烟灰缸是空的。有人打扫过房间，但没碰烟。',
      '"如果他来，就说我搬走了。"——不是留给房东的。是留给来找他的人。',
      '李汶涛知道自己会死。他把 U盘寄出去、给林越留了话、设了定时报警——他在安排自己的后事。',
    ],
  },
];

/**
 * 找出玩家缺失的、级联影响最大的知识，生成对应级别的灵光提示。
 * 每次只给一个方向。
 */
export function generateEpiphanyHint(
  state: GameState,
  consecutiveFailures: number,
  previousHintIds: string[],
): string | null {
  const levelIndex = consecutiveFailures >= 6 ? 2
    : consecutiveFailures >= 4 ? 1
    : consecutiveFailures >= 2 ? 0
    : -1;

  if (levelIndex < 0) return null;

  const activatedIds = new Set(state.activatedKnowledge.map((k) => k.id));
  const ownedClueIds = new Set([
    ...state.clues.map((c) => c.id),
    ...state.discoveredClueIds,
  ]);

  // 优先提示：玩家已拥有足够线索但还没激活的知识
  const missingButReady = EPIPHANY_HINTS
    .filter((h) => !activatedIds.has(h.knowledgeId))
    .filter((h) => !previousHintIds.includes(h.knowledgeId))
    .sort((a, b) => {
      // 级联影响越大越优先——truthLayerContribution 高的排在前面
      const defA = KNOWLEDGE_DEFINITIONS.find((d) => d.id === a.knowledgeId);
      const defB = KNOWLEDGE_DEFINITIONS.find((d) => d.id === b.knowledgeId);
      return (defB?.truthLayerContribution ?? 0) - (defA?.truthLayerContribution ?? 0);
    });

  const target = missingButReady[0];
  if (!target) return null;

  return target.levels[levelIndex];
}
```

- [ ] **Step 2: 创建断案引擎**

```typescript
// packages/game-core/src/deduction/deductionEngine.ts
import type { GameState, DeductionClaim, DeductionResult } from '@murder-loop-ai/shared';
import { getActivatedClueFragments } from '../knowledge/playerKnowledge';
import { generateEpiphanyHint } from './epiphanyHints';

/**
 * 生成叙事式断案的开场提示——陈列已发现的线索碎片，递话头。
 */
export function buildDeductionPrompt(state: GameState): string {
  const fragments = getActivatedClueFragments(state);
  if (fragments.length === 0) {
    return '你靠在门边，脑子一片空白。你知道的还不够。';
  }

  const lines = fragments.map((f) => `  ${f}。`);
  return [
    '你靠在门边，把这几轮的记忆在脑子里过了一遍。',
    '',
    ...lines,
    '',
    '这些碎片拼在一起——',
  ].join('\n');
}

/**
 * 校验玩家断案陈述中的每条命题。
 * 简单关键词匹配 + 已激活知识对照。
 */
export function validateDeductionClaims(
  state: GameState,
  playerText: string,
): DeductionResult {
  const activatedIds = new Set(state.activatedKnowledge.map((k) => k.id));
  const activatedLabels = new Map(
    state.activatedKnowledge.map((k) => [k.id, k.label]),
  );

  // 将玩家文本拆成命题（按句号/逗号/分号分割）
  const rawClaims = playerText
    .split(/[。，；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const claims: DeductionClaim[] = rawClaims.map((statement) => {
    // 每个已激活知识尝试匹配玩家陈述
    for (const [id, label] of activatedLabels) {
      // 简单关键词重叠检测
      const labelWords = new Set(label.split(''));
      if (labelWords.size === 0) continue;
      const overlap = [...labelWords].filter((ch) => statement.includes(ch)).length;
      if (overlap >= labelWords.size * 0.4) {
        return { statement, knowledgeId: id, verdict: 'confirmed' as const };
      }
    }

    // 检查是否与互斥知识矛盾
    for (const k of state.activatedKnowledge) {
      for (const excludedId of k.excludes) {
        const excludedLabel = activatedLabels.get(excludedId);
        if (excludedLabel && statement.includes(excludedLabel.substring(0, 2))) {
          return { statement, knowledgeId: null, verdict: 'contradicted' as const };
        }
      }
    }

    return { statement, knowledgeId: null, verdict: 'unrecognized' as const };
  });

  const confirmedCount = claims.filter((c) => c.verdict === 'confirmed').length;
  const passed = confirmedCount >= 3;

  return {
    claims,
    confirmedCount,
    totalAsked: claims.length,
    passed,
    consecutiveFailures: 0, // 由上层调用者管理
  };
}

/**
 * 断案后的叙事回应。
 */
export function buildDeductionResponse(result: DeductionResult): string {
  if (result.passed) {
    return '她说完了。雨声填满了沉默——她知道，自己终于把碎片拼对了。';
  }
  const hasContradiction = result.claims.some((c) => c.verdict === 'contradicted');
  if (hasContradiction) {
    return '……不对。她停顿了一下。有些细节对不上。';
  }
  return '她能说的都说了。但有些事——还连不上。';
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 4: 提交**

```bash
git add packages/game-core/src/deduction/
git commit -m "feat(deduction): add deduction engine and epiphany hints"
```

---

### Task 7: 跨循环持久化

**Files:**
- Modify: `packages/game-core/src/commit/loopResetPolicy.ts`
- Modify: `packages/game-core/src/loop/rewind.ts`

**Interfaces:**
- Consumes: `GameState`, `PlayerKnowledge` from shared
- Produces: 修改后的 `prepareGameLoopReset` 保留 `activatedKnowledge` 和 `discoveredClueIds`

- [ ] **Step 1: 修改 loopResetPolicy.ts**

在 `prepareGameLoopReset` 函数中（约第 57 行 `state.clues = ...` 之后），添加知识保留：

```typescript
// 添加在 state.clues = structuredClone(...) 这一行之后：
  // v3.0: 保留玩家已激活的知识
  state.activatedKnowledge = structuredClone(current.activatedKnowledge);
  state.discoveredClueIds = [...new Set([
    ...(checkpoint.discoveredClueIds ?? []),
    ...(current.discoveredClueIds ?? []),
  ])];
```

同时在 `DEFAULT_LOOP_RESET_POLICY.retainFromPreviousLoop` 中添加：

```typescript
retainFromPreviousLoop: ['player_cross_loop_memory', 'persistent_player_clues', 'player_knowledge'],
```

- [ ] **Step 2: 修改 rewind.ts**

在 `prepareDeathLoopReset` 中，修改开场叙事逻辑——根据已激活知识生成不同的开场文本：

```typescript
// 替换 next.log = [...] 块中的叙事逻辑：
  const knowledgeCount = next.activatedKnowledge?.length ?? 0;
  const hasDeepKnowledge = knowledgeCount >= 5;

  next.log = [
    hasDeepKnowledge
      ? {
          id: `rewind-${next.run}`,
          run: next.run,
          minute: START_MINUTE,
          title: `第 ${next.run} 次醒来`,
          text: '她睁开眼。23:00。前几轮的记忆压在胸口——假警察的措辞、林越说的\'那个人\'、403 门缝里透出来的霉味。她比上次多知道了一些事。这次，她知道该问谁。',
          tone: 'memory',
          channel: 'memory',
        }
      : knowledgeCount >= 2
        ? {
            id: `rewind-${next.run}`,
            run: next.run,
            minute: START_MINUTE,
            title: `第 ${next.run} 次醒来`,
            text: `又是 23:00。她看了一眼桌上的纸箱——她很清楚里面是什么。还有 47 分钟。她拿起手机。`,
            tone: 'memory',
            channel: 'memory',
        }
        : { /* 保留原有逻辑 */ },
  ];
```

- [ ] **Step 3: 运行测试确认未破坏现有行为**

```bash
npm run test -w @murder-loop-ai/game-core
```

- [ ] **Step 4: 提交**

```bash
git add packages/game-core/src/commit/loopResetPolicy.ts packages/game-core/src/loop/rewind.ts
git commit -m "feat(persistence): preserve player knowledge and discovered clues across loops"
```

---

### Task 8: 集成到 resolveTurn + harnessTurn

**Files:**
- Modify: `packages/game-core/src/loop/resolveTurn.ts`
- Modify: `apps/server/src/routes/harnessTurn.ts`
- Modify: `packages/game-core/src/events/eventTypes.ts`
- Modify: `packages/game-core/src/index.ts`

**Interfaces:**
- Consumes: `activatePlayerKnowledge`, `resolveDeathPath`, `validateDeductionClaims`, `buildDeductionPrompt`, `buildDeductionResponse`, `scoreEnding`, `canAccuse`
- Produces: 串联后的完整回合管线，新增 `DeductionRequested` 事件

- [ ] **Step 1: 在 eventTypes.ts 中添加新事件类型**

```typescript
// 在 GameEventType 联合中添加：
| 'DeductionRequested'

// 在 GameEventPayloads 中添加：
DeductionRequested: { input: string; state: GameState; deductionPrompt: string };

// 在 GameCommandResults 中添加：
DeductionRequested: DeductionResult;
```

- [ ] **Step 2: 在 resolveTurn.ts 中集成知识激活和死亡路径**

在 `resolveTurnHarness` 函数的 Step 1 之后（`ctx.plan = plan;` 之后），添加知识激活：

```typescript
  // Step 1.5: 激活玩家知识
  const knowledgeResult = activatePlayerKnowledge(ctx.state);
  ctx.state = knowledgeResult.state;
  // 将知识激活的叙事反馈注入到 log 中
  for (const feedback of knowledgeResult.feedbackTexts) {
    ctx.state.log = [
      ...ctx.state.log,
      {
        id: `knowledge-${ctx.state.run}-${ctx.state.minute}-${Math.random().toString(36).slice(2, 8)}`,
        run: ctx.state.run,
        minute: ctx.state.minute,
        title: '灵光一现',
        text: feedback,
        tone: 'memory' as const,
        channel: 'system' as const,
      },
    ];
  }
```

在 Step 4（KillerActed 之后）添加死亡路径解析：

```typescript
  // Step 4.5: 解析死亡路径（如果时间已到 23:47 或威胁触发）
  const deathPath = ctx.state.minute >= 1427 || ctx.state.threat >= 90
    ? resolveDeathPath(ctx.state)
    : null;
  // deathPath 注入到 killerResult.events 中供叙事使用
```

- [ ] **Step 3: 在 harnessTurn.ts 中处理断案意图**

在 `harnessTurnRoute` 中（`resolveTurnHarness` 调用之前），检测断案意图：

```typescript
    // 在 const resolution = await resolveTurnHarness(...) 之前：
    const isAccusation = input.includes('指认') || input.includes('我知道')
      || input.includes('真相') || input.includes('断案');

    if (isAccusation && state.activatedKnowledge?.length >= 3) {
      const { canAccuse, buildDeductionPrompt, validateDeductionClaims, buildDeductionResponse, scoreEnding } = await import('@murder-loop-ai/game-core');
      if (canAccuse(state)) {
        const prompt = buildDeductionPrompt(state);
        const deductionResult = validateDeductionClaims(state, input);
        if (deductionResult.passed) {
          const endingResult = scoreEnding(state);
          // 返回结局
          return {
            ...baseResponse,
            ending: endingResult,
            deduction: deductionResult,
          };
        }
        // 未通过——返回断案提示 + 可能的灵光
        const epiphany = generateEpiphanyHint(state, /* consecutiveFailures */);
        return {
          ...baseResponse,
          deduction: deductionResult,
          deductionPrompt: prompt,
          response: buildDeductionResponse(deductionResult),
          epiphany,
        };
      }
    }
```

- [ ] **Step 4: 更新 index.ts 导出**

```typescript
// 新增导出
export { activatePlayerKnowledge, canAccuse, getActivatedClueFragments } from './knowledge/playerKnowledge';
export { KNOWLEDGE_DEFINITIONS, getActivatableKnowledge, computeTruthLayer } from './knowledge/knowledgeDefinitions';
export { scoreEnding } from './scoring/multiDimensionScorer';
export { resolveDeathPath } from './death/deathPathResolver';
export { buildDeductionPrompt, validateDeductionClaims, buildDeductionResponse } from './deduction/deductionEngine';
export { generateEpiphanyHint } from './deduction/epiphanyHints';
```

- [ ] **Step 5: 运行全量测试和类型检查**

```bash
npm run typecheck
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
```

- [ ] **Step 6: 提交**

```bash
git add packages/game-core/src/loop/resolveTurn.ts packages/game-core/src/events/eventTypes.ts packages/game-core/src/index.ts apps/server/src/routes/harnessTurn.ts
git commit -m "feat(endings): integrate v3.0 ending system into resolveTurn and harnessTurn"
```

---

### Task 9: 创建初始化状态的默认值

**Files:**
- Modify: `packages/game-core/src/state/createInitialState.ts`

- [ ] **Step 1: 在 createInitialGameState 中初始化新字段**

在 `createInitialGameState` 返回的 state 对象中确保包含：

```typescript
  activatedKnowledge: [],
  currentRunKnowledge: [],
  discoveredClueIds: [],
```

- [ ] **Step 2: 提交**

```bash
git add packages/game-core/src/state/createInitialState.ts
git commit -m "fix(state): initialize v3.0 knowledge fields in initial state"
```

---

## 验证清单

全部任务完成后运行：

```bash
npm run typecheck
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run dev  # 手动冒烟测试
```

最低验证标准：
- [ ] 类型检查全部通过
- [ ] game-core 全部测试通过（不破坏已有测试）
- [ ] server 全部测试通过
- [ ] 第一轮游戏能正常启动（activatedKnowledge 初始化为空数组）
- [ ] 发现线索后知识能自动激活
- [ ] 知识跨循环保留
- [ ] 断案触发后能返回评分
