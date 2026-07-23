# Current Architecture Entrypoints

本文档记录当前代码库的真实架构入口和模块职责，用于后续低风险重构。它不是目标架构设计，也不描述未来理想状态；如果代码和旧设计文档不一致，以本文档记录的当前主链路为准。

## 1. 当前正式主入口

当前正式游戏回合入口是：

```txt
POST /api/harness/turn
```

前端主界面直接调用该接口：

```txt
apps/web/src/App.tsx
  -> apps/web/src/store/gameStore.ts
  -> apps/web/src/api/harnessTurnClient.ts
  -> POST /api/harness/turn
```

服务端主路由位于：

```txt
apps/server/src/routes/harnessTurn.ts
```

核心回合管线位于：

```txt
packages/game-core/src/loop/resolveTurn.ts
  createHarness()
  resolveTurnHarness()
  resolveTurnHarnessFromPreparedPlayerTurn()
```

## 2. 当前主流程

```txt
apps/web
  -> apps/web/src/store/gameStore.ts
  -> apps/web/src/api/harnessTurnClient.ts
  -> POST /api/harness/turn
  -> apps/server/src/routes/harnessTurn.ts
  -> apps/server/src/ai/harnessAiAdapters.ts:createAiHarness()
  -> packages/game-core/createHarness()
  -> packages/game-core/resolveTurnHarness()
     -> PlayerActionSubmitted
        -> ParserAgent
     -> ActionParsed
        -> RuleAgent
     -> RulesApplied
        -> KillerAgent
     -> KillerActed
        -> RuleAgent
     -> NarrationRequested
        -> NarratorAgent
     -> NarrationDone
        -> DirectorAgent
     -> TurnCompleted
        -> SidebarAgent / UIAdapterAgent
  -> apps/server/src/presenters/frontendTurnPresenter.ts
  -> apps/web renders story, clues, sidebar, audio cue, trace/debug info
```

这条链路是当前应该优先维护的主线。后续功能、测试和重构应默认围绕它展开。

阶段二增加了一条默认关闭的只读 Shadow 旁路：

```txt
POST /api/harness/turn
  ├─ 正式 resolveTurnHarness() → 正式响应与 State
  └─ AI_SHADOW_RUN_ENABLED=true 时
       Semantic Compiler
       → Main World Model + 全 Specialist 并行候选
       → Shadow Arbiter / High-Risk Gate / 模拟提交
       → 内存调试报告
```

Shadow 旁路不写正式 State，也不阻塞正式响应。实现和运行说明见 `docs/ai-first-phase-2-implementation.md`。

阶段三增加了一条默认关闭的正式低风险接管分支：

```txt
POST /api/harness/turn
  └─ AI_LOW_RISK_TAKEOVER_ENABLED=true 时
       Semantic Compiler + 并行候选 + Shadow Arbiter
       → 可逆 player proposal 与低风险白名单门禁
       → 确定性低风险 Reducer
       → resolveTurnHarnessFromPreparedPlayerTurn()
          （跳过旧 Parser / 玩家 RuleAgent，继续 World / Killer / Narrator）
       → Atomic Turn Commit
       → committed 后发布；conflict/failed 零 State、零故事展示
```

不满足接管门禁时，路由仍完整执行旧 `resolveTurnHarness()`。阶段三不写 Knowledge、Clue、NPC 永久状态、Death 或 Ending；临近这些高风险边界的回合直接回退旧链。实现、开关和回滚说明见 `docs/ai-first-phase-3-implementation.md`。

阶段四在同一原子提交边界内接管 Knowledge 与 Clue，默认仍关闭：

```txt
AI_KNOWLEDGE_CLUE_TAKEOVER_ENABLED=true
  → 自动启用阶段二/三所需的 Shadow + 低风险接管链
  → Knowledge 必须引用本批事件及其已确认 fact
  → Observation 必须引用玩家可见事件及其可见 fact
  → Clue claims 必须是 Observation 内容的子集
  → 清除本回合旧链无来源 Knowledge / Clue 增量
  → 与 State、事件批一起 Atomic Turn Commit
  → Narrator.clue 无正式写权限
```

阶段四开关单独启用时只覆盖阶段三低风险回合；其实现和回滚说明见 `docs/ai-first-phase-4-implementation.md`。阶段五开启时会自动包含阶段四投影。

阶段五增加默认关闭的高风险正式接管：

```txt
AI_HIGH_RISK_TAKEOVER_ENABLED=true
  → 自动启用阶段二/三/四主链
  → 从选中的 Killer / NPC / Environment Proposal 收集事件
  → High-Risk Gate 要求完整因果链 + 独立确定性证据
  → 本地复核 Proposal 权限、Actor 能力、位置、屏障、伤害和 Ending 原因
  → 从阶段三确认的玩家 State 确定性回放批准事件
  → 丢弃旧 World / Killer / NPC / Narrator 的状态和高风险文本写入
  → 与阶段四投影一起 Atomic Turn Commit
  → committed 后只发布本地确认文本和 pass/defer/reject 审计
```

