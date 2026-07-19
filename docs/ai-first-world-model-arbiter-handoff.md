# AI-first World Model + State Arbiter 架构交接

> - 状态：目标架构，尚未完整实现
> - 用途：交给新对话继续设计、拆分计划并实施重构
> - 当前实现入口：参见 `docs/architecture-current.md`

## 1. 背景与问题定义

当前项目的很多剧情 Bug 并不是某一个 fallback 分支写错，而是系统同时存在多套事实权威：

- Parser AI 和中文关键词 fallback 都在解释玩家意图；
- StoryNode 可以在玩家动作执行前短路整个回合；
- Killer Agent 的策略只验证 JSON 结构，缺少语义前置条件审核；
- Narrator 文本可能反向成为动态线索来源；
- 固定线索模板可能写入玩家没有实际观察到的内容；
- 推荐行动可能依据未确认事实或与安全边界冲突；
- 多个 Agent 串行调用会让一次玩家输入等待数分钟。

典型实测问题包括：

1. 玩家在 23:00 只检查包裹，Killer Agent 却选择备用钥匙强入，规则层直接确认，玩家在 23:02 死亡。
2. 玩家输入“反锁、扣门链、用行李箱堵门”，行动叙事却编造拆包裹和三行数字纸条，并将虚构纸条写入线索栏和推荐行动。
3. 玩家明确“只拍外包装、不翻内部”，固定剧情节点只播放林越撤回消息，吞掉拍照动作，没有更新照片、电量和相关 State。
4. fallback 将“不打开门，隔门询问”误判为“冲出房门”。

这些问题不能靠继续增加关键词、StoryNode 分支或固定文案彻底解决。每迎合一种输入方式，就可能破坏另一种表达。

## 2. 已确认的架构方向

采用 **B+C 自适应架构**：

- **Fast Semantic Compiler** 先把玩家自然语言编译成轻量、稳定的共享 `TurnBrief`；
- **World Model / Turn Agent** 根据 `TurnBrief` 负责完整的首选整回合提案；
- **Player / Killer / NPC / Environment / Clue / Recommendation Specialist** 每回合全部并行运行，提供权限隔离的领域候选和原子显示片段；
- **State Arbiter** 负责通用权限、可见性、能力、因果和一致性裁决；
- **Reducer** 只根据 Confirmed Events 生成新 State；
- 玩家可见关键路径由“短 Semantic Compiler 等待 + 主 World Model 与全部 Specialist 的一次并行等待”组成；
- Arbiter 按“接受主提案 → 局部裁剪 → Specialist 替代 → 本地 fallback”的四层顺序处理，不因小错误重做整回合；
- 主 World Model 是创造性首选，Specialist 是领域热备；本地规则决定物理事实，不在合法候选之间投票；
- Director / Critic 异步运行，不阻塞玩家。

这里的“以 AI API 返回为准”是指：

- 玩家语义、角色决策、环境推进、线索提案和显示内容以 AI 为主要生成来源；
- 不再用中文关键词 fallback 试图覆盖所有表达；
- 但 AI 返回的是 **Proposal**，不能直接修改 State；
- State 只有在 Proposal 通过通用世界约束后才能更新。

## 3. 三层事实权威

### 3.1 Canonical Truth：不可变世界真相

Canonical Truth 定义这个故事中不能被 AI 改写的内容，例如：

- 主角、NPC 身份和人物关系；
- 包裹的真实来源；
- 林越不知道幕后真相；
- 陈怀民和赵鸿远的关系；
- 公寓空间结构和已有物品；
- 23:47 在主线中的意义；
- 当前版本允许存在的 Ending 类型。

AI 可以决定这些真相通过什么现象、在什么节奏下逐步暴露，但不能改写真相。

### 3.2 AI Turn Proposal：本回合智能候选

Semantic Compiler 先根据玩家原文和 `PlayerContext` 生成共享 `TurnBrief`。主 World Model 再根据 `TurnBrief`、Canonical Truth 摘要、当前 State 和权限事实集合提出完整首选回合；各 Specialist 根据最小权限投影并行提出领域候选：

