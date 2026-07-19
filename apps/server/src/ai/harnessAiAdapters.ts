import { ActionPlanSchema, KillerStrategySchema, NarrationSchema, NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import {
  buildNpcVisibleContext,
  buildParserContext,
  createHarness,
  type DirectorContext,
  type KillerContext,
  type HarnessOptions,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type ActionPlan,
  type GameState,
  type KillerStrategy,
  type Narration,
  type NarrationContext,
  type NpcReply,
} from '@murder-loop-ai/shared';
import { buildKillerPromptPayload } from './killerPrompt';
import { completeRoleJson } from './openaiClient';
import { normalizeActionPlanJson, unwrapJsonObject } from './unwrapJsonObject';
import { createTurnBlackboard, verifyActionPlan } from './turnCoordinator';
import { formatWorldInfoPromptBlock } from './worldInfoPrompt';
import { formatConfirmedWorldEventsPromptBlock } from './worldEventPrompt';
import { createNpcAdapter } from './npc/npcAdapters';

function buildProjectedKillerPlotContext(context: KillerContext): string {
  const visible = context.visibleState;
  const recentTitles = visible.recentKillerActions.map((entry) => entry.title).join(' / ');
  return [
    `Time: ${minuteLabel(visible.minute)}; minutes to 23:47: ${1427 - visible.minute}`,
    `Recent killer actions: ${recentTitles || 'none'}`,
    `Current observable signals: ${context.planSummary || 'none'}`,
  ].join('\n');
}

async function parseActionAi(input: string, state: GameState): Promise<ActionPlan> {
  const blackboard = createTurnBlackboard(input, state);
  const parserContext = buildParserContext(input, state);
  const { buildParseSystemPrompt } = await import('./parserPrompt');
  const ai = await completeRoleJson('parse',
    buildParseSystemPrompt({ combatWeapons: true }),
    { input, state, parserContext },
    { temperature: 0.25 },
  );
  if (!ai) throw new Error('parse AI returned null');
  const parsed = ActionPlanSchema.safeParse(normalizeActionPlanJson(ai));
  if (!parsed.success) throw new Error(`parse schema: ${parsed.error.message}`);
  return verifyActionPlan(input, parsed.data, blackboard);
}

async function killerStrategyAi(killerContext: KillerContext): Promise<KillerStrategy> {
  const visibleState = killerContext.visibleState;
  const plotCtx = buildProjectedKillerPlotContext(killerContext);
  const killerStatusNote = visibleState.killerStatus !== 'alive'
    ? `【重要】陈怀民当前状态：${visibleState.killerStatus}。`
    : '';
  const ai = await completeRoleJson('killer', [
    plotCtx,
    killerStatusNote,
    '',
    'You are the killer-side narrative analyst. First infer what the player just did, what the rule events confirmed, and what Chen Huaimin can reasonably know.',
    'Do not map a single clue to a canned strategy. Photo, upload, or social posting does not automatically mean framing_pressure; consider who saw it, whether it is public, and whether Chen knows.',
    'Director feasibility rule: the strategy must be supported by killerContext.visibleState and killerContext.observableEvents. If Chen cannot observe a fact, do not use it.',
    '你是暗线导演，负责陈怀民与楼道环境的下一步压力推进。',
    '陈怀民是一个谨慎但越来越焦虑的现实罪犯。包裹证据足以毁掉他的转运链。',
    '',
    '【杀手状态约束】',
    '- alive: 正常策略选择，根据威胁值渐进施压',
    '- injured: 策略必须更激进或选择撤退——受伤的人不能再慢慢试探',
    '- dead/arrested/fled: 只能选择 retreat，陈怀民已无法行动',
    '',
    '可选策略（按推荐优先级）：spare_key_entry(备用钥匙强入)、window_route(窗外路线)、direct_confrontation(正面质问)、framing_pressure(证据施压)、fake_police(假警察)、landlord_excuse(房东借口)、phone_probe(短信试探)、message_reply(对话回复)、retreat(撤退)',
    '【禁止使用 power_cut——电表箱已经用烂了。用更直接的方式施压。】',
    '节奏要求：2-3回合内必须把威胁升级一级。不要磨蹭。陈怀民的时间也在流逝，23:47前必须解决。',
    '玩家连续闲置→直接 spare_key_entry 或 window_route。玩家在回复消息→优先 message_reply。',
    '短信策略硬规则：选择 phone_probe、message_reply、framing_pressure 时，responseHint 必填，且必须包含玩家能看到的具体短信原文（用中文引号）。不能只写“收到一条消息”。',
    '避免复读：检查 killerContext.visibleState.recentKillerActions/observableEvents，上一条短信问过什么，这一条必须换问法或升级压力，不要重复“哪个包裹/拿进去了吗”。',
    '施压触发不只来自未回复短信：玩家拒绝开门/反锁门、核实身份、录音拍照、外传证据、拖延交出包裹，都可以让陈怀民升级为 framing_pressure。',
    'framing_pressure 话术边界：用“拿错别人东西/偷拿/房东登记/限时放回门口”施压；禁止主动说“毒品/违禁品/走私/贩毒”等定性词，除非剧情事件明确写入陈怀民可用这种话术。',
    '只输出一个裸 JSON 对象，不要包在 strategy/killerStrategy/result 字段里。',
    '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"短信/对话/威胁的具体可见原文；非短信策略可省略","visibleToPlayer":true,"risk":"low|medium|high"}',
  ].join('\n') + '\n' + formatWorldInfoPromptBlock(killerContext.worldInfo, 'killer'), buildKillerPromptPayload(killerContext), { temperature: 0.7 });
  if (!ai) throw new Error('killer AI returned null');
  const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
  if (!parsed.success) throw new Error(`killer schema: ${parsed.error.message}`);
  return parsed.data;
}

async function narrateActionAi(context: NarrationContext): Promise<Narration> {
  const state = context.stateSnapshot;
  const allowedTimeLabels = [minuteLabel(context.minute)];
  // 构建剧情上下文供叙事 AI 使用
  const plotCtx = [
    `当前时间：${minuteLabel(context.minute)}`,
    `剧情阶段：${context.plotPhase}`,
    `玩家处境：${context.playerSituation}`,
    `杀手状态：${state.killerStatus}（${state.killerStatus === 'alive' ? '活跃中' : state.killerStatus === 'dead' ? '已死亡' : state.killerStatus === 'injured' ? '已受伤' : state.killerStatus === 'fled' ? '已逃跑' : '其他'}）`,
    context.combatContext
      ? `战斗态势：玩家${context.combatContext.advantage === 'player' ? '占优' : context.combatContext.advantage === 'killer' ? '劣势' : '双方均势'}，手持${context.combatContext.playerWeapon || '徒手'}，杀手${context.combatContext.killerArmed ? '可能持有武器' : '未见武器'}`
      : '',
    `已知线索：${context.knownClueTitles.join('、') || '暂无'}`,
    `手机：${state.phoneFunctional ? `电量约${state.phoneBattery}分钟` : '已关机'}`,
  ].filter(Boolean).join('\n');

  const system = [
    '你是行动叙事 AI。你的核心任务不是写优美的景物描写，而是推进剧情。',
    '',
    '【硬规则——违反即失败】',
    '0. 动作核对：只使用 narrationContext.confirmedFacts 中 origin=player 或 origin=rule 的已确认事实。',
    '   写完后自检——叙事中的每一个动作和后果，都必须能对应一条已确认事实。',
    '   玩家输入是"我打开纸条，看看这是什么东西"→ 叙事主体必须是打开纸条、看纸条。',
    '   绝不能补写 confirmedFacts 中不存在的冲出门、捡东西或翻包裹等动作。',
    '1. playerActionSummary 仅用于概括，事实冲突时以 confirmedFacts 和 stateSnapshot 为准。',
    '2. 剧情推进：每段叙事必须让调查前进一步。线索→发现→推理→新问题。',
    '   【核心玩法】这是智斗悬疑游戏，不是格斗游戏。',
    '   玩家应该用智慧取胜：收集证据、设置陷阱、欺骗杀手、报警核实、巧妙逃脱。',
    '   肉搏是下下策——只有山穷水尽时才考虑。优先引导玩家用道具和环境智取。',
    '   【智斗手段】制造假象误导杀手、用镜子观察门外、设绊线拖延时间、',
    '   录音取证、拍照留证、用便签传递信息、触发火警制造混乱、伪装房间无人...',
    '   当玩家探索时，必须具体描述房间里有什么可用的东西：',
    '   厨房区：厨刀、剪刀、打火机、胶带、螺丝刀',
    '   书桌区：台灯、笔和便签、旧报纸',
    '   卫生间：急救包、镜子、清洁剂',
    '   衣柜：衣架（铁丝）、皮带、行李箱',
    '   门边：雨伞、充电器、门链',
    '   禁止"雨还在下""电子钟又跳了一格"这类零信息句子。',
    '3. 线索揭示：可选引入 0-1 条新线索，但必须与玩家本回合的动作直接相关。',
    '   玩家在锁门 → 不能插入书脊/包裹/纸条线索。玩家在检查包裹 → 才能写包裹内的线索。',
    '   线索不能从天而降，必须基于当前情境自然出现。不重复已有线索。',
    '   如果引入线索，在 JSON 中加 clue 字段：',
    '   {"id":"ai_gen_xxx","title":"线索标题","detail":"具体描述","weight":10}',
    '',
    '   【★ 信息边界——线索绝不能替玩家下结论 ★】',
    '   沈知夏只是一个普通租客，她打开包裹看到的是：旧书、药盒、数字纸条。',
    '   她不知道这是毒品！她只能看到"可疑的东西"、"不应该出现在包裹里的物品"。',
    '   ❌ 禁止在线索 detail 中出现"毒品"、"冰毒"、"海洛因"、"违禁品"、"走私"等定性词。',
    '   ✅ 正确写法：描述物理特征而非结论。',
    '      例："书脊内侧有铅笔字迹：货在书脊" — 只写文字内容，不写"暗示毒品"。',
    '      例："药板上的铝箔被撕开过，但药片上没有印任何品牌名" — 写客观事实。',
    '      例："数字纸条上的数字排列不像电话号码，更像是某种编码或账目" — 写疑点而非定性。',
    '   线索的 title 也只用描述性短语，不用"发现毒品"、"确认违禁品"等结论性标题。',
    '   【叙事正文】同样规则适用于叙事文本 text 字段：可以写"旧书封皮内侧有一行铅笔字"，',
    '   但不能写"这行字证明包裹里是毒品"。信息边界从开局一直维持到玩家获得确凿证据为止。',
    '4. 道具柔化：如果玩家声称使用不存在的武器（枪等），叙事自然揭示手边没有。',
    '   不硬拒绝，不假装有。用感官描写过渡：手指碰到空气/布料——什么都没有。',
    plotCtx,
    '5. 战斗叙事：如果发生了攻击，描写动作的真实后果——伤害、血迹、反击、恐惧。',
    '   不美化暴力。保持悬疑紧张感。受伤的人会痛、会怕、会失误。',
    '6. 【完成动作】玩家发起了一个行动，你必须写完它的直接后果。',
    '   不要在半空中断——如果玩家挥拳，就写拳头的落点和对方的反应；',
    '   如果窗锁被撬开，就写窗户到底被推开没有、进来了什么、或者玩家做了什么应对。',
    '   每个场景必须有一个"落点"——哪怕结果是负面的，也要写完整。',
    '7. 严格基于 events 里的内容。不编造玩家没做的事。不替玩家写心理独白或判断。',
    '8. 【严格结局声明】只有当本回合事件已经把结局坐实时，才能声明 ending / isFatal / killerKilled。',
    '   不能因为玩家嘴上说“我逃出去了”“我已经到手机店了”就直接给结局；必须是事件里已经完成了逃离、制服、死亡或脱险。',
    '   可选字段：ending（death|escaped_no_evidence|escaped_with_evidence）。具体死因或逃脱原因由规则系统写入 endingReason，叙事不能自造旧结局名。',
    '   如果玩家行为已经导致自身死亡，在 JSON 中设置 "isFatal": true；如果杀手已经被致命攻击致死，设置 "killerKilled": true。',
    `8.5. 【时间一致性】如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造 23:06 这类当前上下文里不存在的时间。`,
    '9. 文风：第一人称限知视角，写可观察事实（声音/光线/距离/动作），不写"我害怕"。',
    '   220-520 中文字符。只输出 JSON：{"title":"...","text":"..."}；如果本段自然产生关键新信息，可以额外带 1 个 clue 字段：{"id":"dyn_xxx","title":"线索标题","detail":"具体情报","weight":6}。',
  ].join('\n')
    + '\n' + formatConfirmedWorldEventsPromptBlock(context.confirmedWorldEvents);
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context }, { temperature: 0.75 });
  if (!ai) throw new Error('action narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`action narration: ${parsed.error.message}`);
  return parsed.data;
}