阶段五接管 Killer 行动、强入/攻击、NPC 永久状态、Death / Ending 和关键证据销毁。临近 deadline 或警方状态的低风险玩家回合不再回退旧链，而由阶段五处理下游结果；玩家主动攻击等不在阶段三白名单内的高风险玩家命令仍保留旧路径。实现和回滚说明见 `docs/ai-first-phase-5-implementation.md`。

## 3. Monorepo 模块职责

### apps/web

职责：

- 展示剧情文本、线索、侧边栏、音效和过场动画。
- 收集玩家自然语言输入。
- 通过 `src/api/harnessTurnClient.ts` 调用 `/api/harness/turn`。
- 保存前端展示状态和 `coreState`。

当前注意点：

- `App.tsx` 只负责 UI 组合、过场动画、线索弹窗、移动侧栏和音效触发等临时 UI 状态。
- `src/store/gameStore.ts` 是当前 Web 侧正式前端状态入口，负责 `frontendState`、`submitAction`、`rewind`、`reset` 和 `lastDebug`。
- `src/api/harnessTurnClient.ts` 是当前 Web 侧 harness turn 请求入口。
- Web 侧旧单 Agent API client 已移除；正式前端不再直接调用 `/api/parse-action`、`/api/killer-strategy`、`/api/narrate*` 或 `/api/npc-reply`。

### apps/server

职责：

- 提供 Fastify HTTP API。
- 适配 AI provider 和 role 配置。
- 构造 Parser / Killer / Narrator / Director / NPC 的 AI adapter。
- 调用 `game-core` 的 harness 管线。
- 将 `game-core` 返回的状态转换为前端需要的 payload。

当前注意点：

- `routes/harnessTurn.ts` 是正式主路由，当前主要负责请求处理、复活/回合编排、动态线索、audio cue、sidebar 与最终响应组装。
- `takeover/lowRiskTakeoverService.ts` 负责阶段三至五 Shadow/Arbiter 接管门禁、高风险投影和 Atomic Store 编排；开关关闭或门禁未通过时不改变旧链。
- `ai/harnessAiAdapters.ts` 负责 `createAiHarness()` 以及 Parser / Killer / Narrator / Director / NPC 的 AI adapter。
- `state/coerceGameState.ts` 负责旧状态和旧线索兼容。
- `presenters/frontendTurnPresenter.ts` 负责前端 story/clue/sidebar 派生展示转换。
- `index.ts` 已按 core/debug/legacy 分组注册路由。
- `routes/frontendAdapter.ts` 是较早的前端聚合入口，当前应视为 legacy。
- 单 Agent 路由仍存在，适合 debug，不应再作为正式游戏回合主路径。

### packages/game-core

职责：

- 维护游戏规则、回合流程、harness、Agent 注册、fallback 实现、记忆、Killer 知识边界。
- 通过 `ContextBuilder` 为不同 Agent 构造可见上下文。
- 通过 `HarnessDispatcher` 统一执行 Agent、fallback 降级、Trace 记录和 Artifact 记录。

当前核心文件：

```txt
src/loop/resolveTurn.ts
src/context/ContextBuilder.ts
src/events/HarnessDispatcher.ts
src/events/AgentRegistry.ts
src/events/eventTypes.ts
src/agents/*.ts
src/rules/applyPlayerActions.ts
src/killer/knowledge.ts
src/killer/applyKillerStrategy.ts
src/takeover/lowRiskTakeover.ts
src/commit/atomicTurnCommit.ts
```

边界原则：

- `game-core` 是规则和回合事实的权威。
- AI 叙事不能直接改变死亡、生还、证据、NPC 到场或状态变更。
- Killer 不应读取完整 `GameState`、完整 `playerResult` 或玩家原始私密事实；只能通过 `KillerContext` 消费投影后的信息。

### packages/ai-contracts

职责：

- 定义 Agent 输入/输出 schema。
- 定义 ActionPlan、KillerStrategy、Narration、RuleResult、AgentTrace 等契约。
- 为 `game-core` 的 contract enforcement 和 server AI 输出校验提供统一结构。

边界原则：

- 这里应保持为契约和 schema 层。
- 不应放具体游戏规则、prompt 或前端展示逻辑。

### packages/content

职责：

- 提供故事设定、房间物品、线索、NPC 和 World Info Lite。
- `worldInfo.ts` 根据 agent、输入、状态和事件选择可注入的 World Info 卡片。

边界原则：

- World Info 是设定上下文，不是规则裁判。
- World Info 不应直接决定行动成功、生死、结局或状态变更。

### packages/shared

职责：

- 提供跨包共享类型、时间常量和音频相关共享数据。

