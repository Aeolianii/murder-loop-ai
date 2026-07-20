# AI-first 迁移阶段六实施记录

> 状态：退出旧硬编码主路径的代码完成，默认关闭；真实 API 放量门禁尚未执行  
> 日期：2026-07-20  
> 依据：`docs/ai-first-world-model-arbiter-handoff.md`

## 本阶段结果

阶段六开启后，正式玩家回合不再预执行或依赖旧 Parser、StoryNode、World Tick、Killer Rule、NPC、Narrator 和 Recommendation 链：

```text
Semantic Compiler
  → Main World Model + Specialists 并行候选
  → Arbiter + capability / invariant / high-risk gate
  → 阶段三玩家 State + 阶段五已确认下游事件
  → 阶段四 Knowledge / Observation / Clue 投影
  → Atomic Turn Commit
  → 从 Confirmed Events 构建只读展示
```

提交前不再运行旧 Killer 或 Narrator 再丢弃结果。正式回合的 State、Death、Ending、Knowledge、Clue 和玩家可见结果只来自已确认事件。

## StoryNode 退出方式

`resolveTurnHarness` 已移除玩家动作前的 StoryNode 短路，玩家动作会进入正常规则阶段。原行为只保留在明确命名的 `resolveLegacyTurnHarness` 回滚适配器中。

固定剧情不再是可执行状态分支。以下内容已改成只投影给 Main World Model 的 `CanonicalStoryMaterial`：

- 23:47 交接失败后的阶段目标；
- 403 收据；
- 林越撤回消息；
- 假便利店来电。

每份 Material 只描述阶段目标、资格条件、允许领域和禁止声明；它不能直接写 State、增加 Threat、生成 Clue 或短路玩家动作。Specialist 不接收这些完整剧情材料，避免跨领域知识串线。

低电量、假警察过度知情和猫眼盲区不再进入正式 Material 清单。这些通用情形由资源状态、Knowledge 边界、Observation、capability 和 invariant 表达，不再复制成正式剧情分支。旧定义仅为关闭阶段六后的版本回滚保留。

## Parser 与 fallback 边界

阶段六正式链只接受 Semantic Compiler 的结构化 `TurnBrief`。中文关键词 Parser 不再拥有正式链权限。

只有 Semantic Compiler 不可用，并且已启动的 Main / Specialist 候选调用也全部没有可用 Schema 结果时，才把本次失败归类为 `ai_unavailable`。此时进入 `resolveMinimumPlayableTurn`：

- 不解释玩家自然语言；
- 不执行玩家动作；
- 不推进时间、威胁、Clue、门窗、包裹或角色状态；
- Killer 保持，NPC 不回复，Recommendation 为空；
- 只增加一条“AI 服务不可用，本次动作未应用”的系统记录。

若 AI 有返回但需要澄清，接口返回 422；若 Schema / Arbiter / 权限 / 正式接管门禁不通过，接口返回 503。两者都不会切回旧关键词或 StoryNode 链，也不会发布候选 State 或剧情文本。

## 启用与回滚

默认配置：

```dotenv
AI_LEGACY_MAIN_PATH_EXIT_ENABLED=false
```

设置 `AI_LEGACY_MAIN_PATH_EXIT_ENABLED=true` 会自动依赖并启用阶段二至阶段五的同一主链能力：

- Shadow Run 与 Semantic Compiler；
- 低风险玩家动作接管；
- Knowledge / Observation / Clue 接管；
- 高风险结果接管。

成功响应的 `coordination.legacyMainPathExit` 会记录：

- `status=committed`；
- `storyNodeAuthority=material_only`；
- `keywordFallbackAuthority=disabled`；
- `minimumPlayableFallback=ai_unavailable_only`。

关闭阶段六开关并重启 Server 即恢复阶段五稳定路径：`/api/harness/turn` 重新使用阶段三至五的兼容预计算，legacy API 继续使用 `resolveLegacyTurnHarness`。Shadow 数据、Trace 和回归测试不会删除。

## 代码入口

- `packages/game-core/src/storyMaterial/canonicalStoryMaterial.ts`
- `packages/game-core/src/takeover/minimumPlayableFallback.ts`
- `packages/game-core/src/intent/IntentProjector.ts`
- `packages/game-core/src/shadow/shadowRunner.ts`
- `packages/game-core/src/loop/resolveTurn.ts`
- `apps/server/src/takeover/lowRiskTakeoverService.ts`
- `apps/server/src/takeover/confirmedAiFirstResolution.ts`
- `apps/server/src/routes/harnessTurn.ts`
- `apps/server/src/env.ts`

## 回归覆盖

- 阶段六成功回合对旧 Parser、Killer、Action Narrator、Ambient Narrator 的调用次数均为 0；
- StoryNode 只能在显式 legacy rollback 适配器中短路，正式 `resolveTurnHarness` 会执行玩家动作；
- Canonical Story Material 只投影给 Main World Model；
- 阶段六开关自动启用高风险、Knowledge / Clue 和低风险接管；
- AI 完全不可用时只进入零解释、零世界推进的最低可玩模式；
- Arbiter 不干净时拒绝提交，不能偷偷回退旧链；
- Atomic Commit 冲突或失败仍保持零 State、零事件、零展示；
- 原 StoryNode、完整回合、真实剧情场景和循环重置回归继续通过。

## 验证与放量状态

本阶段完成前运行：

```text
npm run test -w @murder-loop-ai/ai-contracts
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
npm run typecheck
npm run build
```

“代码迁移完成”仍不等于“生产默认开启”。在把阶段六开关默认打开前，仍需使用真实 Provider API 完成剧情金标、错误率、玩家可见 P95、循环重置和开关回滚演练。任何错误 Death / Ending、无来源 Clue、未送达 Knowledge 或旧链执行都应立即关闭阶段六开关。