- 玩家动作及动作范围；
- 明确的否定条件和动作顺序；
- Killer、NPC 和环境反应；
- 时间、电量、位置、物品和威胁变化；
- 玩家可能观察到的事实；
- 候选线索；
- 推荐行动；
- 与候选事件绑定的显示文本。

主 Turn Proposal 和 Specialist Candidate 都不是正式事实。

### 3.3 Confirmed State：正式游戏事实

State Arbiter 将合法提案转换为 Confirmed Events，Reducer 再据此生成新 State。

Narrator、Clue、Recommender、Sidebar 和下一回合 Context 都只能把 Confirmed Events / Confirmed State 当作事实来源。

## 4. 目标回合主链路

```mermaid
flowchart LR
    Input["玩家输入"]
    Context["Context Builder<br/>State → 权限事实集合"]
    Canon["Canonical Truth"] --> Context
    State["当前 State"] --> Context

    Input --> Semantic["Fast Semantic Compiler<br/>短结构化调用"]
    Context -->|PlayerContext| Semantic
    Semantic --> Brief["共享 TurnBrief<br/>动作、顺序、否定、范围、Action IDs"]
    Brief --> Projector["Intent Projector<br/>本地最小权限投影"]
    Context --> Projector

    Projector --> Turn["Main World Model<br/>完整首选 Turn Proposal"]
    Projector --> Specialists["全部 Specialist 每回合并行<br/>Player / Killer / NPC / Environment / Clue / Recommendation"]
    Turn --> Proposal["Primary Proposal"]
    Specialists --> Candidates["领域候选池<br/>ranked candidates + display fragments"]

    Proposal --> Arbiter["State Arbiter<br/>四层本地裁决"]
    Candidates --> Arbiter
    Arbiter --> Confirmed["Confirmed Events"]
    Confirmed --> UI["立即展示已确认文本"]
    Confirmed --> Reducer["Reducer"]
    Reducer --> NextState["新 State + 新 stateVersion"]

    Confirmed -.异步.-> Critic["Director / Critic<br/>只审查，不阻塞"]
```

普通回合存在两个 AI 波次：先等待极短的 Semantic Compiler，再等待主 World Model 与全部 Specialist 的并行结果。Context Builder、Intent Projector、Arbiter 和 Reducer 都是本地过程。第二波耗时取决于最慢的必要返回，而不是所有 Agent 延迟之和。

## 5. Context Builder、Semantic Compiler 与共享 Turn Brief

### 5.1 Context Builder 的职责

Context Builder **不是 Agent，也不解析玩家自然语言**。

它只负责把固定格式的 State 转换成权限明确的 Fact 集合：

```text
Fact:
  id
  subject
  predicate
  value
  sourceEventId
  visibleTo
  knownBy
  validFromTurn
  invalidatedBy
```

示例：

```text
fact.front_door.chain_locked
  value: true
  sourceEventId: event.player.secured_door
  visibleTo: [player]
  knownBy: [player]

fact.linyue.received_package_photo
  value: true
  sourceEventId: event.message.delivered.to_linyue
  visibleTo: [player, linyue]
  knownBy: [player, linyue]

fact.killer.knows_photo_shared
  value: false
  visibleTo: [system]
  knownBy: [system]
```

同一个 State 会生成不同权限投影：

- `PlayerContext`：玩家可见物品、已知线索、记忆、消息和可感知环境；
- `KillerContext`：Killer Knowledge、可观察公共事件和自身历史行动；
- `NpcContext`：每个 NPC 实际收到的内容和自身知识；
- `WorldModelContext`：完整世界结构及带 `knownBy` / `visibleTo` 标签的事实。

玩家长句由 Semantic Compiler 解析。Context Builder 不读取“先”“不要”“只”“然后”等中文关键词。

Context 选择优先依据当前状态，而非玩家文字匹配：

- 玩家当前位置和相邻空间；
- 当前可见实体和持有物；
- 活跃通信对象；
- 最近 Confirmed Events；
- 未解决威胁和行动；
- 仍有效的关键线索；
- 当前剧情阶段摘要；
- 远端实体的轻量索引。

### 5.2 Semantic Compiler 的职责

Semantic Compiler 和本地投影相邻，但职责不同：

