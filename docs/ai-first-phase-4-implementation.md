# AI-first 迁移阶段四实施记录

> 状态：Knowledge / Clue 正式接管代码完成，默认关闭；真实 API 金标与放量门禁尚未通过
> 日期：2026-07-20
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 本阶段结果

阶段四在阶段三低风险接管事务内加入了 Knowledge / Observation / Clue 投影：

```text
低风险 Reducer 产生候选事件
  → 基于事件 fact 生成 Knowledge / Observation / Clue 候选
  → 校验 Knowledge 的 sourceEventId 与 basedOnFactIds
  → 校验 Observation 的 sourceEventIds 与 visibleFactIds
  → 校验 Clue claims ⊆ Observation.visibleFactIds
  → 清除本回合旧链产生的 Knowledge / Clue 增量
  → 与事件和候选 State 一起 Atomic Turn Commit
  → committed 后才发布；conflict / failed 全部丢弃
```

本阶段没有把 Narrator 正文升级为事实来源。正式 Clue 候选只携带结构化 claim 和 Observation 引用；标题、详情、权重与持久性来自本地受控定义，AI 或 Narrator 不能注入线索正文。

## 正式接管范围

当前仅在阶段三已通过全部门禁的低风险回合中接管：

- 玩家检查包裹外标签后，写入带事件来源的玩家 Knowledge、外部 Observation 和 `wrong_package` Clue；
- 玩家拍摄包裹外包装后，写入带事件来源的玩家 Knowledge、外部照片 Observation 和 `package_photo` Clue；
- 消息确实产生 `message_delivered` 后，收件角色才获得 `player_message_received` Knowledge；
- `message_delivery_failed` 不产生任何 Knowledge 更新；
- 本回合旧 World/Killer/Narrator 链产生、但不在本次 Confirmed Event 批中的 Knowledge / Clue 增量会在提交前被清除；
- 阶段四成功路径继续禁止 `Narration.clue` 反向写入正式 State。

包裹外包装 Observation 只包含外部标签或外部照片 fact。它不能生成旧书、药盒、数字纸条或其他内部内容。阶段五的 Killer 行动、NPC 永久状态、Death、Ending、关键证据销毁和其他高风险结果仍未接管。

## 可审计来源

新增持久化字段：

- `GameState.observations[]`：保存 Observation、可见 fact、来源事件和观察时刻；
- `KnowledgeFact.sourceEventId`：保存导致 Knowledge 更新的 Confirmed Event；
- `ClueRecord.claims`、`basedOnObservationIds`、`sourceEventIds`：保存 Clue → Observation → Event 链。

为兼容旧存档，旧 `ClueRecord` 的来源字段和旧 `KnowledgeFact.sourceEventId` 在类型上仍可缺省。阶段四不会为没有真实事件的旧数据伪造来源，但从阶段四事务开始，所有新增正式 Knowledge / Clue 都必须通过来源校验。

循环重置时，NPC/Killer Knowledge 仍恢复 checkpoint；持久 Clue 及其引用的 Observation 一起保留，未被持久 Clue 引用的 Observation 被清除。

## Arbiter 加固

Shadow Arbiter 除了检查 Clue 是否引用已知 Observation，现在还检查每个 claim 是否精确匹配被引用 Observation 的 predicate。`availableObservationClaims` 为历史 Observation 提供可验证 claim 集；没有可验证内容的 Observation ID 不能单独授权任意 claim。

正式阶段四投影会再做一次独立确定性校验。Shadow 选中不等于正式生效，只有 Atomic Turn Commit 成功后才能称为 Confirmed Event / Knowledge / Observation / Clue。

## 启用、观测与回滚

默认配置：

```dotenv
AI_LOW_RISK_TAKEOVER_ENABLED=false
AI_KNOWLEDGE_CLUE_TAKEOVER_ENABLED=false
```

设置 `AI_KNOWLEDGE_CLUE_TAKEOVER_ENABLED=true` 会自动启动阶段二 Shadow wave 和阶段三低风险接管链，无需同时打开另外两个开关。关闭阶段四开关并重启 Server 即回滚 Knowledge / Clue 正式接管；阶段三仍可由自己的开关独立运行。

成功响应的 `coordination.knowledgeClueTakeover` 记录：

- `status=committed`；
- `observationCount`；
- `knowledgeUpdateCount`；
- `clueCount`；
- `narratorClueAuthority=disabled`。

若发现任一无 Observation 来源的新增 Clue、未送达消息导致 Knowledge 更新、或冲突/持久化失败后仍有投影残留，应立即关闭阶段四开关。当前只完成代码与本地回归，尚未以真实 API 金标证明“零无来源 Clue、零未送达 Knowledge”放量门禁。

## 代码入口

- `packages/game-core/src/takeover/knowledgeClueTakeover.ts`
- `packages/game-core/src/takeover/lowRiskTakeover.ts`
- `packages/game-core/src/shadow/shadowArbiter.ts`
- `apps/server/src/takeover/lowRiskTakeoverService.ts`
- `apps/server/src/routes/harnessTurn.ts`
- `apps/server/src/env.ts`

## 回归覆盖

- 未送达消息 Knowledge 零更新；
- 已送达消息的 Knowledge 带 `sourceEventId` 和已确认 fact；
- 无 Observation 来源的 Clue 被拒绝；
- 超出 Observation 内容的 claim 被拒绝；
- 外包装照片不会写入内部内容；
- Narrator 生成的动态线索不能进入阶段四正式 State；
- 旧链同回合产生的无来源 Knowledge / Clue 增量被清除；
- Atomic Commit 冲突时 Observation / Knowledge / Clue 零发布；
- 循环重置只保留持久 Clue 引用的 Observation。

## 验证命令

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
npm run build
```
