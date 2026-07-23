# 线索推理与结局评分关系设计

> 状态：设计基线（待实现）
>
> 适用分支：当前 `master`
>
> 目标：建立完整的“原始线索 → 推理结论 → 评分维度 → 主动结局”闭环，并标明当前实现不足。

## 一、设计结论

游戏应当把“发现了什么”和“由此知道了什么”拆成两个层次：

1. **原始线索（Clue）**：玩家实际看到、听到、拍到、收到或核实到的事实。
2. **推理结论（Insight / Knowledge）**：由两条或多条原始线索组合后得到的可陈述命题。
3. **世界状态（World State）**：玩家与关键角色是否存活、证据是否外传、警方是否到场、循环次数等不可选择的客观状态。

推荐的结局流程为：

```text
玩家收集原始线索
  → 组合 2～3 条线索
  → 解锁推理结论卡
  → 获得至少 3 条有效推理结论
  → 在线索栏主动“提交结案”
  → 选择 3 条核心推理结论作为本次论证主轴
  → scoreEnding() 使用全部已激活知识与当前世界状态评分
  → 播放 S / A / B / C / D 对应结局 CG
```

玩家选择的 3 条核心推理结论决定本次结案的叙事重点和 CG 内容，但不应成为唯一评分来源。`truthLayer` 应根据全部已激活知识计算，避免玩家因为只能选择三张卡而无法达到最高结局。

## 二、结局触发边界

### 2.1 自动触发

系统只自动触发当前循环的死亡：

- 环境危险值达到致死阈值；
- 游戏时间到达 23:47。

死亡结束当前循环，播放死亡 CG，然后进入下一轮。死亡属于 `LoopTermination`，不是最终 `GameEnding`。

### 2.2 玩家主动触发

非死亡结局必须由玩家在线索栏主动发起：

- 至少拥有 3 条 `truthLayerContribution > 0` 的推理结论；
- 玩家选择 3 条核心结论并提交；
- 系统根据全部已激活知识、证据链和世界状态调用 `scoreEnding()`；
- S 档正式结束故事；
- A～D 档播放对应 CG 后，允许玩家接受当前结果开启新循环，或回到提交结案前继续调查。

### 2.3 23:47 的事件顺序

当前关键线索 `handoff_failed_2347` 只能在 23:47 后出现，而新设计又要求 23:47 自动死亡。为避免该线索永久不可达，事件顺序必须固定为：

```text
到达 23:47
  → 先结算并展示“交接失败”事实
  → 将 handoff_failed_2347 写入跨循环线索
  → 再触发死亡
  → 下一轮保留该线索
```

不得先写入死亡状态再尝试生成交接线索。

## 三、评分维度

### 3.1 当前公式

```text
总分 = truthLayer × 0.35
     + evidenceStrength × 0.30
     + externalReach × 0.25
     + survivors × 0.15
     + cycleCost × 0.05
```

| 维度 | 数据来源 | 是否由玩家选择的三张卡直接决定 |
|---|---|---|
| `truthLayer` | 全部已激活推理结论 | 否，三张卡只决定本次论证重点 |
| `evidenceStrength` | 原始证据的来源、内容、归属和保全情况 | 部分相关 |
| `externalReach` | 证据是否到达林越、警方、媒体或其他可信节点 | 否，主要来自世界状态 |
| `survivors` | 玩家、林越等关键角色状态 | 否 |
| `cycleCost` | 当前循环次数 | 否 |

当前正向权重合计为 1.05，满维度时理论总分可达到 105。实现时应明确采用以下一种方式：

- 将最终分数限制在 0～100；
- 或重新归一化正向权重，使其合计为 1；
- 或明确允许 100 以上的内部得分，但 UI 只显示档位。

推荐限制在 0～100，避免评分说明与实际结果不一致。

### 3.2 结局档位