- Context Builder 回答“这个角色现在有权知道什么”；
- Semantic Compiler 回答“玩家这句话究竟想做什么”；
- Intent Projector 回答“每个并行 Agent 可以收到 `TurnBrief` 的哪一部分”；
- Arbiter 回答“候选行动在当前世界中实际产生什么结果”。

Semantic Compiler 只读取玩家原文和紧凑 `PlayerContext`，负责：

- 拆分原子动作；
- 保留动作顺序和依赖；
- 提取否定条件、限定范围和明确禁止的动作；
- 解析指代、通信对象、候选附件和玩家希望的可见范围；
- 为动作和候选产物分配稳定 ID；
- 在影响状态的歧义无法安全缩小时请求玩家澄清。

它不负责 Killer / NPC 决策、动作成功与否、精确时间和电量、Observation、Clue、Recommendation、叙事、State Patch、Death 或 Ending。

### 5.3 共享 Turn Brief 契约

`TurnBrief` 是所有第二波 Agent 的共享语义锚点，但不等于正式事实：

```text
TurnBrief:
  turnId
  inputStateVersion
  compilerVersion
  utteranceMode
  resolvedReferences
  orderedActions
  globalConstraints
  scopedConstraints
  communications
  candidateHandles
  ambiguities
```

每个 `orderedAction` 至少包含稳定 `actionId`、`actorId`、`operation`、`targetIds`、`scope`、`method`、`dependsOnActionIds`、候选输入输出句柄和对应的玩家原文范围。

候选句柄只描述依赖关系。例如 `candidate.photo.action_1` 只有在拍照事件被确认后才能成为正式实体。`stealthIntent`、`intendedAudience` 和 `desiredOutcome` 也只表达玩家意图，不能直接成为实际可见性或世界结果。

### 5.4 本地 Intent Projection

Semantic Compiler 返回后，本地 Intent Projector 根据 Context 和权限规则生成不同输入：

- 主 World Model：完整 `TurnBrief`、带权限标签的世界 Facts 和必要 Canonical Constraints；
- Player Specialist：完整玩家意图、PlayerContext、当前可访问实体和能力；
- Killer Specialist：只接收 KillerContext 与带前置条件的可观察信号候选，不接收玩家原文、完整 `TurnBrief` 或 PlayerContext；
- NPC Specialist：只接收自己的 NpcContext，以及以 `message_delivered` 为前置条件、明确发给自己的候选通信；
- Environment Specialist：只接收公共状态、环境能力和允许响应的事件锚点；
- Clue / Recommendation Specialist：只接收带 Observation / visible event 前置条件的候选锚点。

并行 Agent 可以对尚未确认的事件生成条件候选，但不能把条件候选当作已知事实。条件不成立时，对应候选、Knowledge、Clue、Recommendation 和显示文本一起失效。

### 5.5 Semantic Compiler 轻量化与失败策略

Semantic Compiler 位于所有第二波 API 的前置关键路径，必须作为延迟敏感型组件设计：

- 使用短 Prompt、严格 Schema、非思考模式和受控输出长度；
- 只发送玩家原文、紧凑 PlayerContext、当前实体别名索引和最近指代候选；
- 不注入 Canonical Truth、Killer / NPC Knowledge、完整剧情历史或长篇 World Info；
- 在上一回合 Reducer 提交后预热下一回合 PlayerContext 和实体索引；
- 静态系统 Prompt、操作枚举和 Schema 尽量使用缓存；
- 关键路径不自动串行重试。Compiler 失败时，主 World Model 直接接收原文降级处理，Specialist 只使用回合开始时已有的权限事实和保守条件候选。

建议以真实 API 回归确定模型，并把 Compiler 的 P95 延迟控制在主 World Model P95 的 10%～20% 内；若主模型通常需要数秒，Compiler 的工程目标应尽量接近或低于 1 秒。速度不能以丢失“只”“不要”“如果”“先……再……”为代价。

## 6. World Model / Turn Agent

主 World Model 接收共享 `TurnBrief` 和完整但带权限标签的 WorldModelContext，生成整回合的完整首选 Proposal。它仍然负责整体连贯性、跨领域因果图和首选显示内容，但不再独自承担玩家语义解析，也不是唯一的候选来源。

它需要正确处理：

- 忠实消费 `TurnBrief` 中已经确定的动作、顺序、否定、范围和指代；
- 各 Actor 的知识边界；
- 候选状态变化和因果依赖。

