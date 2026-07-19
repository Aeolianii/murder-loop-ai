# AI-first 迁移阶段一实施记录

> 状态：代码实施完成；阶段二实施见 `docs/ai-first-phase-2-implementation.md`
> 日期：2026-07-20
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 已完成范围

- 在 `packages/ai-contracts/src/world-model-contracts.ts` 定义并校验 `Fact`、`TurnEnvelope`、`TurnBrief`、`Proposal`、`SpecialistCandidate`、`StateTransitionResult`、`HighRiskDecision`、`TurnCommitResult` 和 `ConfirmedEvent`。
- Proposal 已包含 `loopId`、`turnId`、`inputStateVersion`、`deadlineAt`、`compilerVersion`、`schemaVersion`、`sourceAgent`、`domain`、`candidateRank`、`replacementFor`、`riskClass` 和 `evidenceRefs`。
- Semantic Compiler 输入只允许玩家原文和紧凑 `PlayerContext`；`TurnBrief` Validator 校验信封一致性、动作依赖顺序、候选句柄、约束和通信引用。
- 建立独立 `FactLedger`，支持来源事件、权限标签、事实失效和防止投影反向修改账本。
- 建立 Player、Killer、NPC 和 World Model Knowledge Projection；旧 `GameState` 通过显式 `legacy.snapshot.*` 来源桥接成 Fact，不伪装成新 Confirmed Event。
- 建立 Intent Projector 边界：主 World Model 与 Player Specialist 可读取完整 `TurnBrief`；Killer/NPC 只能读取授权事实和窄结构条件候选。
- 建立 Atomic Turn Commit 端口与内存实现，覆盖提交成功、版本冲突、持久化失败、deadline、旧循环、重复回合和未放行高风险事件。
- 建立声明式 Loop Reset Policy 与原子重置边界；新循环获得新 `loopId` 和起始 `stateVersion`，旧循环结果失效。

## 兼容策略

阶段一新增组件只从包入口导出，未接入 `resolveTurnHarness()`、`POST /api/harness/turn` 或 Web 状态管理。现有 Parser → Rule → Killer → Narrator 正式链路、状态持久化格式和玩家可见结果保持不变。

只有 `commitStatus=committed` 的提交结果才返回 Confirmed Events 与事件绑定显示片段；`conflict`、`failed`、超时、旧循环和高风险未放行结果均返回空事件与空展示。

## 验证与门禁

阶段一新增测试已加入对应 workspace 的测试脚本。最低验证命令：

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
```

阶段二 Shadow Run 已实现但默认关闭。交接文档要求的真实 Schema 成功率和金标集安全指标仍需在启用只读影子数据后采集；当前没有用缺失指标替代阶段门禁，也没有让新组件写正式 State。
