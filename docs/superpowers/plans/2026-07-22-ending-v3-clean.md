# 结局系统 v3.0 — 架构外挂实现计划

**目标:** 不改 takeover/legacy 管线，以纯函数模块 + post-commit hook 方式接入剧情系统

**架构:** 所有新模块是架构外挂——读 committed state，写独立字段，不碰管线内部

## 全局约束
- 不改 `.env`，不改管线代码（takeover/shadow/legacy）
- 新模块在 `game-core/src/` 下独立目录
- 新类型在 `shared/src/types.ts`
- 每次类型检查通过后提交

## 任务列表

### Task 1: 共享类型 — shared/types.ts + createInitialState.ts
- GameState 加 activatedKnowledge, currentRunKnowledge, discoveredClueIds
- 加 PlayerKnowledge, DeathPathResult, EndingTierResult, DeductionResult 等类型

### Task 2: 知识定义 — knowledge/knowledgeDefinitions.ts
- 10 条知识定义 + getActivatableKnowledge() + computeTruthLayer()

### Task 3: 知识激活引擎 — knowledge/playerKnowledge.ts
- activatePlayerKnowledge() + canAccuse() + getActivatedClueFragments()

### Task 4: 多维度评分器 — scoring/multiDimensionScorer.ts
- scoreEnding(): 5 维度 × 权重 → S/A/B/C/D

### Task 5: 死亡路径解析器 — death/deathPathResolver.ts
- resolveDeathPath() + shouldTriggerDeath()

### Task 6: 断案引擎 + 灵光 — deduction/deductionEngine.ts + epiphanyHints.ts
- buildDeductionPrompt() + validateDeductionClaims() + generateEpiphanyHint()

### Task 7: 跨循环持久化 — loopResetPolicy.ts + rewind.ts
- 保留 activatedKnowledge + discoveredClueIds

### Task 8: Post-commit 注入 — harnessTurn.ts
- 在 response assembly 前调用 activatePlayerKnowledge + resolveDeathPath

### Task 9: 断案拦截 — harnessTurn.ts
- 管道前检测 accusation → 直接返回结局/灵光

### Task 10: 导出 — index.ts
- 导出所有新模块