| 档位 | 总分 | 叙事落点 | 结局后行为 |
|---|---:|---|---|
| S | ≥90 | 证据链完整公开，赵鸿远与组织网络被摧毁 | 正式结束故事 |
| A | 70～89 | 关键证据进入调查，但赵鸿远脱身 | 接受结果或继续调查 |
| B | 50～69 | 陈怀民被处理，组织完成切割 | 接受结果或继续调查 |
| C | 30～49 | 玩家理解真相，但证据不足 | 接受结果或继续调查 |
| D | <30 | 玩家脱离循环，但 503 的真相没有公开 | 接受结果或继续调查 |

## 四、完整原始线索清单

当前 `clueBook` 共定义 20 个固定线索模板。下表同时记录其目标作用和当前可达性。

状态标记：

- **正式可达**：AI-first 正式链已有确定性投影支持；
- **旧链可达**：旧 Domain / StoryNode 路径可生成，但阶段六正式链不保证；
- **仅模板**：存在固定模板，但没有当前正式生成路径；
- **材料候选**：存在 Canonical Story Material，但材料本身没有写入线索的权限。

| 原始线索 ID | 显示名称 | 类型 | 目标作用 | 评分维度 | 当前状态 | 主要不足 |
|---|---|---|---|---|---|---|
| `wrong_package` | 标记模糊的包裹 | 主线事实 | 指向“包裹可能不属于 503” | truth | 正式可达 | 当前单独即可激活结论，证据强度不足；应与 403 地址证据组合 |
| `package_contents` | 包裹里的异常物品 | 实物证据 | 证明包裹不是普通快递 | evidence、truth | 正式可达 | 同时包含旧书、药板、数字纸条，粒度过粗，无法支撑精细推理 |
| `package_photo` | 包裹照片 | 保全证据 | 为证据外传提供起点 | evidence | 正式可达 | `clueBook` 表示内容照片，阶段四却表示仅外包装照片，语义冲突 |
| `linyue_has_photo` | 林越收到照片 | 外部留存 | 证明证据已离开现场 | evidence、external | 正式可达 | 只能证明林越收到，不等于可信官方渠道已经接收 |
| `door_scratch` | 锁芯划痕 | 现场痕迹 | 证明有人尝试进入 503 | truth、evidence | 旧链可达 | 不能单独证明陈怀民拥有钥匙或就是开锁者 |
| `recording_pressure` | 录音里的停顿 | 行为证据 | 证明门外的人会根据屋内动静调整行为 | evidence、external | 旧链可达 | 当前被计入 `externalReach`，但本地录音不等于证据已经外传 |
| `police_verified` | 核实出警 | 官方核验 | 区分真假警察，形成可信渠道 | truth、evidence、external | 旧链可达 | 当前可单独激活“假警察”，也被用于推导公安内线，跨度过大 |
| `unknown_number_probe` | 陌生号码试探包裹 | 通信痕迹 | 证明有人监控包裹状态 | truth | 旧链可达 | 单条短信不能直接锁定陈怀民，需要时间或身份关联 |
| `doorstep_package_claim` | 门外的人认领包裹 | 现场口供 | 将门外人物与包裹回收联系起来 | truth、evidence | 旧链可达 | 当前没有对应推理结论，只作为孤立线索存在 |
| `chen_body` | 陈怀民的尸体 | 战斗结果 | 作为搜查手机、钥匙的入口 | survivors、状态 | 仅模板 | 不应作为真相得分卡；应是解锁后续物证的状态事件 |
| `chen_keys` | 房东的备用钥匙 | 实物证据 | 证明陈怀民具有进入 503 的能力 | truth、evidence | 仅模板 | 当前没有正式链生成路径，也未与锁芯划痕组合 |
| `chen_phone_found` | 房东的手机 | 数字物证 | 打开上游、交易、1103 等组织线 | truth、evidence | 仅模板 | 内容过于宽泛；一个 ID 同时承担交易记录、上游联系人和身份映射 |
| `weapon_found` | 找到一件可用武器 | 生存资源 | 提供防身能力 | survivors、状态 | 旧链可达 | 不应进入主动结案的三张核心线索 |
| `battery_critical` | 手机快没电了 | 资源警告 | 提醒通讯与取证能力即将中断 | 状态 | 旧链可达 | 不是案件事实，不应贡献 `truthLayer` 或作为结案依据 |
| `linyue_retracted_message` | 林越撤回的消息 | 人物线索 | 暗示林越知道 403 或李汶涛相关信息 | truth | 旧链可达、材料候选 | 当前一条撤回消息就能激活“林越在调查李汶涛”，推理跳跃 |
| `false_police_overknows` | 假警察说漏的细节 | 行为证据 | 证明门外人物知道报警中未透露的信息 | truth、evidence | 旧链可达 | 单独只能形成强怀疑，仍需官方核验才能坐实身份 |
| `room_403_receipt` | 403 收据 | 地址物证 | 将包裹与 403、李汶涛线连接 | truth、evidence | 旧链可达、材料候选 | 当前单条收据同时激活林越调查和李汶涛死亡预感，跨度过大 |
| `peephole_blind_spot` | 猫眼盲区的人影 | 环境异常、红鲱鱼 | 制造“有人躲在门外”的怀疑 | threat | 旧链可达 | 当前会单独激活“林越是帮凶”，没有人物身份依据 |
| `fake_store_call` | 不存在的便利店来电 | 诱骗行为 | 证明有人试图引玩家离开房间 | truth、threat | 旧链可达、材料候选 | 当前没有推理结论承接，无法连接到组织或陈怀民 |
| `handoff_failed_2347` | 23:47 的交接失败 | 时间节点事实 | 证明 23:47 是交接或回收节点 | truth、evidence | 旧链可达、材料候选 | 与“23:47 自动死亡”冲突；当前还被单独用于多个深层结论 |

