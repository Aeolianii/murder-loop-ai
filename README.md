# murder-loop-ai

`murder-loop-ai` 是一款多 AI 协作驱动的悬疑时间循环互动小说游戏。玩家通过自然语言输入行动，规则系统维护世界事实，多个受约束的 AI Agent 分别负责行动解析、凶手反制、叙事表达、导演一致性检查和 UI 适配。

核心原则：

```txt
玩家和 AI 共同创作故事，
但规则系统拥有最终解释权。
```

当前版本：`v1.8`

## v1.8 更新摘要

本版本完成核心回合架构收口。项目正式采用“**Harness 编排 + 确定性规则内核 + World/NPC 投影 + 叙事渲染**”：AI 负责理解、策略和表达，所有业务事实都必须经过 `Command -> DomainEvent -> State` 的确定性写入链路。

正式回合流程：

```txt
玩家自然语言输入
  -> Harness 调用 Parser，产出结构化 Command
  -> 规则内核裁决 Command，产出 confirmed DomainEvent
  -> reducer 单一写入 GameState
  -> confirmed events 更新 World/NPC 投影与 NPC 受影响队列
  -> World Tick 推进 NPC 计划和环境事件
  -> Killer 只读取自身可见投影，产出 KillerStrategy
  -> 规则内核将 KillerStrategy 转成 DomainEvent 并写入 State
  -> Narrator 通过事件游标读取尚未叙述的 confirmed facts
  -> UI/Sidebar 展示最终状态、线索、时间、威胁和推荐行动
  -> Director 在主回合外异步执行一致性审查
```

核心变化：

- 明确区分 `Command`、`DomainEvent` 和 Agent `Artifact`：Command 表示意图，DomainEvent 表示已确认事实，Artifact 只用于 Agent 之间传递结果。
- 玩家 Command 和 KillerStrategy 都通过 DomainEvent 进入规则内核，业务状态不再由 Parser、Killer、Narrator 或旧 action switch 直接写入。
- 建立单一状态写入通道，同一个 Command 只裁决一次，再由 reducer 应用事件，避免 GameState 与 WorldState 双写漂移。
- World/NPC 只读取 confirmed events；NPC 受影响队列会精确触发相关角色重新规划，并在消费后清空。
- Killer 只消费自身可见投影，无法读取玩家私密行动、其他 NPC 私有知识或完整 `GameState`。
- World Tick 升级为默认产品能力；测试和受控运行仍可显式关闭。
- Narrator 使用单调事件游标消费 `world.events`：只暴露 `player/public` 事件，隐藏事件只推进游标，不会泄露或在后续回合重放。
- Director 从同步裁决者降级为异步 Critic，不再阻塞玩家回合，也不具备修改规则事实的权限。

## v1.7 更新摘要

本版本引入了 Behavior Network / World State 状态机壳，用来承接“玩家动作 → 世界输入 → 世界 tick → 叙事上下文”的新链路。旧 `GameState` 仍然是主规则状态，状态机目前以薄同步层方式运行：它会写入 `state.world`，为叙事和后台日志提供结构化世界事件，但不会反写旧主状态。

核心变化：

- 新增 `GameState ↔ WorldState` 薄同步层，回合结束时会持久化 `state.world`，并保留旧规则系统的权威性。
- 新增“玩家动作 → World 输入”桥接层：拍照、发给林越、报警、锁门等动作会映射成 World Event。
- harness 支持可选 `advanceWorldTick` 阶段：玩家输入进入 World 后，可以让 World 自主推进一次 tick。
- API response 暴露 `worldTickTrace`，后台日志或调试工具可以直接看到本回合 World 自主推进产生的事件。
- 叙事层开始只读消费 World Event / World Info，上下文里会明示 confirmed world events，避免 AI 靠猜测补事实。
- 普通回合也会生成 `recommendedActions`，例如门外低声暴露“进不去”时，会提示玩家录音、套话、补充给警方或通知林越。
- 修复若干状态一致性问题：只反锁门不会被叙事写成椅子堵门；警察未到场时，林越不会提前声称真警察已经在门外或停车场。

