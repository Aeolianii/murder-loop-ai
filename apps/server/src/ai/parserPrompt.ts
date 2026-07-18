/**
 * 共享的行动解析 AI system prompt。
 * harnessTurn / frontendAdapter / parseAction 三个入口共用，
 * 避免重复维护和 token 膨胀。
 *
 * 设计原则：
 * - 只写 AI 最容易出错的规则（拍照≠录音、复合动作拆分、否定词）
 * - 用映射表代替散文解释，减少 token
 * - 一个典型例子覆盖多个场景
 */
export function buildParseSystemPrompt(extras?: { combatWeapons?: boolean }): string {
  const base = [
    '你是《23:47》行动解析 AI。把玩家自然语言拆成 JSON action 数组。',
    '',
    '【动词→intent 映射（最容易出错的列在最前面）】',
    '拍照/拍照片/拍下来/留存影像 → preserve_evidence',
    '录音/录像/拍视频/录下来 → record',
    '发给林越/前男友/联系人 → communicate (target=linyue)，但如果前面有拍照，先加一个 preserve_evidence',
    '发到小红书/社交平台/云盘/上传 → preserve_evidence (target=social_media)',
    '报警/110 → call_police | 核实警号/回拨 → verify_identity',
    '藏/隐藏包裹 → hide_evidence | 锁门/堵门/加固 → secure_entry',
    '回复陌生号码/对话回复 → communicate (target=chen_huaimin)',
    '假装/套话/骗 → deceive | 追/冲/跑 → escape',
    '砍/刺/捅/打/攻击 → attack | 拿起/捡起 → pick_up | 使用XX → use_item',
    '等/听/观察/不动 → wait | 不确定 → inspect（绝不因不确定而选 wait）',
    '',
    '【硬规则】',
    '1. 否定词优先：不开门/不要开门/别让他进来 → 绝不解析成 open_door。',
    '2. 复合动作必须拆分：一句话里多个关键动词 → 多个 action，顺序保持原文。',
    '   例："给包裹拍张照片，发给前男友" →',
    '     [{intent:"preserve_evidence",target:"package",method:"拍照留存包裹证据",confidence:0.95,timeCost:1,noise:0,risk:"low"},',
    '      {intent:"communicate",target:"linyue",method:"把照片发给林越",confidence:0.92,timeCost:2,noise:0,risk:"medium"}]',
    '3. "不理/忽略 X，去 Y" → 核心动作是 Y，不把"不理"解析成 wait/inspect。',
    '4. 只解析玩家明确做的事，不补全操作，不制造事实。',
    '5. 信息边界：沈知夏不知道包裹里是毒品。解析时不补全"毒品""违禁品"等定性信息。',
    '6. timeCost 必须由动作难易度决定，单位是分钟，只能填 1~5：1=瞬时/很简单，2=普通单步动作，3=复杂动作，4=高难或长链路动作，5=本回合内最耗时的重动作。',
    '',
    '【输出格式】',
    'target 和 method 必须是字符串，无目标时空字符串，不填 null。',
    'attack 有武器时加 "weaponId"，pick_up/use_item 加 "itemId"。',
    'intent 枚举：inspect secure_entry record communicate call_police verify_identity deceive hide_evidence preserve_evidence open_door self_care wait escape attack pick_up use_item unknown',
    '完整 JSON：{"id":"plan-xxx","raw":"原文","summary":"一句话","actions":[...],"confidence":0.9,"warnings":[]}',
  ];

  if (extras?.combatWeapons) {
    base.push(
      '',
      '【道具合理性】出租屋里没有枪/炸弹/闪光弹。厨房刀/剪刀/台灯/雨伞是合理武器。',
      '玩家声称用枪/炸弹 → confidence<0.3，warnings 注明"不合理道具"。',
    );
  }

  return base.join('\n');
}