## 五、建议的推理结论关系表

### 5.1 L1：503 与陈怀民

| 推理结论 ID | 显示名称 | 所需原始线索 | 组合规则 | truth 贡献 | 解锁方向 |
|---|---|---|---|---:|---|
| `package_not_for_503` | 包裹不是寄给 503 的 | `wrong_package` + `room_403_receipt` | 全部满足 | 10 | 403、李汶涛 |
| `package_is_controlled_handoff` | 包裹属于一次受控交接 | `package_contents` + `handoff_failed_2347` | 全部满足 | 10 | 交接网络 |
| `chen_is_monitoring` | 陈怀民在监控并试图回收包裹 | `unknown_number_probe` +（`doorstep_package_claim` 或 `recording_pressure`） | 主线索 + 任一佐证 | 10 | 陈怀民动机 |
| `chen_has_spare_key` | 陈怀民掌握进入 503 的手段 | `door_scratch` + `chen_keys` | 全部满足 | 5 | 强入路线 |

L1 合计 35 分，达到“陈怀民与包裹有关，但案件尚未触及幕后”的认知层。

### 5.2 L2：林越与假警察

| 推理结论 ID | 显示名称 | 所需原始线索 | 组合规则 | truth 贡献 | 解锁方向 |
|---|---|---|---|---:|---|
| `linyue_investigating` | 林越在追查李汶涛失踪 | `linyue_retracted_message` + `room_403_receipt` + `linyue_investigation_record`（新增） | 任意 2 条，其中至少一条必须直接来自林越 | 15 | 林越同盟 |
| `fake_police` | 门外警察是假的 | `false_police_overknows` + `police_verified` | 全部满足 | 15 | 假警察来源 |
| `lure_operation_confirmed` | 便利店来电是诱骗行动 | `fake_store_call` +（`unknown_number_probe` 或 `recording_pressure`） | 主线索 + 任一行为关联 | 5 | 组织行动方式 |

L2 用于排除错误嫌疑并确认对方具有协调行动能力。

### 5.3 L3：李汶涛与组织

| 推理结论 ID | 显示名称 | 所需原始线索 | 组合规则 | truth 贡献 | 解锁方向 |
|---|---|---|---|---:|---|
| `liventao_expected_danger` | 李汶涛预感到自己会出事 | `room_403_receipt` + `li_wentao_last_message`（新增）+ `handoff_failed_2347` | 任意 2 条，必须包含遗言或最后消息 | 15 | 李汶涛遗产 |
| `chen_not_mastermind` | 陈怀民只是执行者 | `chen_phone_upstream_chat`（由手机拆分）+ `handoff_failed_2347` | 全部满足 | 15 | 上游身份 |
| `organization_controls_handoff` | 包裹交接由组织统一调度 | `package_is_controlled_handoff` + `chen_not_mastermind` | 两条推理结论组合 | 10 | 组织网络 |