### 状态机模式如何启用

前端右上角的心电/脉冲图标是 World Tick 开关：

- 灰色/未启用：只执行玩家动作到 World 输入同步，不推进 World 自主 tick。
- 绿色/启用：每次玩家提交动作后，请求体会携带 `debug.advanceWorldTick: true`，后端在玩家动作之后推进一次 World tick。

后端接口也可以直接启用：

```http
POST /api/harness/turn
Content-Type: application/json

{
  "input": "我不靠近门缝，打开录音，把门外那句进不去录下来",
  "state": { "...": "当前 GameState" },
  "debug": {
    "advanceWorldTick": true
  }
}
```

返回值中重点看：

```ts
{
  coreState: {
    world: WorldState
  },
  worldTickTrace: WorldEvent[]
}
```

开发调试建议：正式游玩可以先打开状态机开关；如果叙事和状态不匹配，优先查看后台返回的 `worldTickTrace`、`coreState.world.events` 和本回合 `turn.plan`，判断问题出在动作解析、World 输入桥接、World tick，还是 Narration 对事实的表达。

## v1.6 更新摘要

本版本接入规则化 StoryNode 线索节点，让关键悬疑信息不再依赖 AI 即兴生成，而是由规则系统稳定投放：

- 新增 StoryNode 短路流程：Parser 仍然执行；命中节点后跳过 Killer / Narrator / Director 主流程，直接返回固定剧情文本、线索、状态变化和下一步建议。
- 接入 7 个剧情线索节点：`battery_critical`、`room_403_receipt`、`linyue_retracted_message`、`peephole_blind_spot`、`fake_store_call`、`false_police_overknows`、`handoff_failed_2347`。
- 前端新增“下一步建议”展示，玩家获得线索后能看到安全、留证、核验、报警或充电等推荐行动。
- 重做林越线：林越不是知情人，而是误判后想保护女主的行动者。玩家追问并劝阻后，林越会留在安全位置协助报警和备份证据；如果玩家忽略撤回消息，林越会独自上楼并进入危险。
- 手机电量成为生死资源：低电量节点会优先提示寻找房间内充电器；充电后电量逐步恢复，电量耗尽会进入 `phone_battery_depleted` 死亡结局。
- 23:47 与评分闭环完成：林越协助报警可作为外部协助条件，`handoff_failed_2347`、403 收据和假警察细节会进入真相/证据评分。

补充架构清理：

- Web 状态仓库中将 `lastDebug` 收紧命名为 `lastTurnDebug`，明确它保存的是最近一次回合请求的响应或错误。
- Web 回合请求队列从 `enqueueTurn` 改名为 `enqueueHarnessRequest`，避免和游戏回合解析概念混用。
- StoryNode 与线索 ID 已拆分命名：剧情节点统一使用 `story_` 前缀，例如 `story_battery_critical`；线索仍保留 `battery_critical` 这样的业务 ID。
- `StoryNodeResolution.nodeId` 改为 `storyNodeId`，并新增测试防止剧情节点 ID 和线索 ID 再次复用同一个字符串。

## v1.5 更新摘要

本版本重点优化手机竖屏体验，让小屏设备也能稳定游玩：

- 移动端主界面改为固定一屏高度：顶部时间栏、底部行动输入框固定，中间正文区域独立滚动，避免 iPhone SE 等小屏设备看不到对话框。
- 压缩手机端 Header、故事区、输入区和情报面板间距，减少 UI 覆盖和无效留白。
- 手机情报面板改为全屏抽屉，并隐藏前端 Agent 耗时面板；耗时数据仍保留在后端/接口链路，方便开发者继续优化。
- 线索弹窗适配手机竖屏，图片优先完整展示，说明文字允许换行，避免被裁切。
- 开场系统提示替换为更沉浸的叙事文案：`你睁开眼，雨声又一次落在窗外。`

