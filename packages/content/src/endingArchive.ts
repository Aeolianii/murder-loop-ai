import type { EndingTier } from '@murder-loop-ai/shared';

export interface EndingCatalogEntry {
  tier: EndingTier;
  minScore: number;
  title: string;
  narrative: string;
  backtrackHint: string | null;
}

export interface StoryRecapChapter {
  id: string;
  time: string;
  title: string;
  playerView: string;
  hiddenTruth: string;
}

export const ENDING_CATALOG: ReadonlyArray<EndingCatalogEntry> = [
  {
    tier: 'S',
    minScore: 90,
    title: '雨停之后',
    narrative: '证据链完整公开，赵鸿远被逮捕，组织网络与公安内线一并被摧毁。',
    backtrackHint: null,
  },
  {
    tier: 'A',
    minScore: 70,
    title: '迟到的正义',
    narrative: '警方拿到关键证据开始调查，但赵鸿远提前脱身，组织仍留下未断的根系。',
    backtrackHint: '雨声还在。她闭眼，又睁开——有一件事她还没想通。',
  },
  {
    tier: 'B',
    minScore: 50,
    title: '断尾',
    narrative: '陈怀民被逮捕，组织迅速切割了他；危险暂时解除，真相却只揭露了表层。',
    backtrackHint: '陈怀民的脸她记住了。但她总觉得，那个电话号码后面还有别人。',
  },
  {
    tier: 'C',
    minScore: 30,
    title: '匿名者',
    narrative: '沈知夏知道了真相，却没有足够证据让它站住，只能匿名举报后离开青荷公寓。',
    backtrackHint: '她活到了天亮。但 403 那扇门后面是什么，她不知道。',
  },
  {
    tier: 'D',
    minScore: 0,
    title: '无人知晓的 503',
    narrative: '她活了下来，循环也停止了，但没有人知道 503 室在那个雨夜真正发生过什么。',
    backtrackHint: '她睁开眼。雨声落在窗外。又是 23:00。',
  },
];

export const FULL_STORY_RECAP: ReadonlyArray<StoryRecapChapter> = [
  {
    id: 'first-death',
    time: '第一轮 · 23:00—23:47',
    title: '沈知夏第一次死亡',
    playerView: '沈知夏刚搬进青荷公寓 503，桌上却多出一个地址残缺的陌生包裹。匿名来电、门外脚步和一句压低的“东西呢”接连出现；23:47，她没能把危险挡在门外。',
    hiddenTruth: '包裹并非普通错投，而是李汶涛留下的证据包。陈怀民奉命在 23:47 前完成回收；当他确认沈知夏已经接触包裹，回收任务转为灭口与清理现场。',
  },
  {
    id: 'room-403',
    time: '死亡之前 · 403 室',
    title: '李汶涛留下的证据',
    playerView: '403 室的收据、烟盒、笔记和走廊痕迹看似互不相干，只能说明那名失踪住户曾长期观察这栋楼。',
    hiddenTruth: '李汶涛已经发现陈怀民替一个犯罪组织执行包裹交接，并在调查中接触到交易账本、成员代号和异常警号。他预感自己会出事，于是把数字资料藏进包裹，留下多条可供后来者交叉验证的线索。',
  },
  {
    id: 'evidence-drop',
    time: '第一轮之前',
    title: '包裹为什么来到 503',
    playerView: '残缺面单让包裹看起来像一次偶然错投，真空包装和现金又将调查引向普通非法交易。',
    hiddenTruth: '这是李汶涛故意制造的证据投递。他利用 503 新住户入住造成的信息空档，把证据从 403 转移出去；红鲱鱼包装是为了拖慢组织对真正数字资料的识别。',
  },
  {
    id: 'recovery-operation',
    time: '每轮 · 23:00—23:47',
    title: '陈怀民与回收行动',
    playerView: '陈怀民以房东身份敲门、认领包裹，陌生号码则不断确认 503 是否有人。便利店来电像一条偶然出现的离房理由。',
    hiddenTruth: '匿名来电负责确认在场状态，陈怀民负责现场回收，假便利店电话负责诱离。23:47 不是神秘死亡时间，而是组织原定的交接压力点；玩家的每次应对都会迫使他们更换方案。',
  },
  {
    id: 'fake-police',
    time: '报警之后',
    title: '为什么“警察”先到了',
    playerView: '第一批来客知道未公开的包裹细节，却给不出警号；回拨核验后，正式出警记录与他们的说法对不上。',
    hiddenTruth: '假警察是组织的外围执行者，和陈怀民共享行动信息。他们的目标不是调查，而是取得证据并将现场包装成普通意外。真正警力被错误信息拖延，说明泄露并不只发生在公寓内部。',
  },
  {
    id: 'lin-yue',
    time: '跨越多轮',
    title: '林越真正调查的事情',
    playerView: '林越的撤回消息、迟疑和对 403 的关注一度让他显得可疑；他有接触公寓和钥匙系统的便利条件。',
    hiddenTruth: '林越是李汶涛预先选择的信息中继者。他没有掌握完整真相，只知道李汶涛可能因调查失踪。沈知夏把照片和记录传给他后，他才成为证据离开 503 的第一条可靠外部链路。',
  },
  {
    id: 'upstream',
    time: '深层调查',
    title: '1103 与赵鸿远',
    playerView: '陈怀民手机中的上游命令、U 盘成员编号和 403 笔记里的访问记录，逐渐把“1103”从数字变成一个具体身份。',
    hiddenTruth: '陈怀民只是现场执行者。1103 对应赵鸿远，他负责调度包裹回收、外围人员和信息清理；报警内容提前泄露以及账本中的警号进一步证明，组织在公安链路内拥有内线。',
  },
  {
    id: 'truth-resolved',
    time: '最终轮 · 真相推导',
    title: '真相被解开',
    playerView: '沈知夏把每一轮保留下来的原始线索组合成结论，再用全部已确认结论完成真相推导。她不仅需要知道凶手是谁，还要让证据离开房间、保护林越并等到可信接应。',
    hiddenTruth: '循环真正给予她的不是预知答案，而是重复验证因果的机会。只有当赵鸿远、组织内线、证据包来源和回收行动都形成可追溯证据链时，第一次死亡才不再只是一桩无人知晓的 503 室意外。',
  },
];