推理结论可以依赖其他已确认结论，但必须保留底层原始线索引用，确保断案时可以回溯证据来源。

### 5.4 L4：赵鸿远与公安内线

| 推理结论 ID | 显示名称 | 所需原始线索 | 组合规则 | truth 贡献 | 解锁方向 |
|---|---|---|---|---:|---|
| `zhao_is_1103` | 1103 指向赵鸿远 | `numeric_note_1103`（由包裹内容拆分）+ `chen_phone_contact_1103`（由手机拆分）+ `zhao_identity_bridge`（新增） | 全部满足 | 25 | 最终主谋 |
| `org_has_inside_man` | 组织存在公安内线 | `dispatch_record_tampered`（新增）+ `police_report_leaked`（新增）+ `police_verified` | 任意 2 条，其中必须包含接警系统异常 | 15 | 绕过警方内线 |

不得继续使用“陈怀民手机 + 23:47 交接失败”直接推导赵鸿远身份，也不得使用“核实出警 + 交接失败”直接推导公安内线。这两组现有规则缺少身份桥和系统异常证据。

### 5.5 证据链结论

证据链结论不增加 `truthLayer`，只影响 `evidenceStrength` 与 `externalReach`。

| 证据结论 ID | 显示名称 | 所需原始线索或状态 | 影响 |
|---|---|---|---|
| `evidence_captured` | 关键实物已被完整记录 | `package_contents_photo`（新增）或内容照片状态 | evidence +20 |
| `evidence_attributed` | 证据能够指向具体人物或组织 | `chen_phone_upstream_chat` + `numeric_note_1103` | evidence +20 |
| `evidence_backed_up` | 证据已有外部备份 | `linyue_has_photo` 或其他已确认备份节点 | evidence +20，external ≥40 |
| `evidence_police_received` | 可信警方已接收并核验 | `police_verified` + 已确认的证据发送事件 | evidence +20，external ≥70 |
| `evidence_publicly_redundant` | 证据已进入多个独立渠道 | 两个以上互不依赖的外部节点 | evidence +20，external =100 |

## 六、建议新增或拆分的原始线索

| 新线索 ID | 来源 | 解决的问题 |
|---|---|---|
| `package_exterior_photo` | 包裹未开启时的外包装照片 | 与内容照片分离，消除 `package_photo` 语义冲突 |
| `package_contents_photo` | 包裹开启后的内部物品照片 | 为法律证据链提供明确内容证明 |
| `numeric_note_1103` | 包裹内数字纸条 | 给 1103 身份推理提供独立原始证据 |
| `chen_phone_upstream_chat` | 陈怀民手机中的“上游”对话 | 证明陈怀民不是最终决策者 |
| `chen_phone_contact_1103` | 手机联系人、转账备注或聊天代号 | 将 1103 与陈怀民的上游联系起来 |
| `zhao_identity_bridge` | 403 笔记本、U 盘成员表或可信身份记录 | 将代号 1103 与赵鸿远本人对应 |
| `linyue_investigation_record` | 林越报警记录、调查笔记或直接陈述 | 证明林越确实在调查李汶涛 |
| `li_wentao_last_message` | 李汶涛遗言、定时消息或最后记录 | 支撑“李汶涛预感到死亡” |
| `dispatch_record_tampered` | 接警记录被异常标记为已处理 | 支撑公安内线推理 |
| `police_report_leaked` | 对方提前知道未公开的报警内容 | 证明报警信息从内部泄露 |

建议废弃宽泛的 `package_photo` 与 `chen_phone_found` 作为深层推理的直接输入。可以保留它们作为 UI 分组或兼容字段，但真正的知识激活应引用拆分后的原子线索。

### 6.1 剧情设计中已有、但尚未成为固定模板的信号