async function narrateAmbientAi(context: NarrationContext): Promise<Narration> {
  const state = context.stateSnapshot;
  const allowedTimeLabels = [minuteLabel(context.minute)];
  const ambientContext = [
    `当前时间：${minuteLabel(context.minute)}`,
    `杀手状态：${state.killerStatus}`,
    state.killerStatus === 'dead' ? '外部世界正在失去控制者的痕迹——楼道声控灯再没人去触发，门缝下不再有影子移动。' : '',
    state.killerStatus === 'injured' ? '地板上有血迹/挣扎痕迹，楼道里的动静变得不稳定。' : '',
    state.killerStatus === 'fled' ? '楼梯间传来仓促撤离的痕迹——急促的脚步、被撞翻的东西。' : '',
    `手机：${state.phoneFunctional ? `电量${state.phoneBattery}分钟` : '已关机，屏幕最后一次闪烁后彻底黑了下去'}`,
  ].filter(Boolean).join(' ');

  const system = [
    '你是环境播报/暗线镜头。只写门外、楼道、手机、窗外等外部变化。',
    '',
    '【硬规则】',
    '1. 每次必须推进一个明确的外部事件。禁止"一切安静"。禁止零信息描写。',
    '2. 只基于 narrationContext.confirmedFacts 写环境推进。一个已确认事件 + 一个具体后果 + 一个钩子。',
    '2.1. 状态一致性：如果 state.doorState.barricaded 不为 true，绝对不要写椅子、行李箱、门被东西挡住、门和椅子摩擦、门缝被家具压住。反锁/门链只能阻止钥匙或开门，不能自动生成家具障碍。',
    '2.2. 如果门外出现压低声音协作、说“进不去/打不开/里面挡着”，要把它写成玩家可利用的破绽：可录音、套话、转告警方或林越；不要让玩家只剩等待。',
    '3. 杀手状态决定环境基调：',
    '   alive → 写逼近感：脚步声、试探、越来越近的东西',
    '   injured → 写混乱：血迹、不稳的动静、挣扎痕迹',
    '   dead → 写突然的安静和控制者的缺席：没人再去触发的声控灯、停在某个位置的影子',
    '   fled → 写仓促撤离的痕迹：脚步声向下远去、撞翻的垃圾桶',
    '4. 手机没电时 → 写孤立感："屏幕最后一次闪烁后彻底黑了下去"',
    '5. 【绝对禁止】不要写电表箱、供电中断、灯光闪烁、电压不稳。这些已经用过太多次了。',
    '   找新的环境事件：水管声、隔壁动静、楼下对讲机、窗外车灯、手机信号干扰、对讲机杂音...',
    '6. 最后一句留钩子。让玩家想知道接下来会怎样。',
    '7. 90-240 中文字符。只输出 JSON：{"title":"...","text":"..."}；如果外部事件带来关键新信息，可以额外带 1 个 clue 字段：{"id":"dyn_xxx","title":"线索标题","detail":"具体情报","weight":6}。',
    `8. 如果正文里出现明确钟点、短信发送时间、来电时间，必须只使用这些允许时间：${allowedTimeLabels.join('、')}。不要编造当前上下文里不存在的时间。`,
    '',
    '   【★ 信息边界——和行动叙事一样的规则 ★】',
    '   环境线索同样不能替玩家下结论。不使用"毒品""违禁品""走私"等玩家尚不知情的定性词。',
    '   只描述外部现象：脚步声位置/节奏变化、门外对话碎片、楼道灯光/气味/声音异常。',
    '',
    ambientContext,
  ].join('\n')
    + '\n' + formatConfirmedWorldEventsPromptBlock(context.confirmedWorldEvents);
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context }, { temperature: 0.85 });
  if (!ai) throw new Error('ambient narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`ambient narration: ${parsed.error.message}`);
  return parsed.data;
}

