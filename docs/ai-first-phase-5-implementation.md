# AI-first 迁移阶段五实施记录

> 状态：高风险结果正式接管代码完成，默认关闭；真实 API 金标与放量门禁尚未通过  
> 日期：2026-07-20  
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 本阶段结果

阶段五在阶段三/四的同一事务边界内接管 Killer、NPC 和 Environment 候选产生的高风险结果：

```text
Semantic Compiler + 并行 Proposal / Specialist Candidate
  → Shadow Arbiter 选择各领域候选
  → High-Risk Gate 检查完整因果链和独立确定性证据
  → 本地权限、能力、位置、屏障、伤害与结局规则复核
  → 丢弃旧 World / Killer / NPC / Narrator 对候选 State 的高风险写入
  → 确定性 Reducer 从阶段三已确认的玩家 State 回放已批准事件
  → 阶段四 Knowledge / Observation / Clue 投影
  → Atomic Turn Commit
  → committed 后只发布本地生成的确认文本
```

旧 Harness 的 World / Killer / Narrator 链在阶段六删除前仍会做兼容预计算，但阶段五开启且提交成功时，它不再拥有 State、Death、Ending、推荐、NPC 回复或高风险展示文本的正式写权限。

## 双门槛

非可逆事件必须同时满足：

1. `causalParentIds` 指向当前批次中已经批准并实际应用的上游事件；
2. `evidenceRefs` 至少包含一个来自当前 State、Fact Ledger、Capability 或本地 invariant 的独立证据。

上游 AI 事件只能证明因果链，不能兼任独立证据。引用无关的兄弟事件会被拒绝；只引用父事件会被延后。任何本地能力复核失败都会把原 `pass` 改成 `reject`，并阻断全部下游结果。

## 正式接管范围

确定性 Reducer 当前支持：

- Killer 移动、强入尝试、门/窗路线与屏障复核；
- 攻击尝试、命中、受伤、失能和死亡因果链；
- 林越等 NPC 的永久受伤、失能或死亡；
- 真警察在同位置且警方已到场时的永久逮捕；
- 陈怀民逃离；
- 包裹关键证据销毁，以及隐藏位置和外部备份复核；
- Death / Ending，并校验结局类型、原因和终止原因一致；
- 23:47 deadline 事件及其保守结局。

强入不能越过门链、路障或锁住的窗；攻击者与目标必须同位置；死亡必须来自已确认的致命伤；逃生不能由“玩家已经死亡”或错误的结局原因支撑；隐藏证据只有在 Killer 知道准确位置时才能销毁；物理包裹被毁不会抹掉已经存在的照片或外部备份。

阶段五仍复用阶段三的玩家动作白名单，因此玩家主动攻击、主动逃跑等尚未接管的高风险玩家命令仍会回退旧路径。阶段五开启后，阶段三不再因临近 23:47、警方状态或电量归零边界而回退；这些下游结果改由阶段五裁决。

## 权限与事件清洗

选中 Proposal 仍须满足本地领域权限：

- Killer proposal 的 `actorId` 必须是 `chen_huaimin`；
- NPC proposal 只能写自己的动作或永久状态；`real_police` 可写警方介入和逮捕；
- Environment proposal 只能写 deadline 及其 Ending；
- 未授权事件记录 `proposal_actor_not_authorized`，不能进入 Reducer 或 Atomic Commit。

正式 Confirmed Event 不保留 AI 任意附加的 facts、summary 或 display 文本。Reducer 只保留事件类型允许的结构化 facts，并重新生成确定性 summary 与 DisplayFragment。被拒绝、延后或未授权事件的 State、facts 和文本均为零发布。

## 启用与回滚

默认配置：

```dotenv
AI_LOW_RISK_TAKEOVER_ENABLED=false
AI_KNOWLEDGE_CLUE_TAKEOVER_ENABLED=false
AI_HIGH_RISK_TAKEOVER_ENABLED=false
```

设置 `AI_HIGH_RISK_TAKEOVER_ENABLED=true` 会自动启用阶段二 Shadow wave、阶段三低风险玩家接管和阶段四 Knowledge / Clue 接管，无需同时打开前两个正式接管开关。

关闭该开关并重启 Server 即回滚阶段五正式接管。阶段二 Shadow 报告和全部审计测试保留。

成功响应的 `coordination.highRiskTakeover` 记录：

- accepted / corrected / deferred / rejected 事件数；
- `pass/defer/reject` 决策数；
- 每个高风险事件的 `riskClass`、`evidenceRefs`、decision 和 reason codes；
- `narratorHighRiskAuthority=disabled`；
- `legacyHighRiskAuthority=disabled`。

任一错误 Death、Ending、NPC/Killer 永久状态或证据销毁进入正式 State 时，应立即关闭阶段五开关。

## 代码入口

- `packages/game-core/src/takeover/highRiskTakeover.ts`
- `packages/game-core/src/shadow/shadowArbiter.ts`
- `packages/game-core/src/takeover/lowRiskTakeover.ts`
- `packages/game-core/src/facts/knowledgeProjection.ts`
- `apps/server/src/takeover/lowRiskTakeoverService.ts`
- `apps/server/src/routes/harnessTurn.ts`
- `apps/server/src/ai/shadowAiAdapters.ts`
- `apps/server/src/env.ts`

## 回归覆盖

- 父事件不能充当独立确定性证据；
- 无关兄弟事件不能充当因果证据；
- 同回合刚加固的门会把强入改判为受阻；
- 旧链 Death、Ending、伤害、证据销毁和文本不会残留；
- 完整进入、攻击、致命伤、死亡、Ending 链可以提交；
- 死亡不能支撑逃生 Ending；
- 假门阻挡、死者攻击、攻击目标串换和越权 NPC 控制会被拒绝；
- 隐藏位置未知时不能销毁证据；
- Confirmed Event 会移除 AI 夹带 facts；
- Narrator 不能在提交后补写 Fatal / Ending；
- Atomic Commit 冲突或失败时保持零 State、零事件、零展示。

## 验证与放量状态

本地完成前运行：

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
npm run build
```

本阶段“代码完成”不等于“生产放量完成”。仍需用真实 API 高风险金标证明误判为 0，并验证玩家可见 P95、错误率和回滚演练后，才能把 `AI_HIGH_RISK_TAKEOVER_ENABLED` 默认打开。