示例输入：

> 我先不开门，只拍包裹外面的收件标记，把照片发给林越并提醒他不要上楼，然后反锁、扣门链，再打开手机录音。

Semantic Compiler 需要先在 `TurnBrief` 中保留：

```text
orderedActions:
  1. photograph(package, scope=exterior.label)
  2. send_message(linyue, attachment=action_1.photo)
  3. secure(front_door, effects=[lock, chain_lock])
  4. record(phone)

globalConstraints:
  - must_not_open_door
  - must_not_open_package
```

World Model 不直接返回任意 State Patch，只能提出结构化事件和效果。

### 6.1 每回合全面并行的 Specialist

共享 `TurnBrief` 通过本地权限投影后，所有已配置 Specialist 每回合与主 World Model 同时运行：

- Player Specialist：玩家动作、候选效果和 Observation；
- Killer Specialist：只基于 KillerContext 的 2～3 个排序策略候选；
- NPC Specialist：只基于各自 NpcContext 的回复和行动候选；
- Environment Specialist：独立环境推进候选；
- Clue Specialist：只依赖候选 Observation IDs 的线索；
- Recommendation Specialist：只依赖候选玩家可见事件的建议。

每个 Specialist 都应为自己的候选携带原子 `displayFragments`，从而在主提案的对应领域失效时仍能优先使用 Agent 文本，而不是立即降级为生硬的本地文案。

并行 Specialist 看不到尚未返回的主 Proposal，因此它们不是当前回合的 Reviewer。它们的职责是提供权限隔离、窄契约的领域热备候选。真正检查完整主输出的 Director / Critic 必须在结果返回后异步运行，不能伪装成同一波的并行审查。

合法的主 World Model 候选始终优先于 Specialist。Arbiter 不在多个合法创意之间投票；只有主提案的对应根行为非法、缺失或因裁剪而无法继续时，才按排名尝试相同领域的 Specialist 候选。

## 7. Turn Proposal 核心契约

每个提案至少需要携带：

```text
Proposal:
  id
  sourceAgent
  domain
  candidateRank
  turnBriefActionIds
  replacementFor
  actorId
  operation
  targetIds
  basedOnFactIds
  preconditions
  forbiddenScopes
  proposedEffects
  observations
  visibility
  confidence
  causalParentIds
  clueCandidates
  recommendations
  displayFragments
```

关键要求：

- Agent 之间不能通过自由叙事正文建立事实；
- 主 Proposal 和 Specialist Candidate 必须使用同一个 `turnId`、`inputStateVersion`、`compilerVersion` 和 Schema 版本；
- Specialist 只能在自己声明的 `domain` 中提出候选，不能顺带修改其他 Actor 或世界领域；
- Actor 的行动必须引用其有权读取的 `basedOnFactIds`；
- 结果必须能回溯到前置事件；
- 候选线索必须引用 Observation Event；
- 推荐行动必须引用玩家可见 Confirmed Event；
- 显示文本必须按原子事件拆分，并携带 `eventRefs` / `claimRefs`。

## 8. State Arbiter 规划

### 8.1 Arbiter 不做什么

Arbiter 不负责：

- 解析玩家中文；
- 决定剧情应该紧张还是平静；
- 选择 Killer 应该短信、敲门还是强入；
- 生成 NPC 台词；
- 生成线索内容；
- 文学化环境描写；
- 推荐下一步行动；
- 根据某个角色、钟点或具体句子写剧情分支。

### 8.2 Arbiter 只检查通用世界规律

#### 实体约束

- Actor、目标和物品必须存在；
- 物品必须处于可访问位置；
- 同一实体不能同时出现在冲突位置；
- 未声明实体不能凭空进入正式 State。

#### 能力约束

- Actor 或工具必须拥有对应 capability；
- 手机没电不能完成拍照或通信；
- 未打开或不可见区域不能被观察；
- 工具只能绕过其声明支持的障碍。

#### 知识约束

- `basedOnFactIds` 必须存在且未失效；
- 当前 Actor 必须拥有读取权限；
- 私密 Fact 不能成为 Killer / NPC 行动依据；
- 全局真相存在，不等于 Actor 已经知道。