`plot-design.md` 已经描述了下列线索概念，但当前 `clueBook` 没有相应的稳定 ID。实施前应决定保留、合并或删除，不能继续只存在于叙事文本中。

| 剧情设计中的信号 | 建议原子线索 ID | 目标用途 | 与本文件其他线索的关系 |
|---|---|---|---|
| 包裹面单残片“青荷 5-0” | `package_label_fragment` | 证明地址残缺，支持错投判断 | 可替代宽泛的 `wrong_package`，或作为其底层事实 |
| 4 秒未接来电 | `missed_call_4s` | 建立监控时间线 | 与 `unknown_number_probe` 合并或作为其底层事实 |
| 陈怀民 23:12 敲门 | `chen_knock_2312` | 将电话试探与本人行动关联 | 用于加强 `chen_is_monitoring` |
| 真、假警察不同的问话方式 | `police_question_mismatch` | 识别身份话术异常 | 与 `false_police_overknows` 组合 |
| 回拨 110 查不到出警记录 | `no_dispatch_record` | 坐实门外人物不是正式出警 | 可以作为 `police_verified` 的底层事实 |
| 陈怀民提前知道“警察”会来 | `chen_knew_fake_police_arrival` | 证明陈怀民与假警察存在协同 | 支撑组织调度结论 |
| U 盘账本 | `usb_ledger` | 提供交易、成员编号和警号记录 | L3/L4 的核心数字证据，目前完全缺失 |
| U 盘密码 | `usb_password` | 证明玩家合法解锁而非 AI 直接泄露内容 | 与 `usb_ledger` 形成可验证访问链 |
| 403 笔记本中的成员代号 | `room_403_member_notebook` | 将 1103 与组织成员体系连接 | 可承担 `zhao_identity_bridge` 的来源 |
| 403 烟盒或雨棚烟蒂对应 | `room_403_cigarette_match` | 证明李汶涛曾观察 503 或走廊 | 支撑李汶涛调查路径 |
| 林越报警记录或拒绝报警的理由 | `linyue_report_record` | 排除林越是帮凶 | 可承担 `linyue_investigation_record` |
| “如果他来就说我搬走了” | `li_wentao_last_warning` | 证明李汶涛预感危险 | 可承担 `li_wentao_last_message` |
| U 盘账本中出现警号 | `police_badge_in_ledger` | 提供公安内线的直接数字证据 | 支撑 `org_has_inside_man` |
| 赵鸿远提前知道报警内容 | `zhao_knew_report` | 证明报警信息泄露给组织上游 | 可承担 `police_report_leaked` |
| 真警察被异常拖延 | `real_police_delayed` | 证明接警或调度环节受到干预 | 与 `dispatch_record_tampered` 组合 |
| 真空包装、现金连号 | `vacuum_packaging`、`serial_cash` | 形成“普通毒品交易”的红鲱鱼 | 只生成待验证假设，不直接增加真相分 |
| 烟盒很新、催缴单日期很近 | `fresh_cigarette_pack`、`recent_collection_notice` | 形成“403 住户仍活着”的红鲱鱼 | 需要最后消息或失踪确认来排除 |

这批信号中，U 盘、密码、403 笔记本和接警系统异常是 L4 结论的关键桥梁。如果最终决定不实现这些物件，就必须重写“1103 = 赵鸿远”和“组织存在公安内线”的证据路径，不能保留当前无桥推理。

## 七、评分映射建议

### 7.1 truthLayer

`truthLayer` 只来自已激活推理结论，同一结论只计分一次。原始线索数量、资源警告和战斗道具不直接增加真相分。

建议分层目标：

| 真相层 | 代表性结论 | 目标累计分 |
|---|---|---:|
| L1 | 包裹错投、陈怀民监控、备用钥匙 | 25～35 |
| L2 | 林越可信、假警察、诱骗行动 | 50～65 |
| L3 | 李汶涛遗产、陈怀民是执行者、组织调度 | 70～85 |
| L4 | 1103 = 赵鸿远、公安内线 | 100 |

分值总和可以超过 100，但 `truthLayer` 必须截断为 100。

### 7.2 evidenceStrength