async function reviewNarrationAi(input: {
  directorContext: DirectorContext;
  narrationContext: NarrationContext;
}) {
  const system = [
    'You are an asynchronous narration Critic for 23:47.',
    'Review the completed narration against directorContext and narrationContext confirmed facts.',
    'Your output is diagnostic only. Do not propose state changes, endings, rewrites, or player-facing mood text.',
    'Return JSON: {"score":{"pacing":0-10,"infoLeak":0-10,"ruleConsistency":0-10,"prose":0-10},"passed":true/false,"violations":["..."]}',
  ].join('\n');
  const ai = await completeRoleJson('director', system, input, { temperature: 0.2 });
  if (!ai) throw new Error('director AI returned null');
  const raw = unwrapJsonObject(ai) as Record<string, unknown>;
  const score = (raw.score && typeof raw.score === 'object' ? raw.score : {}) as Record<string, unknown>;
  return {
    score: {
      pacing: typeof score.pacing === 'number' ? score.pacing : 7,
      infoLeak: typeof score.infoLeak === 'number' ? score.infoLeak : 8,
      ruleConsistency: typeof score.ruleConsistency === 'number' ? score.ruleConsistency : 8,
      prose: typeof score.prose === 'number' ? score.prose : 7,
    },
    passed: typeof raw.passed === 'boolean' ? raw.passed : !Array.isArray(raw.violations) || raw.violations.length === 0,
    violations: Array.isArray(raw.violations) ? raw.violations.map(String) : [],
  };
}

