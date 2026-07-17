import { ActionPlanSchema, KillerStrategySchema, NarrationSchema, NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import {
  buildKillerContext,
  buildParserContext,
  createHarness,
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
  type RuleResult,
} from '@murder-loop-ai/shared';
import { buildKillerPromptPayload } from './killerPrompt';
import { completeRoleJson } from './openaiClient';
import { normalizeActionPlanJson, unwrapJsonObject } from './unwrapJsonObject';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy, verifyNarration } from './turnCoordinator';
import { formatWorldInfoPromptBlock } from './worldInfoPrompt';
import { formatConfirmedWorldEventsPromptBlock } from './worldEventPrompt';

function buildPlotContext(state: GameState, plan?: ActionPlan): string {
  const recentTitles = state.log.slice(-4).map(l => l.title).join(' / ');
  const minsToDeadline = 1427 - state.minute;
  return [
    '时间' + minuteLabel(state.minute) + '，距23:47还有' + minsToDeadline + '分钟',
    '最近回合: ' + (recentTitles || '游戏开始'),
    '本回合玩家要做: ' + (plan?.summary || '未知'),
    '避免重复最近出现过的施压方式。玩家在回复消息时优先message_reply。',
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

async function killerStrategyAi(state: GameState, plan?: ActionPlan, playerResult?: RuleResult): Promise<KillerStrategy> {
  const killerContext = buildKillerContext(state, { plan, playerResult });
  const plotCtx = buildPlotContext(state, plan);
  const killerStatusNote = state.killerStatus !== 'alive'
    ? `【重要】陈怀民当前状态：${state.killerStatus}。${state.killerStatus === 'injured' ? '他已受伤，策略应更加绝望或选择撤退。' : state.killerStatus === 'dead' ? '他已死亡，无法采取任何行动。选择 retreat。' : ''}`
    : '';
  const ai = await completeRoleJson('killer', [
    plotCtx,
    killerStatusNote,
    state.plotGuidance ? `【导演指引】${state.plotGuidance}` : '',
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
    '只输出一个裸 JSON 对象，不要包在 strategy/killerStrategy/result 字段里。',
    '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"可选，若是短信/对话则写他发来的具体话","visibleToPlayer":true,"risk":"low|medium|high"}',
  ].join('\n') + '\n' + formatWorldInfoPromptBlock(killerContext.worldInfo, 'killer'), buildKillerPromptPayload(killerContext), { temperature: 0.7 });
  if (!ai) throw new Error('killer AI returned null');
  const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
  if (!parsed.success) throw new Error(`killer schema: ${parsed.error.message}`);
  return verifyKillerStrategy(state, parsed.data, createTurnBlackboard('', state));
}

async function narrateActionAi(
  context: NarrationContext, playerResult: RuleResult,
  killerResult: RuleResult, state: GameState,
): Promise<Narration> {
  const { createFallbackActionNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackActionNarration(playerResult);
  const allowedTimeLabels = Array.from(new Set([
    minuteLabel(context.minute),
    ...context.recentLog.map((entry) => minuteLabel(entry.minute)),
  ]));
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
    '0. 动作核对：上下文中有 playerInput 字段，这是玩家本回合的原始输入。',
    '   写完后自检——叙事中描述的每一个动作，必须能对应 playerInput 中的某个动词或动作短语。',
    '   玩家输入是"我打开纸条，看看这是什么东西"→ 叙事主体必须是打开纸条、看纸条。',
    '   绝不能写成冲出门、捡地上东西、翻包裹——那些动作在 playerInput 里完全不存在。',
    '1. 如果 playerInput 和 plan.summary 描述的是两件事，以 playerInput 为准。',
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
    `【导演指引——必须遵守】${state.plotGuidance ? `\n${state.plotGuidance}` : '\n故事处于开局阶段。通过包裹/门外的线索自然引导玩家理解处境。'}`,
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
    + '\n' + formatConfirmedWorldEventsPromptBlock(context.confirmedWorldEvents)
    + '\n' + formatWorldInfoPromptBlock(context.worldInfo, 'narrator');
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context, playerResult, state }, { temperature: 0.75 });
  if (!ai) throw new Error('action narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`action narration: ${parsed.error.message}`);
  return verifyNarration(parsed.data, fallback, createTurnBlackboard('', state), 'actionNarration', {
    currentMinute: context.minute,
    allowedMinutes: [context.minute, ...context.recentLog.map((entry) => entry.minute)],
  });
}

async function narrateAmbientAi(
  context: NarrationContext, playerResult: RuleResult,
  killerResult: RuleResult, state: GameState,
): Promise<Narration> {
  const { createFallbackAmbientNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);
  const allowedTimeLabels = Array.from(new Set([
    minuteLabel(context.minute),
    ...context.recentLog.map((entry) => minuteLabel(entry.minute)),
  ]));
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
    '2. 基于 killerResult.events 写环境推进。一个事件 + 一个具体后果 + 一个钩子。',
    '2.1. 状态一致性：如果 state.doorState.barricaded 不为 true，绝对不要写椅子、行李箱、门被东西挡住、门和椅子摩擦、门缝被家具压住。反锁/门链只能阻止钥匙或开门，不能自动生成家具障碍。',
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
    + '\n' + formatConfirmedWorldEventsPromptBlock(context.confirmedWorldEvents)
    + '\n' + formatWorldInfoPromptBlock(context.worldInfo, 'narrator');
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context, killerResult, state }, { temperature: 0.85 });
  if (!ai) throw new Error('ambient narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`ambient narration: ${parsed.error.message}`);
  return verifyNarration(parsed.data, fallback, createTurnBlackboard('', state), 'ambientNarration', {
    currentMinute: context.minute,
    allowedMinutes: [context.minute, ...context.recentLog.map((entry) => entry.minute)],
  });
}

async function reviewNarrationAi(input: {
  narration: Narration;
  actionNarration: Narration;
  ambientNarration: Narration;
  state: GameState;
  narrationContext?: NarrationContext;
  playerResult?: RuleResult;
  killerResult?: RuleResult;
}) {
  const system = [
    '???23:47????/???? AI????????????????????????',
    '??? narrationContext?playerResult?killerResult?state ???????????????????',
    '??????????????????????/????/NPC ?????????????????????????????????',
    '????????? violations ? moodSignal??????????',
    '??? JSON?{"score":{"pacing":0-10,"infoLeak":0-10,"ruleConsistency":0-10,"prose":0-10},"passed":true/false,"violations":["..."],"moodSignal":"..."}',
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
    moodSignal: typeof raw.moodSignal === 'string' ? raw.moodSignal : undefined,
  };
}

async function npcReplyAi(speaker: NpcReply['speaker'], input: string, state: GameState): Promise<NpcReply> {
  const ai = await completeRoleJson(
    'npc',
    [
      '你是《23:47》的 NPC 回复 AI。只写当前 speaker 的即时回复，不写旁白，不推进环境，不改 GameState。',
      '你必须基于 visibleState 和玩家 input 回复。不要把一个 NPC 的信息写成另一个 NPC 的口吻。',
      'speaker=linyue 时，林越是楼下的外部协助者：他说话要直白、短句、可执行。',
      '如果 visibleState.policePhase 不是 not_contacted，或 input 提到警察、报警、警服、楼下、假警察、冒充警察，林越必须明确说：不太对劲，可能是假警察或冒充警察。',
      '林越应建议：玩家不要开门，不要贴门缝，保持门窗反锁；通过官方回拨/真警察核实身份；林越留在楼下，把照片、位置和异常情况交给真警察。',
      '林越不得说自己上楼、不得让玩家开门确认、不得把回复写成陈怀民的威胁或楼道环境描写。',
      'speaker=police_dispatch 时，只写接线员指令：保持通话、不开门、等待官方核实和出警。',
      'speaker=chen_huaimin 时，只写陈怀民能观察/推测到的信息，不得知道林越和警方内部动作。',
      '只输出一个 JSON 对象：{"speaker":"linyue|police_dispatch|chen_huaimin","text":"...","intent":"...","riskWarning":"...","suggestedExternalAction":"..."}',
    ].join('\n'),
    { speaker, input, visibleState: state },
    { temperature: 0.55 },
  );
  const parsed = NpcReplySchema.safeParse(ai);
  if (!parsed.success) throw new Error(`npc reply schema: ${parsed.error.message}`);
  return parsed.data;
}

export function createAiHarness(options: HarnessOptions = {}) {
  return createHarness({
    parseAction: (input, state) => parseActionAi(input, state),
    chooseKillerStrategy: (state, plan, playerResult) => killerStrategyAi(state, plan, playerResult),
    narrateAction: (ctx, pr, kr, st) => narrateActionAi(ctx, pr, kr, st),
    narrateAmbient: (ctx, pr, kr, st) => narrateAmbientAi(ctx, pr, kr, st),
    reviewNarration: reviewNarrationAi,
    npcReply: npcReplyAi,
  }, options);
}