不建议继续按“拥有某个 clue ID 就加 20”计算。建议改为五段式证据链，每段最多 20：

1. **来源明确**：知道实物或数字证据来自何处；
2. **内容完整**：内容被检查、拍摄或导出；
3. **归属成立**：证据可以指向人物、房间或组织；
4. **外部保全**：证据已离开单一设备或现场；
5. **可信核验**：警方、证人或多个独立渠道完成核验。

这样可以避免同一张包裹照片被同时重复计算为内容、备份和归属。

### 7.3 externalReach

| 外传层级 | 分数建议 | 判据 |
|---|---:|---|
| 仅玩家或本地手机持有 | 0 | 证据仍可能随玩家死亡或设备损坏而消失 |
| 单一私人联系人备份 | 40 | 林越等可信联系人收到证据 |
| 可信官方渠道接收 | 70 | 真警方或正式系统确认接收 |
| 多节点冗余或公开 | 100 | 私人联系人、警方、媒体等至少两个独立渠道持有 |

若已确认组织存在公安内线，仅有警方单一渠道时应降低有效外传分；私人备份和公开渠道不受同一折扣。

### 7.4 survivors 与 cycleCost

这两个维度继续直接读取世界状态：

- `survivors` 不应由玩家提交的线索改变；
- `cycleCost` 只由循环次数决定；
- `chen_body`、`weapon_found`、`battery_critical` 等线索不直接增加真相或证据分。

## 八、主动结案交互规则

### 8.1 线索组合

- 玩家在“原始线索”页选择 2～3 条线索；
- 系统只显示能够产生新结论的组合；
- 已激活结论不重复奖励；
- 组合失败时只提示“这些信息暂时连不起来”，不暴露正确答案；
- 红鲱鱼可以生成“待验证假设”，但假设不增加 `truthLayer`。

### 8.2 推理结论卡

每张推理结论卡至少包含：

```text
结论名称
支撑线索 ID
truthLayer 贡献
影响的评分维度
互斥结论
解锁调查方向
是否属于待验证假设
```

### 8.3 提交结案

- 解锁条件：至少 3 条正向推理结论；
- 玩家从已激活结论中选择 3 条作为核心论证；
- 系统展示其底层原始线索，避免玩家只提交抽象结论；
- `scoreEnding()` 使用全部激活知识和世界状态计算档位；
- 三条核心结论用于生成结局 CG 的旁白、重点镜头和反派归因；
- 玩家提交结案前创建可恢复快照，A～D 结局后可以回到该快照继续调查。

## 九、当前实现与目标设计的差距

### 9.1 正式链只有四条线索可达

AI-first 阶段四当前只允许以下线索进入正式状态：

- `wrong_package`
- `package_contents`
- `package_photo`
- `linyue_has_photo`

其余 16 个模板没有同等的正式投影支持。按照当前 `canAccuse()` 的规则，这四条线索中只有 `wrong_package` 能激活正向真相知识，因此正式链无法自然满足“至少三条知识才能断案”。

### 9.2 当前知识规则过于宽松

当前 10 条知识定义及其问题如下：