边界原则：

- 共享类型应尽量稳定。
- 避免把 server-only、web-only 或 prompt-only 细节放入 shared。

## 4. 当前正式接口与旁路接口

### 正式接口

```txt
GET  /health
POST /api/harness/turn
```

它们在 `apps/server/src/index.ts` 中通过 `registerCoreRoutes()` 注册。

### Debug 接口

```txt
POST /api/parse-action
POST /api/killer-strategy
POST /api/narrate
POST /api/narrate-action
POST /api/narrate-ambient
POST /api/npc-reply
POST /api/score-run
```

这些接口在 `registerDebugRoutes()` 中注册，可以暂时保留用于调试和回归测试，但后续新增正式玩法时不应默认接入这些接口。

### Legacy 接口

```txt
POST /api/frontend/resolve-action
```

该接口在 `registerLegacyRoutes()` 中注册，用于兼容较早的前端聚合路径。

## 5. 当前主要臃肿点

### 5.1 `harnessTurn.ts` 已完成第一轮减脂

`apps/server/src/routes/harnessTurn.ts` 已经抽出以下职责：

```txt
apps/server/src/presenters/frontendTurnPresenter.ts
apps/server/src/state/coerceGameState.ts
apps/server/src/ai/harnessAiAdapters.ts
```

它当前仍承担：

- Fastify route。
- 死亡状态自动回退入口。
- plot guidance 异步缓存。
- 动态线索提取。
- audio cue 主响应附加，以及正文渲染后的 SidebarAgent 延迟调度。
- 最终 response 组装和 coordination 汇总。

后续如果继续拆，应优先考虑 `plotGuidance` 或 `dynamicClues`，仍保持一次只移动一类职责。

### 5.2 前端状态已统一

当前存在：

```txt
apps/web/src/App.tsx
apps/web/src/store/gameStore.ts
apps/web/src/turnViewModel.ts
```

前端状态源已统一到 `gameStore.ts`。`App.tsx` 不再直接持有主 `GameState`、不直接发起 harness 请求，也不直接做持久化；它从 store 读取 `frontendState` 并调用 `submitAction` / `rewind` / `reset`。

当前分工：

```txt
App.tsx -> UI composition only
gameStore.ts -> frontendState, submitAction, rewind, reset, lastDebug
turnViewModel.ts -> begin/merge/rewind frontend state transitions
harnessTurnClient.ts -> POST /api/harness/turn
```

### 5.3 旧 API 与新 harness 并存

旧单 Agent API 仍然注册在 server index 的 `registerDebugRoutes()` 中。它们短期可以用于 debug，但长期需要明确是否：

- 保留为 debug-only；
- 用环境变量控制注册；
- 或逐步删除。

## 6. 不建议优先重构的部分

### ContextBuilder

`ContextBuilder` 当前是必要复杂度，不建议先砍。它负责把完整游戏状态投影成不同 Agent 的可见上下文，是防止 Killer 全知和 Narrator 越权的关键边界层。

### HarnessDispatcher / AgentRegistry

这两个模块当前职责相对清楚：

- `AgentRegistry` 管理 Agent 注册、订阅和模式切换。
- `HarnessDispatcher` 负责按 command 执行 primary Agent、fallback 降级、trace 和 artifact 记录。

后续可以增强类型安全，但不应作为第一批减脂目标。

## 7. 后续推荐重构顺序

建议按以下顺序推进，每一步保持行为不变并单独验证：

```txt
Done:
1. Extract frontend presenter helpers from harnessTurn.ts
2. Extract game state coercion helpers from harnessTurn.ts
3. Extract AI harness adapter factory from harnessTurn.ts
4. Group core/debug/legacy routes in server registration
5. Extract web harness turn client
6. Extract web turn view model
7. Make gameStore the canonical frontend state owner
8. Move App.tsx back to UI composition
9. Remove unused Web-side single Agent API client and core-state helper

Recommended next:
1. Add stronger Killer information-boundary regression tests
2. Optionally extract plotGuidance or dynamicClues from harnessTurn.ts
```

每一步完成后至少运行：

```txt
npm run test -w @murder-loop-ai/server
npm run test -w @murder-loop-ai/game-core
npm run typecheck
```

如果某一步只改文档，可以用 `git diff --check` 作为最低验证。

## 8. 当前架构原则

后续开发应遵守：

- 正式游戏回合只走 `/api/harness/turn`。
- `game-core` 决定规则事实，server 只做 AI/HTTP 适配。
- `ContextBuilder` 是 Agent 上下文边界入口。
- Killer prompt payload 只能来自 `KillerContext`。
- Narrator 可以表达规则结果，但不能制造规则结果。
- World Info 是设定上下文，不是裁判。
- Trace 可以记录 World Info 摘要，但普通玩家 UI 不应默认展示 World Info 正文。