async function npcReplyAi(speaker: NpcReply['speaker'], input: string, state: GameState): Promise<NpcReply> {
  const visibleContext = buildNpcVisibleContext(state, speaker, input);
  const ai = await completeRoleJson(
    'npc',
    [
      'Use only visibleContext. The full GameState is intentionally not provided.',
      'If visibleContext.canReference.doorActivity is false, do not mention doors, hallway activity, outside voices, door quotes, forced entry, or anyone being unable to get in.',
      'If visibleContext.canReference.policeReport and visibleContext.canReference.fakePoliceSuspicion are false, do not mention police tactics, reporting, real police, fake police, or police arrival.',
      'If speaker=linyue and only packagePhoto is known, reply only about the package photo/player message: preserve the photo, inspect delivery markings, verify source, and stay generally cautious. Do not say open-door safety advice.',
      '你是《23:47》的 NPC 回复 AI。只写当前 speaker 的即时回复，不写旁白，不推进环境，不改 GameState。',
      '你必须基于 visibleContext 和玩家 input 回复。不要使用 visibleContext 之外的信息。',
      'speaker=linyue 时，林越只能知道玩家主动发给他的内容、他自己的位置和他的既有身份经验。',
      '林越收到包裹照片时，可以说“先别拆包裹/保存照片/看寄件信息”，但不能说“别开门/别靠门缝/门外有人/警察真假”，除非 visibleContext.canReference.doorActivity 或 visibleContext.canReference.policeReport 支持。',
      'speaker=police_dispatch 时，只写接线员基于报警通话可知道的安全指令。',
      'speaker=chen_huaimin 时，只写陈怀民能观察、收到、监听、内线告知或推测到的信息，不得知道林越和警方内部动作。',
      '只输出一个 JSON 对象：{"speaker":"linyue|police_dispatch|chen_huaimin","text":"...","intent":"...","riskWarning":"...","suggestedExternalAction":"..."}',
    ].join('\n'),
    { speaker, input, visibleContext },
    { temperature: 0.55 },
  );
  const parsed = NpcReplySchema.safeParse(ai);
  if (!parsed.success) throw new Error(`npc reply schema: ${parsed.error.message}`);
  return parsed.data;
}

export function createAiHarness(options: HarnessOptions = {}) {
  return createHarness({
    parseAction: (input, state) => parseActionAi(input, state),
    chooseKillerStrategy: (killerContext) => killerStrategyAi(killerContext),
    narrateAction: (ctx) => narrateActionAi(ctx),
    narrateAmbient: (ctx) => narrateAmbientAi(ctx),
    reviewNarration: reviewNarrationAi,
    npcReply: npcReplyAi,
    npcAdapter: createNpcAdapter(),
  }, options);
}
