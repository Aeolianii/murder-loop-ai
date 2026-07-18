import { minuteLabel, type ActionPlan, type GameState, type KillerStrategy, type Narration } from '@murder-loop-ai/shared';

export interface TurnBlackboard {
  input: string;
  warnings: string[];
  facts: {
    beforeMinute: number;
    beforePhase: GameState['phase'];
    beforeThreat: number;
    knownClues: string[];
  };
  artifacts: {
    actionPlan?: ActionPlan;
    killerStrategy?: KillerStrategy;
    actionNarration?: Narration;
    ambientNarration?: Narration;
  };
  directorScores: DirectorScore[];
}

const forbiddenMetaWords = ['ActionPlanSchema', 'KillerStrategySchema', 'NarrationSchema', 'fallback', 'GameState', 'threatDelta', 'timePassed'];

export interface DirectorScore {
  slot: 'action' | 'ambient';
  total: number;
  pace: number;
  infoSafety: number;
  ruleConsistency: number;
  prose: number;
  verdict: 'pass' | 'rewrite';
  issues: string[];
  rewriteBrief: string;
  source: 'heuristic' | 'ai' | 'ai_rewrite';
}

export function createTurnBlackboard(input: string, state: GameState): TurnBlackboard {
  return {
    input,
    warnings: [],
    facts: {
      beforeMinute: state.minute,
      beforePhase: state.phase,
      beforeThreat: state.threat,
      knownClues: state.clues.map(c => c.id),
    },
    artifacts: {},
    directorScores: [],
  };
}

function normalized(text: string) {
  return text.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '');
}

function hasOpenDoorNegation(input: string) {
  const text = normalized(input);
  return [
    '不开门',
    '不要开门',
    '别开门',
    '不能开门',
    '先不开门',
    '暂不开门',
    '不直接开门',
    '不要直接开门',
    '不打开门',
    '不要打开门',
    '不给他开门',
    '绝不开门',
    '不让他进来',
    '别让他进来',
    '不要让他进来',
  ].some((word) => text.includes(word));
}

function hasSelfInjuryCheck(input: string) {
  const text = normalized(input);
  const bodyCue = /后脑勺|后脑|脑勺|头部|额头|脖子|身体|身上|伤口|伤|血|流血|出血|疼|痛/.test(text);
  const checkCue = /摸|检查|确认|看看|查看|碰|按|擦|处理|包扎/.test(text);
  return bodyCue && checkCue;
}

function planAlreadyHandlesSelfCare(plan: ActionPlan) {
  return plan.actions.some((action) => action.intent === 'self_care' && action.target === 'self');
}

export function verifyActionPlan(input: string, plan: ActionPlan, blackboard: TurnBlackboard): ActionPlan {
  if (hasSelfInjuryCheck(input) && !planAlreadyHandlesSelfCare(plan)) {
    blackboard.warnings.push('action plan verifier flagged a possible self-injury check, but did not rewrite the AI plan.');
  }

  if (hasOpenDoorNegation(input) && plan.actions.some((action) => action.intent === 'open_door')) {
    blackboard.warnings.push('action plan verifier flagged an open_door action that conflicts with the player\'s negation, but did not rewrite the AI plan.');
  }

  blackboard.artifacts.actionPlan = plan;
  return plan;
}

export function verifyKillerStrategy(state: GameState, strategy: KillerStrategy, blackboard: TurnBlackboard): KillerStrategy {
  if (strategy.type === 'spare_key_entry' && Boolean(state.room.front_door.state.barricaded)) {
    blackboard.warnings.push('killer strategy verifier flagged spare_key_entry against a barricaded door, but did not rewrite the AI strategy.');
  }

  blackboard.artifacts.killerStrategy = strategy;
  return strategy;
}

interface VerifyNarrationOptions {
  currentMinute?: number;
  allowedMinutes?: number[];
}