#### 因果约束

- 每个结果必须引用导致它的事件；
- 上游事件被拒绝时，下游依赖事件自动失效；
- Death / Ending 必须能回溯到完整合法因果链。

#### 可见性约束

- Observation 必须声明感官、来源、距离和遮挡；
- 线索内容只能是实际观察字段的子集；
- 玩家不可见事件不能出现在玩家文本和推荐依据中。

#### 冲突约束

- 包裹未打开但观察到内部内容；
- 消息发送失败但 NPC Knowledge 已更新；
- 门链仍在但 Actor 已无阻碍进入；
- 未拾取物品但已经使用；
- 同一事务中 mutually exclusive 状态同时成立。

#### 不可逆结果约束

以下候选结果统一标记为 `irreversible`，需要更严格的来源和因果验证：

- 玩家或 NPC 死亡；
- Ending；
- 关键线索；
- 证据销毁；
- NPC 被捕、逃离或永久失能；
- 永久 Knowledge 更新。

### 8.3 组件能力组合，避免剧情 if/else

门不写成“23:02 时陈怀民不能用备用钥匙杀人”，而是声明组件：

```text
frontDoor.barriers = [lock, chain, barricade]
spareKey.canBypass = [lock]
spareKey.cannotBypass = [chain, barricade]
```

任何 Actor 使用任何钥匙尝试进入，都通过相同能力组合计算结果。

不接受这种规则：

```text
如果玩家说“不打开门”，就不要让陈怀民进入。
```

接受这种规则：

```text
actor_entered 只有在所有有效入口障碍被解除后才能确认。
```

每条 Arbiter 规则必须满足：

1. 不依赖某句自然语言；
2. 不依赖某个具体剧情角色；
3. 至少适用于一类世界实体、能力或状态关系。

### 8.4 Agent-first 四层裁决，不循环重生成

Arbiter 同时维护两套不同优先级：

```text
创造性来源优先级：Main World Model → 对应 Specialist → 本地 fallback
物理事实优先级：Canonical Truth / Capability / Knowledge / Causality → Confirmed Events
```

主模型和 Specialist 决定“谁想做什么、说什么、如何推进剧情”；本地规则决定“这个行动在当前世界中实际产生什么效果”。确定性规则结果不是本地剧情 fallback。

#### 第一层：接受主模型合法部分

逐个验证主 Proposal 的根行为、效果和依赖。合法的主候选直接成为 accepted event。即使 Specialist 提出了另一个同样合法的创意，Arbiter 也不覆盖主模型，不在短信、敲门或强入等合法选择之间投票。

#### 第二层：局部裁剪主模型非法部分

保留合法根行为和上游事件，只删除非法效果及其下游依赖；能够由通用组件规则唯一推出的失败或受阻结果写入 corrected event。

例如 Killer 合法尝试使用备用钥匙时，`lock` 可以被绕过，但仍有效的 `chain` 会确定性地产生 `entry_blocked_by_chain`。这不是生硬的本地剧情替代，而是世界能力组合的正式结果。对应显示优先使用主 Proposal 已提供的失败片段。

#### 第三层：对应 Specialist 替代

只有当主提案的某个领域根行为非法、缺失或裁剪后无法形成有效领域事件时，才读取该领域已经并行返回的 Specialist 候选。候选按 `candidateRank` 逐个通过相同 Arbiter 规则，第一个合法候选接管该领域；其他领域仍保留主 Proposal。

Specialist 候选必须自带因果引用、Clue / Recommendation 附件和原子显示片段。替代发生后只使用新候选引用的附件，不能保留被拒绝主事件的正文或线索。

#### 第四层：本地 fallback

只有主候选与相同领域的全部 Specialist 候选都不可用时，才进入最低可玩 fallback。Fallback 只保证回合可收束，例如 Killer 等待或撤退、NPC 暂未回复、环境保持已有状态、Clue 为空，并从 Confirmed Events 生成极短事实文案；它不承担复杂剧情创作。

Arbiter 输出：

```text
StateTransitionResult:
  acceptedEvents
  correctedEvents
  rejectedEffects
  violations
  selectedSourceByDomain
  specialistCandidatesTried
  fallbackDomains
  requiresRepair
  requiresPlayerClarification
  outputStateVersion
```

