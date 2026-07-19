# AI-first 迁移阶段二实施记录

> 状态：Shadow Run 代码实施完成，默认关闭；尚未通过阶段三接管门禁
> 日期：2026-07-20
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 本阶段结果

阶段二已接入只读影子链路。正式回合仍由现有 `resolveTurnHarness()` 的 Parser → Rule → Killer → Narrator 管线裁决和写入状态；Shadow Run 不等待、不覆盖、不补写正式结果。

启用后，一个有输入的正式回合会同时启动：

```text
Semantic Compiler
  → Main World Model + 7 个 Specialist 共用 hard deadline 并行生成
  → Shadow Arbiter 四层来源裁决
  → Shadow High-Risk Gate
  → Atomic Turn Commit 纯模拟
  → 内存报告仓库
```

7 个 Specialist 为 Player、Killer、林越 NPC、Police Dispatch NPC、Environment、Clue 和 Recommendation。第二波的 Main 与全部 Specialist 在等待任一结果前全部启动，并共享同一个 `AbortSignal` 和绝对 `deadlineAt`。

## 关键边界

- Semantic Compiler 只读取玩家原文和紧凑 `PlayerContext`，输出经严格 Schema、信封和动作图校验的 `TurnBrief`。
- Compiler 超时、异常或 Schema 失败时不串行重试：只有 Main World Model 收到受控原文回退；Specialist 继续运行，但只能读取回合开始时的最小权限事实投影和空条件候选。
- Compiler 明确返回 `clarification_required` 时停止第二波，并记录 `compiler_unavailable` 报告，避免绕过澄清重新解释高影响歧义。
- Main 合法候选优先；只在对应领域缺失或非法时尝试同领域 Specialist；两者都不可用才记录本地 fallback。
- Arbiter 校验信封、契约版本、来源领域、Actor/领域 Fact 权限、Observation/Effect 引用、Clue 可见 Fact、Recommendation 可见事件和 Display 原子引用。
- 高风险事件必须具备完整且已放行的因果父链和确定性证据。父事件被 `defer/reject` 时，子事件不能独立通过。
- 模拟提交只计算 `committed/conflict/failed`、版本冲突、deadline 和旧循环失效，不调用正式状态存储。
- 报告完成或失败都在后台处理；正式 HTTP 响应不会等待 Shadow Promise。

## 代码入口

核心 Shadow 实现：

- `packages/game-core/src/shadow/shadowRunner.ts`
- `packages/game-core/src/shadow/shadowArbiter.ts`
- `packages/game-core/src/intent/turnBriefValidator.ts`

Server 接线：

- `apps/server/src/ai/shadowAiAdapters.ts`
- `apps/server/src/shadow/shadowCoordinator.ts`
- `apps/server/src/shadow/shadowReportStore.ts`
- `apps/server/src/routes/shadowReports.ts`
- `apps/server/src/routes/harnessTurn.ts`

对应测试已加入各 workspace 的 `npm test` 脚本，覆盖真并行、共享取消、hard deadline、Compiler 降级隔离、四层替代、权限泄漏、高风险因果链、模拟冲突、旧循环迟到、报告淘汰和 HTTP 非阻塞。

## 启用与回滚

默认配置不会产生新增 AI 调用：

```dotenv
AI_SHADOW_RUN_ENABLED=false
AI_SHADOW_DEADLINE_MS=6000
AI_SHADOW_COMPILER_TIMEOUT_MS=1000
```

只在需要采集阶段二数据的环境设为 `AI_SHADOW_RUN_ENABLED=true`。关闭开关并重启 Server 即完成阶段二运行时回滚，正式状态链路无需切换。

启用后每个有输入的回合最多新增 9 次 AI 调用：1 次 Compiler，以及并行第二波的 1 个 Main + 7 个 Specialist。所有安装和运行仍使用仓库现有依赖，不新增系统软件。

## 报告与回放

调试接口：

```text
GET /api/debug/shadow-runs
GET /api/debug/shadow-runs/:turnId
```

列表只返回摘要，详情包含可回放数据：信封、Semantic 记录、`TurnBrief`、Main/Specialist 候选、各调用状态和延迟、Arbiter 结果、旧 Parser `ActionPlan`、旧路径事件、模拟提交 freshness 快照及完成时间。

每份完成报告包括：

- Semantic Compiler 与旧 Parser 的动作数、操作、目标和约束差异；
- Shadow/旧路径事件差异，事件事实也参与等价比较；
- Schema 成功率、权限泄漏数、Specialist 替代率、fallback 率；
- 高风险 `pass/defer/reject`；
- Compiler、第二波和超时调用延迟；
- 模拟提交状态、冲突原因和旧循环失效原因。

报告仓库当前为进程内存、最多保留 50 条，Server 重启后清空。它用于阶段二调试与基线采集，不是正式审计存储。

## 阶段门禁

本次完成的是阶段二代码和可观测性接入，不代表已经获准进入阶段三。以下证据仍需在启用 Shadow 的真实 API 回归和金标集上采集：

- Arbiter 差异报告可回放、可解释；
- 被拒绝事件在 State、Knowledge、Clue、Recommendation 和 Display 中残留为 0；
- 未授权 Knowledge 泄漏为 0；
- 无法解释的新旧结果分歧不超过 5%；
- Compiler P50/P95、Schema 成功率、fallback 率和第二波尾延迟满足预算。

在上述门禁有新鲜证据前，阶段三低风险状态接管保持关闭。

## 验证命令

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
npm run build
```
