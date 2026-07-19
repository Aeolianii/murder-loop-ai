# AI-first 迁移阶段三实施记录

> 状态：低风险状态接管代码实施完成，默认关闭；真实 API 金标与玩家可见 P95 门禁尚未通过
> 日期：2026-07-20
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 本阶段结果

阶段三为 `/api/harness/turn` 增加了默认关闭的低风险接管路径。只有 Semantic Compiler、并行候选和 Shadow Arbiter 全部满足本阶段门禁时，确定性低风险 Reducer 才会替代旧 `RuleAgent` 的玩家动作结算；World、Killer、Narrator、Recommendation 和收尾链仍复用现有 Harness。

```text
Semantic Compiler + 并行候选
  → Shadow Arbiter 选中完整、可逆的 player proposal
  → 低风险白名单与高风险边界检查
  → 确定性低风险 Reducer 计算候选玩家 State 与可逆事件
  → 现有 World / Killer / Narrator 链从候选玩家 State 继续
  → Atomic Turn Commit
  → commitStatus=committed 后才发布 State 与故事文本
```

不满足接管条件的回合继续完整执行旧 `resolveTurnHarness()`，不会混合两套玩家 Reducer。

## 正式接管范围

本阶段只允许以下状态变化：

- 对房间和可见既有物体的外部观察；
- 拾取普通物品，以及使用充电器或胶带；
- 对可见物体拍照；
- 向林越、警方接线员或陈怀民发送消息；
- 反锁、扣门链，以及使用房间内真实存在的物体堵门；
- 确定性推进时间和手机电量。

以下边界仍未接管：

- `Knowledge`、`Clue`、`evidencePhase` 与 Narrator 动态线索写入；
- Killer 决策与 Killer 永久状态；
- NPC 永久状态；
- Threat、Police 高风险推进；
- Death、Ending、证据销毁和其他不可逆结果。

因此，拍摄包裹只更新物理 `photographed` 标记，不创建线索或证据阶段；消息送达只创建 `message_delivered` 事件，不写 NPC/Killer Knowledge。只有送达事件存在时才运行 NPC observer。

## 接管门禁

一个回合必须同时满足：

1. Shadow wave 完成，Semantic Compiler 状态为 `compiled`；
2. 信封与 `TurnBrief` 的 `loopId`、`turnId`、`inputStateVersion` 一致；
3. Arbiter 不要求修复或澄清，player domain 未 fallback；
4. Arbiter 选中的 player proposal 覆盖全部 `orderedActions`；
5. 选中 proposal 及其事件全部为 `reversible`；
6. 全部动作属于阶段三白名单，Actor、目标、观察范围和既有物品均合法；
7. 回合不会跨入仍由旧规则负责的高风险边界。

高风险边界包括电量将在本回合归零、进入 23:47 前最后十分钟、已有警方状态、已有 Ending/Combat，以及未联系林越时其永久状态将升级。命中这些边界时直接回退完整旧链，不在阶段三复制 Death、Ending 或 NPC 规则。

包裹内部观察、条件动作、需要澄清的输入、攻击、虚构堵门物体和混合高风险动作同样不接管。

## 原子提交与零展示

低风险 Reducer 先生成未提交的候选 State、可逆 `ProposedEvent` 和 `DisplayFragment`。Harness 的叙事与推荐可以基于候选结果预计算，但 HTTP 层在 Atomic Turn Commit 完成前不会发布它们。

- `committed`：返回 200，发布提交后的 `coreState` 和故事文本；
- `conflict`：返回 409，不包含 `coreState` 或 `storyLog`；
- `failed`：返回 503，不包含 `coreState` 或 `storyLog`。

阶段三成功路径还会禁用旧 Narrator → dynamic clue 反向写入，保证提交后的 State 不再被响应组装阶段修改。

当前 Hackathon 架构仍由客户端携带 `coreState`，没有引入生产级分布式状态仓库。Atomic Store 是可注入的单回合边界；冲突、持久化失败和零展示由确定性测试覆盖。多用户服务端版本控制仍属于后续复杂度升级项。

## 启用、观测与回滚

默认配置：

```dotenv
AI_LOW_RISK_TAKEOVER_ENABLED=false
AI_SHADOW_DEADLINE_MS=6000
AI_SHADOW_COMPILER_TIMEOUT_MS=1000
```

设置 `AI_LOW_RISK_TAKEOVER_ENABLED=true` 后，Server 会自动启动阶段二 Shadow wave，无需同时打开只读采集开关。关闭该开关并重启 Server 即回滚正式接管；阶段二报告、测试和诊断代码保留。

正式响应的 `coordination.lowRiskTakeover` 记录：

- `status`：`committed | bypassed | conflict | failed`；
- `reason`：回退、冲突或失败原因；
- `turnId` 与 `sourceProposalId`；
- `outputStateVersion` 与确认事件数量；
- `durationMs`：Shadow 等待、接续链和提交的玩家可见接管耗时。

真实流量中若错误率相对旧链上升，或玩家可见 P95 相对基线恶化超过 20%，应立即关闭开关。当前只完成代码和本地回归，尚未以真实 API 金标与负载数据证明该放量门禁。

## 代码入口

核心 Reducer 与提交：

- `packages/game-core/src/takeover/lowRiskTakeover.ts`
- `packages/game-core/src/commit/atomicTurnCommit.ts`

Harness 接续点：

- `packages/game-core/src/loop/resolveTurn.ts`
- `packages/game-core/src/events/HarnessDispatcher.ts`

Server 门禁与正式路由：

- `apps/server/src/takeover/lowRiskTakeoverService.ts`
- `apps/server/src/routes/harnessTurn.ts`
- `apps/server/src/env.ts`

## 回归覆盖

- 包裹外部观察不会打开包裹或创建线索；
- 拍照、普通物品、门锁/门链、时间和电量确定性更新；
- 通信不写 Knowledge，未送达消息不触发 NPC；
- Killer 从已加固门状态继续行动，备用钥匙不能越过门链或路障；
- 非白名单动作、内部观察、虚构物体和高风险边界回退旧链；
- 版本冲突和持久化失败均为零事件、零 State、零展示；
- 正式 HTTP 冲突/失败响应不包含 `coreState` 和 `storyLog`；
- 功能开关默认关闭，接管耗时进入协调元数据。

## 验证命令

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
npm run build
```