例如 AI 提出：

- 门已反锁；
- 行李箱堵门；
- 包裹里出现数字纸条；
- Killer 使用备用钥匙进入；
- 玩家死亡。

Arbiter 应：

- 接受反锁和堵门；
- 拒绝无 Observation 来源的数字纸条；
- 将成功进入裁决为进入尝试失败；
- 因因果链断裂而拒绝死亡；
- 如果主 Killer 根行为完全非法，则尝试已并行返回的 Killer Specialist 排序候选；
- 只有主候选和全部对应 Specialist 都失效时才使用本地 fallback；
- 不重新生成整个回合。

普通回合不自动重新生成。所有 Specialist 已在第二波并行运行，Arbiter 应先消耗现成候选池。对于无法合法确认的不可逆结果，默认拒绝或延后，而不是为了强行产生 Death / Ending 再跑完整回合。`requiresRepair` 只保留给“主响应整体不可解析、候选池全部失效且最低 fallback 仍无法安全收束”的极端情况；即使启用也只能局部修复一次，不重新解析玩家动作。

## 9. Reducer 与异步提交

Reducer 只接受 Confirmed Events，不读取玩家自然语言和 AI 原始文本。

它负责：

- 更新门、窗、包裹、手机、位置和持有物；
- 结算时间、电量、威胁等资源；
- 更新 NPC / Killer Knowledge；
- 写入合法线索；
- 更新阶段和 Ending；
- 递增 `stateVersion`；
- 持久化 State。

State Arbiter 完成后，可以立即把已确认的显示文本发送给前端。Reducer、Fact Ledger、Knowledge Projection、存档和 Critic 在玩家阅读时完成。

每回合必须带版本：

```text
turnId
inputStateVersion
outputStateVersion
```

下一次玩家输入开始处理前，必须满足新 State 已提交，防止并发回合读取旧状态或旧响应覆盖新状态。

## 10. 显示文本与 Event 引用

原始 AI 流式文本不能在 Arbiter 裁决前直接展示。可以流式接收，但必须先在服务端缓冲。

主 World Model 和各 Specialist 都返回与自己候选事件绑定的原子化文本：

```text
displayFragments:
  - text: 门外传来钥匙插入锁芯的轻响。
    eventRefs: [event.key_inserted]

  - text: 门锁转开，门板向内移动。
    eventRefs: [event.door_unlocked, event.door_opened]

  - text: 那个人进入房间。
    eventRefs: [event.actor_entered]
```

若 Arbiter 只确认 `event.key_inserted`，则只展示第一段。被拒绝事件对应的文本、线索和推荐必须一起删除。

Narrator 文本永远不能作为 State 或 Clue 的事实来源。

## 11. Clue 与 Recommendation 边界

Clue Candidate 必须提供：

```text
claims
basedOnObservationIds
visibleFactIds
confidence
```

Arbiter 验证 `claims` 是 Observation 内容的子集。

只拍外包装时，可以生成标签、外观和破损信息，不能生成旧书、药盒或内部纸条。

Recommendation 必须引用最终玩家可见的 Confirmed Events，并满足：

- 不重复已经完成的动作；
- 不依据幕后身份；
- 不把 NPC 建议当作事实；
- 不推荐当前状态下不可执行或明显危险的行为；
- 依据事件被拒绝时，对应建议一起删除。

## 12. Agent 调用与延迟预算

逻辑 Agent 不等于独立串行 API 调用。

### 玩家可见关键路径

```text
上一回合阅读期间：预热 PlayerContext / Entity Alias Index（本地）
→ Fast Semantic Compiler（第一波，短结构化调用）
→ TurnBrief Validator + Intent Projector（本地）
→ Main World Model + 全部 Specialist（第二波，全面并行）
→ 四层 State Arbiter（本地）
→ 立即展示已确认文本
→ Reducer / Context / Persist / Critic（阅读期间并行）
```

总等待近似为：

```text
T_turn ≈ T_semantic_compiler
       + max(T_main_world_model, T_player, T_killer, T_npc, T_environment, T_clue, T_recommendation)
       + T_local_arbiter
```

