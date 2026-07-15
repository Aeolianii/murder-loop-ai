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
  -> fetch('/api/harness/turn')
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
```

## 2. 当前主流程

```txt
apps/web
  -> POST /api/harness/turn
  -> apps/server/src/routes/harnessTurn.ts
  -> createAiHarness()
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
  -> server presenter payload
  -> apps/web renders story, clues, sidebar, audio cue, trace/debug info
```

这条链路是当前应该优先维护的主线。后续功能、测试和重构应默认围绕它展开。

## 3. Monorepo 模块职责

### apps/web

职责：

- 展示剧情文本、线索、侧边栏、音效和过场动画。
- 收集玩家自然语言输入。
- 调用 `/api/harness/turn`。
- 保存前端展示状态和 `coreState`。

当前注意点：

- `App.tsx` 直接维护主要 UI 状态并直接请求 `/api/harness/turn`。
- `src/store/gameStore.ts` 也存在 Zustand 状态和 harness 请求逻辑，但当前主界面没有统一使用它。
- `src/api/aiClient.ts` 仍保留旧单 Agent API client，主要应视为 legacy/debug 辅助。

### apps/server

职责：

- 提供 Fastify HTTP API。
- 适配 AI provider 和 role 配置。
- 构造 Parser / Killer / Narrator / Director / NPC 的 AI adapter。
- 调用 `game-core` 的 harness 管线。
- 将 `game-core` 返回的状态转换为前端需要的 payload。

当前注意点：

- `routes/harnessTurn.ts` 是正式主路由，但文件较胖，混合了 route、AI adapter、plot guidance、状态兼容、动态线索、audio cue、sidebar 和前端 payload 转换。
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

### Debug / Legacy 接口

```txt
POST /api/parse-action
POST /api/killer-strategy
POST /api/narrate
POST /api/narrate-action
POST /api/narrate-ambient
POST /api/npc-reply
POST /api/score-run
POST /api/frontend/resolve-action
```

这些接口可以暂时保留用于调试、回归测试或兼容旧路径，但后续新增正式玩法时不应默认接入这些接口。

## 5. 当前主要臃肿点

### 5.1 `harnessTurn.ts` 职责过多

当前 `apps/server/src/routes/harnessTurn.ts` 同时承担：

- Fastify route。
- AI harness adapter factory。
- Parser / Killer / Narrator / Director prompt 调用。
- plot guidance 异步缓存。
- 旧状态和旧线索兼容。
- 动态线索提取。
- audio cue 选择。
- sidebar payload 构建。
- frontend response presenter。
- trace / coordination 汇总。

建议后续优先拆分，但每次只移动一类纯函数，避免一次性大改。

### 5.2 前端状态双轨

当前存在：

```txt
apps/web/src/App.tsx
apps/web/src/store/gameStore.ts
```

两者都包含对游戏状态或 `/api/harness/turn` 的处理。后续需要选择一个正式状态入口。

建议方向：

```txt
App.tsx -> UI composition only
gameStore.ts -> game state, submitAction, rewind, reset, lastDebug
```

### 5.3 旧 API 与新 harness 并存

旧单 Agent API 仍然注册在 server index 中。它们短期可以用于 debug，但长期需要明确是否：

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
1. Extract frontend presenter helpers from harnessTurn.ts
2. Extract game state coercion helpers from harnessTurn.ts
3. Extract AI harness adapter factory from harnessTurn.ts
4. Mark legacy/debug routes in docs and server registration
5. Centralize web harness requests in one frontend state layer
6. Add stronger Killer information-boundary regression tests
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