## v1.4 更新摘要

本版本将结局系统简化为三种主结局，并把细分原因统一沉淀到 `endingReason`：

- `death`：玩家死亡。
- `escaped_no_evidence`：玩家逃脱，但证据链不足，无法揭示房东罪行。
- `escaped_with_evidence`：玩家逃脱且证据链成立，房东可被绳之以法。

具体触发原因不再作为主结局 ID 分散在系统里，而是记录为 `endingReason`，例如 `deadline_murder`、`forced_entry`、`police_arrived_with_evidence`、`killer_dead_no_evidence`。规则层新增 `packages/game-core/src/rules/endingRules.ts`，集中处理定罪证据判断和结局写入，避免前端、服务端和 AI 契约各自维护一套旧结局枚举。

证据链现在统一判断为“包裹照片 + 至少一种外部留存或可信通道”，外部留存包括林越收到照片、手机录音、证据备份、警方核验或真警抵达。Narrator 仍然可以表达规则结果，但不能自造结局；服务端和 AI 契约现在只接受三种主结局。

## v1.3 更新摘要

本版本重点完成前端状态统一、旧前端双轨清理，以及动态线索一致性修复。

### 前端状态统一

- `App.tsx` 已退回 UI 组合层，只保留过场动画、线索弹窗、移动侧栏和音效触发等临时 UI 状态。
- `apps/web/src/store/gameStore.ts` 成为 Web 侧正式状态入口，负责 `frontendState`、`submitAction`、`rewind`、`reset` 和 `lastDebug`。
- 新增 `apps/web/src/turnViewModel.ts`，集中处理前端回合状态转换：开始提交、合并 harness 回包、请求失败、死亡后回溯。
- 删除 Web 侧旧单 Agent API client，前端不再直接调用 `/api/parse-action`、`/api/killer-strategy`、`/api/narrate*` 或 `/api/npc-reply`。
- `apps/web/src/api/harnessTurnClient.ts` 只保留正式主入口 `postHarnessTurn()`。

当前前端主链路：

```txt
App.tsx
  -> gameStore.ts
  -> turnViewModel.ts
  -> harnessTurnClient.ts
  -> POST /api/harness/turn
```

### 动态线索修复

- 修复同一回合内“门缝/门底/门外纸条”生成重复线索的问题。
- 当一条纸条线索已经展示内容时，会丢弃“尚未展开/尚未查看”的矛盾版本。
- 如果先生成未查看版本，后续又生成带内容版本，会保留带内容版本。
- 新增回归测试，覆盖“同一纸条既显示内容又显示未打开”的矛盾场景。

### 架构文档同步

- 更新 `docs/architecture-current.md`，记录当前真实主链路和模块职责。
- 明确正式游戏回合只走 `/api/harness/turn`。
- 明确服务端旧单 Agent 路由仅作为 debug 路径，不再是正式前端流程。

## v1.2 基础能力

`v1.2` 已完成 AI Agent 架构收口、World Info Lite、结构化上下文和凶手信息边界修复：

- 统一到 harness 架构。
- 引入 Agent Contract 与 Agent Trace。
- 新增 ContextBuilder，控制 Parser / Killer / Narrator / Director 的可见上下文。
- Killer 不再读取完整 `GameState`、完整 `playerResult` 或玩家私密行动。
- World Info Lite 接入 Killer / Narrator / Director，但只作为设定上下文，不作为规则裁判。
- 修复“玩家看到药片后，门外人直接知道药片内容”的信息泄露问题。

## 游戏设定

故事发生在青荷公寓 503 室。主角沈知夏误收了一个装有毒品的包裹，包裹原本属于房东陈怀民控制的地下转运链。第一轮中，她没有意识到危险，在 23:47 被杀。死亡后，她带着模糊记忆回到 23:00，需要通过调查、取证、拖延、核实身份和保护外部联系，逐步理解包裹、房东、林越、假警察和 23:47 的意义。