因此 Semantic Compiler 必须显著快于主模型；第二波 Agent 必须真正并发启动，不能按角色串行等待。预算允许所有 Specialist 每回合运行，但某个热备 Specialist 超时不能成为新的单点阻塞：统一截止时间到达后，已完成候选进入候选池，未完成领域视为缺少 Specialist 热备，再按四层策略处理。

主 World Model 返回完整首选 Proposal；Specialist 返回窄领域排序候选而不是对主结果的同步审查。全量并行的目标是用职责隔离降低知识串线，并提前准备 Agent fallback，避免 Arbiter 拒绝后再发起串行重生成。

### 高风险结果

Death / Ending、关键线索、永久 Knowledge、Killer 强入、NPC 永久状态和证据销毁仍执行更严格的来源和因果验证，但不再临时启动额外 Specialist，因为所有 Specialist 已经每回合并行运行。

主高风险候选被拒绝后，依次局部裁剪、尝试对应 Specialist、最后使用保守本地 fallback。默认不为强行产生不可逆结果增加第三波 AI 调用。

### 异步任务

不阻塞玩家：

- Director / Critic；
- 回合摘要；
- Agent Trace 整理；
- 详细 Sidebar；
- 音效选择；
- 下一回合 Context 预热；
- Prompt 质量指标记录。

## 13. 迁移计划

避免一次性推倒现有主链路，采用影子运行和逐步接管。

### 阶段 1：契约与事实层

- 定义 `Fact`、`TurnBrief`、`Proposal`、`SpecialistCandidate`、`ConfirmedEvent`、`StateTransitionResult`；
- 建立 Fact Ledger；
- 建立 Player / Killer / NPC Knowledge Projection；
- 定义 Semantic Compiler、TurnBrief Validator 和 Intent Projector 的边界；
- 为 Proposal 增加 `sourceAgent`、`domain`、`candidateRank`、`replacementFor` 和版本字段；
- 保持现有流程不变。

### 阶段 2：Semantic Compiler 与并行候选 Shadow Run

- Semantic Compiler 生成 `TurnBrief`，与现有 Parser 结果对照但暂不接管；
- 主 World Model 和全部 Specialist 根据相同 `TurnBrief` 的权限投影并行生成候选；
- Shadow Arbiter 读取现有回合结果、主 Proposal 和 Specialist 候选；
- 输出“如果由 Arbiter 裁决会接受/拒绝什么”；
- 暂不影响正式 State；
- 收集语义误判、权限泄露、候选替代率、fallback 率和延迟数据。

### 阶段 3：接管低风险状态

- 观察范围；
- 普通物品；
- 拍照；
- 通信；
- 门锁和门链；
- 时间和电量。

### 阶段 4：接管 Knowledge 与 Clue

- 所有 Knowledge 更新必须来自 Confirmed Event；
- 所有 Clue 必须引用 Observation；
- 禁止 Narrator 正文反向生成动态线索。

### 阶段 5：接管高风险结果

- Killer 行动；
- 强入和攻击；
- NPC 永久状态；
- Death / Ending；
- 关键证据销毁。

### 阶段 6：退出旧硬编码主路径

- 移除 StoryNode 对玩家动作的短路；
- 将固定剧情节点降级为 Canonical Story Material / 阶段目标；
- 将中文关键词 fallback 退出正式 AI 主链路；
- fallback 只保留为 AI 服务完全不可用时的最低可玩模式；
- 删除已经由通用 capability / invariant 覆盖的剧情分支。

## 14. 测试策略

重构必须先补失败测试，再写实现。

测试重点不是穷举中文句子，而是验证结构化世界性质：

- Semantic Compiler 必须保留动作顺序、“只”“不要”“如果”等范围和否定条件；
- 相同 `TurnBrief` 的改写输入应生成等价的动作图和约束；
- Killer Specialist 永远不能收到玩家原文、完整 `TurnBrief` 或 PlayerContext；
- NPC Specialist 只能把满足 `message_delivered` 前置条件的候选消息当作可用输入；
- 合法主候选必须优先于同样合法的 Specialist 候选；
- 主领域失效时只允许相同领域 Specialist 接管；
- 本地 fallback 只能在主候选和全部对应 Specialist 均失效后触发；
- 任意 Actor 在门链未解除时都不能确认进入；
- 任意外包装 Observation 都不能获得内部字段；
- 私密 Fact 永远不能成为 Killer 的合法行动依据；
- 删除必要 Fact 后，所有依赖提案必须失败；
- 被拒绝事件不能留下 State、Clue、Recommendation 或显示文本；
- 消息未送达时 NPC Knowledge 不得更新；
- 任意 Ending 都必须能回溯到合法因果链；
- 无关 Fact 的增加不应改变裁决结果；
- 独立事件交换顺序后最终 State 应保持一致；
- 相同结构化 Proposal 不应因玩家原句改写而改变裁决。