| 当前知识 ID | 当前触发条件 | truth 贡献 | 问题 | 建议去向 |
|---|---|---:|---|---|
| `package_not_for_503` | `wrong_package` | 10 | 模糊标签只能产生怀疑，不能单独证明错投 | 改为标签异常 + 403 地址证据 |
| `chen_has_spare_key` | `door_scratch` | 5 | 划痕不能证明陈怀民持有钥匙 | 改为划痕 + `chen_keys` |
| `chen_is_monitoring` | `unknown_number_probe` | 10 | 无法把陌生号码与陈怀民本人关联 | 增加敲门时间、认领包裹或录音行为关联 |
| `chen_not_mastermind` | `chen_phone_found` 或 `handoff_failed_2347` 任一条 | 15 | 任一宽泛线索即可跳到上游结论 | 改为手机上游对话 + 交接事实 |
| `linyue_investigating` | `linyue_retracted_message` 或 `room_403_receipt` 任一条 | 15 | 一条撤回消息或一张收据都不能证明林越的调查行为 | 至少需要一条直接来自林越的调查记录 |
| `linyue_is_accomplice` | `peephole_blind_spot` | 0 | 猫眼盲区没有林越身份信息 | 降级为待验证假设，不进入正式知识 |
| `fake_police` | `false_police_overknows` 或 `police_verified` 任一条 | 15 | 说漏细节只能形成怀疑，官方核实也需要明确核实结果 | 改为异常话术 + 官方无出警记录 |
| `liventao_is_dead` | `room_403_receipt` 或 `handoff_failed_2347` 任一条 | 15 | ID 表示“已经死亡”，显示文案却是“预感到死亡”，且两条输入都不足 | 统一语义为 `liventao_expected_danger`，增加遗言或最后消息 |
| `zhao_is_1103` | `chen_phone_found` + `handoff_failed_2347` | 25 | 缺少 1103 代号和赵鸿远身份之间的桥 | 增加数字纸条、手机代号和身份映射 |
| `org_has_inside_man` | `police_verified` + `handoff_failed_2347` | 15 | 假警察与交接失败不能证明公安系统内部泄露 | 增加接警记录异常或报警内容泄露 |

这些规则应替换为第五节的组合关系，同时保留旧 ID 到新结论的迁移映射。

### 9.3 Canonical Story Material 不会自动生成线索

当前正式材料只描述：

- 23:47 交接失败；
- 403 收据；
- 林越撤回消息；
- 假便利店来电。

材料只提供剧情可能性，没有权力直接写入状态或增加线索。必须由合法观察事件和线索投影完成落库。

### 9.4 UI 资源不完整

当前只有少数线索配置了图片资源。新增或拆分后的核心线索需要对应卡面或通用占位规则，否则主动组合界面会出现有数据但无法统一展示的问题。

### 9.5 评分与语义未统一

- `package_photo` 的定义冲突；
- 本地录音被当作外传分；
- 真相分依赖过于宽松的单线索知识；
- 当前评分正向权重合计超过 1；
- 三条核心结论与全部知识的评分职责尚未区分；
- v3 评分结果尚未作为正式、可恢复的 GameEnding 提交。

## 十、实施前验收标准

在开始实现 UI 和结局 CG 前，线索系统至少满足：

1. 每个原始线索 ID 只有一种稳定语义；
2. 每条深层推理结论至少有两条独立支撑；
3. 所有结论都能追溯到原始线索和确认事件；
4. 红鲱鱼只能生成假设，不直接增加真相分；
5. 资源与战斗线索不能用于凑满主动结案门槛；
6. 所有结局关键线索都有 AI-first 正式落库路径；
7. 每条知识都有“差一条不激活、满足后激活、重复不计分”的测试；
8. S、A、B、C、D 五档都存在可复现的金标状态；
9. 23:47 的交接线索在死亡前结算，并能跨循环保留；
10. A～D 结局后能够恢复到提交结案前继续调查；
11. 最终分数范围、权重和 UI 展示一致；
12. CG 只表达已确认结论，不新增幕后身份或证据事实。

## 十一、建议实施顺序

1. 确认本文件中的线索命名、拆分项和推理组合；
2. 将线索模板、推理规则和评分标签收敛为唯一数据源；
3. 补齐 AI-first 线索投影和金标测试；
4. 实现原始线索组合与推理结论卡；
5. 调整 `scoreEnding()` 的评分映射和分数上限；
6. 实现主动提交结案、可恢复快照和多档 CG；
7. 最后移除旧三结局链中与主动结案冲突的自动生还逻辑。

## 十二、当前代码与设计来源

- 固定线索模板：`packages/content/src/clues.ts`
- 当前知识激活规则：`packages/game-core/src/knowledge/knowledgeDefinitions.ts`
- AI-first 线索投影白名单：`packages/game-core/src/takeover/knowledgeClueTakeover.ts`
- Canonical Story Material：`packages/game-core/src/storyMaterial/canonicalStoryMaterial.ts`
- 当前多维评分：`packages/game-core/src/scoring/multiDimensionScorer.ts`
- v3 剧情与断案设计：`docs/plot-design.md`