玩家目标不只是活下来，还包括：

- 保留包裹、照片、录音等证据；
- 保护林越和无辜 NPC；
- 识别假警察与陈怀民的谎言；
- 理解 23:47 与毒品包裹转运的真相；
- 让警方获得可信证据，而不是被嫁祸或误导。

## 当前架构

```txt
murder-loop-ai/
├─ apps/
│  ├─ web/       React + Vite 前端
│  └─ server/    Fastify API + AI provider adapter
├─ packages/
│  ├─ game-core/     规则、回合管线、Agent 调度、fallback
│  ├─ ai-contracts/  Agent 输入输出 schema
│  ├─ content/       故事设定、线索、World Info Lite
│  └─ shared/        跨包共享类型、时间、音频数据
└─ docs/
   ├─ architecture-current.md
   ├─ design-document.md
   └─ world-info-lite-card-review.md
```

正式回合链路：

```txt
apps/web
  -> apps/web/src/store/gameStore.ts
  -> apps/web/src/api/harnessTurnClient.ts
  -> POST /api/harness/turn
  -> apps/server/src/routes/harnessTurn.ts
  -> apps/server/src/ai/harnessAiAdapters.ts
  -> packages/game-core/resolveTurnHarness()
       -> Parser Command
       -> Rule DomainEvents -> GameState
       -> World/NPC projections + World Tick
       -> Killer visible projection -> KillerStrategy -> DomainEvents
       -> Narrator confirmed facts + world event cursor
       -> deferred Director Critic
  -> apps/server/src/presenters/frontendTurnPresenter.ts
  -> apps/web renders story, clues, sidebar, audio cue
```

## 运行方式

安装依赖：

```bash
npm install
```

启动前端和后端：

```bash
npm run dev
```

默认地址：

```txt
前端: http://127.0.0.1:5178/
后端: http://127.0.0.1:8788/
健康检查: http://127.0.0.1:8788/health
```

如果 `5178` 被占用，Vite 会自动切到下一个端口。

## 常用验证

```bash
npm run typecheck
npm run build -w @murder-loop-ai/web
npm run test -w @murder-loop-ai/server
npm run test -w @murder-loop-ai/game-core
```

Web 侧轻量测试：

```bash
npx tsx apps/web/src/store/gameStore.test.ts
npx tsx apps/web/src/turnViewModel.test.ts
npx tsx apps/web/src/frontendState.test.ts
npx tsx apps/web/src/clueRevealState.test.ts
```

最低提交前检查：

```bash
git diff --check
```

## AI 配置

服务端通过环境变量读取 AI provider 配置。没有有效 key 时，核心流程仍可通过 fallback 逻辑运行，但 AI 质量会下降。

常见配置示例：

```env
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
```

具体 role 配置和 prompt 逻辑见：

```txt
apps/server/src/ai/
packages/game-core/src/context/ContextBuilder.ts
packages/content/src/worldInfo.ts
```

## 当前状态

项目处于可运行 Web 原型阶段，已经具备：

- 自然语言输入；
- harness 回合主链路；
- 本地规则裁判；
- 凶手有限信息反制；
- 叙事 AI 小说化输出；
- World Info Lite；
- Agent Trace；
- 结构化循环记忆；
- 前端暗色悬疑 UI；
- 线索、侧边栏、音效和过场动画。

仍在继续完善：

- 更完整的结局触发系统；
- 更通用的动态线索一致性层；
- 更强的 Killer 长期策略；
- 更丰富的证据链和评分复盘；
- 更完整的户型图、关键分镜和氛围资产。

## 重要原则

- 正式游戏回合只走 `/api/harness/turn`。
- `game-core` 决定规则事实，server 只做 HTTP / AI 适配。
- Killer 只能通过 `KillerContext` 消费可见信息。
- Narrator 可以表达规则结果，但不能制造规则结果。
- World Info 是设定上下文，不是规则裁判。
- 普通玩家 UI 不默认展示 World Info 正文。