应增加：

- Semantic Compiler Schema / 指代 / 复合动作回归；
- Intent Projection 权限快照测试；
- 主模型与所有 Specialist 真并发的延迟测试；
- 四层 Arbiter 来源优先级和替代测试；
- 属性测试；
- 状态组合生成测试；
- 越权 Proposal 对抗测试；
- Knowledge Projection 泄露测试；
- 并发 `stateVersion` 测试；
- 真实 AI 端到端剧情回归；
- Arbiter Shadow 结果与正式结果对照指标。

## 15. 可观测性与调优指标

每回合记录：

- 原始输入对应的 `TurnBrief`、Compiler 版本和歧义；
- Main / Specialist 使用的权限投影摘要；
- Agent Proposal；
- Proposal 使用的 Fact IDs；
- Arbiter accepted / corrected / rejected 结果；
- 每个领域最终选择的 `sourceAgent`、尝试过的 Specialist 候选和 fallback 原因；
- 拒绝原因和因果链；
- Prompt 版本；
- State 输入输出版本；
- Semantic Compiler、各并行 Agent、Arbiter 和 Reducer 的独立延迟；
- 虚构实体、知识越界、观察越界、线索无来源等分类指标。

重点监控：

- Agent Proposal 拒绝率；
- Semantic Compiler P50 / P95、Schema 失败率和降级率；
- 主 Proposal 各领域直接接受率；
- Specialist 接管率和本地 fallback 率；
- 最慢并行 Agent 及其尾延迟；
- 无有效事件回合率；
- Clue 拒绝率；
- Knowledge 越界率；
- 普通回合 AI 调用次数与并行完成率；
- 玩家可见首个确认结果时间。

## 16. 非目标

本次架构优化不以这些事情为目标：

- 用 Arbiter 编写完整剧情；
- 用更多硬编码让 fallback 理解所有自然语言；
- 让每个逻辑 Agent 都进行一次独立串行 API 调用；
- 把并行 Specialist 伪装成能够看到主 Proposal 的同步 Reviewer；
- 让 Arbiter 在多个合法创意之间投票或决定哪种剧情更精彩；
- 让 Killer / NPC Specialist 通过完整玩家原文或完整 State 获得未授权信息；
- 让 Critic 反复修改已确认 State；
- 用 Narrator 文本替代事件和状态；
- 一次性删除全部现有实现并重写。

## 17. 新对话接手建议

新对话开始后应：

1. 先阅读本文件和 `docs/architecture-current.md`；
2. 对照当前 `resolveTurnHarness()`、DomainEvent、ContextBuilder、KillerKnowledge 和动态线索路径；
3. 先写 `TurnBrief`、Semantic Compiler、Intent Projection、主 Proposal 和 Specialist Candidate 契约及失败测试计划，不直接大改实现；
4. 采用 Semantic Compiler / 全量并行候选 / Shadow Arbiter 影子运行，避免一次性替换正式状态管线；
5. 每完成一个迁移阶段都运行完整测试、类型检查和真实剧情回归；
6. 只有验证稳定后才删除旧路径。

建议新对话的首个任务：

> 基于 `docs/ai-first-world-model-arbiter-handoff.md` 和 `docs/architecture-current.md`，审计现有类型、DomainEvent、ContextBuilder 与 resolveTurnHarness 主链路，输出阶段 1 的详细实施计划：重点覆盖轻量 Semantic Compiler、共享 TurnBrief、本地 Intent Projection、主 World Model 与全量 Specialist 并行候选、四层 Arbiter，以及需要新增或修改的文件、失败测试、兼容策略和验证命令。先不要写实现代码。