function normalizeClockLabel(label: string) {
  const [hour, minute] = label.split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function extractClockLabels(text: string) {
  const matches = text.match(/(?:^|[^\d])((?:[01]?\d|2[0-3]):[0-5]\d)(?!\d)/g) ?? [];
  return matches
    .map((match) => {
      const direct = match.match(/((?:[01]?\d|2[0-3]):[0-5]\d)/);
      return direct ? normalizeClockLabel(direct[1]) : null;
    })
    .filter((value): value is string => Boolean(value));
}

function buildAllowedClockLabels(options: VerifyNarrationOptions) {
  const labels = new Set<string>();
  if (options.currentMinute !== undefined) {
    labels.add(minuteLabel(options.currentMinute));
  }
  for (const minute of options.allowedMinutes ?? []) {
    labels.add(minuteLabel(minute));
  }
  return labels;
}

export function verifyNarration(
  narration: Narration,
  fallback: Narration,
  blackboard: TurnBlackboard,
  slot: 'actionNarration' | 'ambientNarration',
  options: VerifyNarrationOptions = {},
): Narration {
  let checkedNarration = narration;
  const allowedClockLabels = buildAllowedClockLabels(options);
  const clockLabels = Array.from(new Set(extractClockLabels(`${narration.title}\n${narration.text}`)));
  const invalidClockLabels = clockLabels.filter((label) => !allowedClockLabels.has(label));

  if (invalidClockLabels.length > 0) {
    const currentLabel = options.currentMinute !== undefined ? minuteLabel(options.currentMinute) : null;
    if (currentLabel && clockLabels.length === 1) {
      const wrongLabel = invalidClockLabels[0];
      checkedNarration = {
        ...narration,
        title: narration.title.replaceAll(wrongLabel, currentLabel),
        text: narration.text.replaceAll(wrongLabel, currentLabel),
      };
      blackboard.warnings.push(`${slot} 叙事出现时间漂移，已自动从 ${wrongLabel} 校正为 ${currentLabel}。`);
    } else {
      blackboard.warnings.push(`${slot} 叙事出现与当前上下文不匹配的绝对时间（${invalidClockLabels.join(', ')}），已回退到 fallback 文本。`);
      blackboard.artifacts[slot] = fallback;
      return fallback;
    }
  }

  const text = `${checkedNarration.title}\n${checkedNarration.text}`;
  const hasMetaLeak = forbiddenMetaWords.some((word) => text.includes(word));
  const hasInternalId = /\b[a-z]+_[a-z_]+\b/.test(text);

  if (!hasMetaLeak && !hasInternalId) {
    blackboard.artifacts[slot] = checkedNarration;
    return checkedNarration;
  }

  blackboard.warnings.push(`${slot} 验证器检测到开发词或内部 id 泄漏，但保留 AI 原始叙事。`);
  blackboard.artifacts[slot] = checkedNarration;
  return checkedNarration;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function heuristicDirectorScore(
  narration: Narration,
  slot: DirectorScore['slot'],
  contextText: string,
  source: DirectorScore['source'] = 'heuristic',
): DirectorScore {
  const text = `${narration.title}\n${narration.text}`;
  const compact = normalized(text);
  const issues: string[] = [];
  let pace = 86;
  let infoSafety = 92;
  let ruleConsistency = 92;
  let prose = 86;

  if (forbiddenMetaWords.some((word) => text.includes(word)) || /\b[a-z]+_[a-z_]+\b/.test(text)) {
    issues.push('叙事泄漏了开发词、schema 名或内部 id。');
    infoSafety -= 45;
    prose -= 25;
  }

  if (/规则|系统|判定|数值|接口|JSON|schema|AI/.test(text)) {
    issues.push('叙事出现了开发/系统视角词汇。');
    infoSafety -= 25;
    prose -= 20;
  }

  if (/我明白|我意识到|我知道他|他心里|凶手想|陈怀民心/.test(text)) {
    issues.push('叙事越过限知视角，替玩家或凶手解释心理。');
    infoSafety -= 22;
    ruleConsistency -= 15;
  }

  // 信息边界：沈知夏开局不知道包裹里是毒品——叙事/clue 不能替她下结论
  if (/毒品|冰毒|海洛因|违禁品|走私货|贩毒/.test(text)) {
    issues.push('叙事或线索过早出现了玩家尚不知情的定性词（毒品/违禁品/走私等）。');
    infoSafety -= 40;
    ruleConsistency -= 25;
  }

  if (slot === 'action') {
    if (text.length < 120) {
      issues.push('行动回应太短，缺少动作落地和后果。');
      pace -= 18;
      prose -= 18;
    }
    if (text.length > 700) {
      issues.push('行动回应过长，影响回合节奏。');
      pace -= 20;
    }
    if (!/[门锁猫眼手机包裹窗楼道录音照片脚步]/.test(text)) {
      issues.push('行动回应缺少可感知物体或现场细节。');
      prose -= 16;
    }
  } else {
    if (text.length < 60) {
      issues.push('环境播报太短，压力点不足。');
      pace -= 15;
    }
    if (text.length > 320) {
      issues.push('环境播报过长，不像镜头切换。');
      pace -= 25;
    }
    if (/我先|我要|我把|玩家|动作/.test(text)) {
      issues.push('环境播报复述了玩家行动，应只写外部变化。');
      pace -= 15;
      prose -= 12;
    }
  }

  for (const phrase of ['陈怀民', '警察', '林越', '窗', '包裹']) {
    if (compact.includes(normalized(phrase)) && !normalized(contextText).includes(normalized(phrase))) {
      issues.push(`叙事提到了上下文事件中不明显支持的“${phrase}”。`);
      ruleConsistency -= 10;
    }
  }

  const total = clampScore(pace * 0.22 + infoSafety * 0.3 + ruleConsistency * 0.28 + prose * 0.2);
  return {
    slot,
    total,
    pace: clampScore(pace),
    infoSafety: clampScore(infoSafety),
    ruleConsistency: clampScore(ruleConsistency),
    prose: clampScore(prose),
    verdict: total < 78 ? 'rewrite' : 'pass',
    issues,
    rewriteBrief: issues.length
      ? `重写时修复：${issues.join(' ')}保持只使用规则事件，写得更具体、有镜头感。`
      : '质量达标，无需重写。',
    source,
  };
}
