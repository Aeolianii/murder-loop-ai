import { NarrationSchema, NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import {
  buildNpcInboundMessages,
  buildNarratorContext,
  fallbackNpcReply,
  sanitizeNarration,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import type { ActionPlan, Narration, NpcReply, TurnResolution } from '@murder-loop-ai/shared';

export interface ConfirmedTurnNarration {
  actionNarration?: Narration;
  ambientNarration?: Narration;
  npcReply?: NpcReply;
  warnings: string[];
}

type NarrationSlot = 'actionNarration' | 'ambientNarration';

const HAN_CHARACTER = /[\u3400-\u9fff]/;
const ASCII_LETTER = /[A-Za-z]/;

function isChineseUiText(text: string): boolean {
  return HAN_CHARACTER.test(text) && !ASCII_LETTER.test(text);
}

function isChineseUiNarration(narration: Narration): boolean {
  return isChineseUiText(`${narration.title}${narration.text}`);
}

function presentationOnlyNarration(narration: Narration): Narration {
  const sanitized = sanitizeNarration(narration);
  return {
    title: sanitized.title,
    text: sanitized.text,
  };
}

function normalized(text: string) {
  return text.toLowerCase().replace(/\s+/g, '');
}

function packageContentsWereRevealed(resolution: TurnResolution): boolean {
  const domainEvents = (resolution.playerResult as TurnResolution['playerResult'] & {
    domainEvents?: Array<{ eventType: string; facts?: string[] }>;
  }).domainEvents ?? [];
  return domainEvents.some((event) => (
    event.eventType === 'package_opened'
    || event.facts?.includes('fact.package.interior.contents_revealed')
  ));
}

function confirmedFactsForTarget(resolution: TurnResolution, target: string): string[] {
  const domainEvents = (resolution.playerResult as TurnResolution['playerResult'] & {
    domainEvents?: Array<{ subject?: string; facts?: string[] }>;
  }).domainEvents ?? [];
  return domainEvents
    .filter((event) => event.subject === target)
    .flatMap((event) => event.facts ?? []);
}

function actionNarrationGroundingIssues(
  narration: Narration,
  resolution: TurnResolution,
): string[] {
  const plan = resolution.plan;
  const text = normalized(`${narration.title}\n${narration.text}`);
  const issues: string[] = [];
  const coverageRules: Partial<Record<ActionPlan['actions'][number]['intent'], RegExp>> = {
    preserve_evidence: /拍|照片|影像|photo|photograph|picture/,
    communicate: /发|发送|传给|消息|短信|联系|送达|sent|send|message|contact|deliver/,
    secure_entry: /锁|门链|插销|加固|堵门|抵住|deadbolt|lock|chain|barricad|block/,
    inspect: /检查|查看|观察|翻找|inspect|check|examin|look/,
    wait: /等|等待|倾听|保持|wait|listen/,
    pick_up: /拿|捡|拾|pick/,
    use_item: /使用|连接|插上|加固|use|connect|plug/,
  };

  for (const action of plan.actions) {
    const rule = coverageRules[action.intent];
    if (rule && !rule.test(text)) issues.push(`missing confirmed action ${action.intent}`);
    if (
      action.intent === 'communicate'
      && action.target === 'linyue'
      && !/林越|linyue/.test(text)
    ) {
      issues.push('missing confirmed recipient linyue');
    }
    if (action.intent === 'inspect') {
      const targetCoverage: Record<string, RegExp> = {
        bed: /床底|床下/,
        closet: /衣柜/,
        bathroom: /卫生间|水箱/,
        window: /窗户|窗锁/,
        front_door: /入户门|房门|门锁|门链/,
        package: /包裹/,
        package_old_book: /旧书|夹层/,
        package_medicine_blister: /药板|药片|铝箔/,
        package_numeric_note: /数字纸条|数字|纸条/,
      };
      const targetRule = action.target ? targetCoverage[action.target] : undefined;
      if (targetRule && !targetRule.test(text)) {
        issues.push(`missing confirmed inspection target ${action.target}`);
      }
      const unrelatedPackageItemRules: Partial<Record<string, RegExp>> = {
        package_old_book: /药板|药片|数字纸条/,
        package_medicine_blister: /旧书|数字纸条/,
        package_numeric_note: /旧书|药板|药片/,
      };
      const unrelatedPackageItemRule = action.target
        ? unrelatedPackageItemRules[action.target]
        : undefined;
      if (unrelatedPackageItemRule?.test(text)) {
        issues.push(`included unrelated package items for ${action.target}`);
      }
      const facts = action.target ? confirmedFactsForTarget(resolution, action.target) : [];
      const confirmsNoAnomaly = facts.some((fact) => (
        fact.endsWith('.no_anomaly') || fact.endsWith('.no_new_clue')
      ));
      if (confirmsNoAnomaly && !/没有发现|未发现|无异常|没有藏人|未见/.test(text)) {
        issues.push(`missing confirmed inspection outcome ${action.target}`);
      }
    }
  }

  const allowsPackageInterior = plan.actions.some((action) => (
    action.target === 'package'
    && action.intent === 'inspect'
    && /内部|里面|内容|interior|inside|contents?/.test(normalized(action.method ?? ''))
  ));
  if (
    !allowsPackageInterior
    && /撕开.*封|打开.*包裹|拆开.*包裹|翻开.*包裹|open(ed)?thepackage|tear.*package/.test(text)
  ) {
    issues.push('invented package opening');
  }
  if (
    packageContentsWereRevealed(resolution)
    && (!/旧书/.test(text) || !/药盒|药板|药片/.test(text) || !/纸条/.test(text))
  ) {
    issues.push('missing confirmed package contents');
  }
  return issues;
}

function actionTargetLabel(target?: string) {
  const labels: Record<string, string> = {
    package: '包裹',
    package_old_book: '包裹里的旧书',
    package_medicine_blister: '包裹里的药板',
    package_numeric_note: '包裹里的数字纸条',
    front_door: '门',
    window: '窗户',
    bed: '床底',
    closet: '衣柜',
    bathroom: '卫生间',
    room: '房间',
    phone: '手机',
    phone_charger: '手机充电器',
    chair: '椅子',
    linyue: '林越',
    lin_yue: '林越',
    police: '警方',
    police_dispatch: '警方',
    chen_huaimin: '陈怀民',
    self: '自己',
  };
  return target ? labels[target] ?? target : '目标';
}

function confirmedActionFallback(resolution: TurnResolution): Narration {
  const plan = resolution.plan;
  const packageContentsRevealed = packageContentsWereRevealed(resolution);
  if (!packageContentsRevealed && isChineseUiText(resolution.playerResult.text)) {
    return {
      title: '行动结果',
      text: resolution.playerResult.text,
    };
  }
  const parts = plan.actions.map((action) => {
    const target = actionTargetLabel(action.target);
    if (action.intent === 'preserve_evidence') {
      return action.target === 'package'
        ? '你拍下了包裹的照片'
        : `你保存了${target}相关的证据`;
    }
    if (action.intent === 'communicate') {
      return `你通过手机把消息发送给${target}`;
    }
    if (action.intent === 'secure_entry') return `你锁好并加固了${target}`;
    if (action.intent === 'inspect') {
      if (action.target === 'package' && packageContentsRevealed) {
        return '你打开并检查了包裹。纸箱里有一本被掏空的旧书、一块只剩部分药片的药板和一张数字纸条；模糊的“5-03 / 503”收件标记说明它可能不是你的。你获得了线索“包裹里的异常物品”';
      }
      if (action.target === 'bed') return '你检查了床底，没有发现可疑物品或新的线索';
      if (action.target === 'closet') return '你检查了衣柜，没有发现可疑物品或新的线索';
      if (action.target === 'bathroom') return '你检查了卫生间和水箱，没有发现可疑物品或新的线索';
      return `你检查了${target}`;
    }
    if (action.intent === 'record') return '你开始用手机记录现场';
    if (action.intent === 'call_police') return '你拨打了报警电话';
    if (action.intent === 'verify_identity') return `你通过官方渠道核实了${target}的身份`;
    if (action.intent === 'hide_evidence') return `你藏好了${target}`;
    if (action.intent === 'open_door') return '你打开了门';
    if (action.intent === 'self_care') return '你检查并处理了自己的伤势';
    if (action.intent === 'wait') return '你保持安静并继续观察';
    if (action.intent === 'escape') return '你尝试离开当前危险位置';
    if (action.intent === 'attack') return `你向${target}发起了攻击`;
    if (action.intent === 'pick_up') return `你拿起了${target}`;
    if (action.intent === 'use_item') return `你使用了${target}`;
    const raw = action.raw.trim().replace(/^(然后|接着|随后|并且|并|再)/, '');
    return /[\u4e00-\u9fff]/.test(raw) ? `你${raw}` : '你完成了一个已确认动作';
  });
  return {
    title: '行动已确认',
    text: `${parts.join('，然后')}。`,
  };
}

async function runConfirmedNpcReply(
  resolution: TurnResolution,
  adapters: AiAdapters,
): Promise<{ reply?: NpcReply; warnings: string[] }> {
  const domainEvents = (resolution.playerResult as TurnResolution['playerResult'] & {
    domainEvents?: Array<{
      eventType: string;
      subject?: string;
      facts?: string[];
      payload?: Record<string, unknown>;
    }>;
  }).domainEvents ?? [];
  const message = buildNpcInboundMessages(resolution.plan, domainEvents)
    .find((candidate) => candidate.deliveryConfirmed);
  if (!message) return { warnings: [] };

  if (!adapters.npcReply) {
    return {
      reply: fallbackNpcReply(message.speaker, message.text, resolution.finalState),
      warnings: ['post-commit npcReply adapter unavailable; deterministic fallback used.'],
    };
  }
  try {
    const parsed = NpcReplySchema.safeParse(
      await adapters.npcReply(message.speaker, message, resolution.finalState),
    );
    if (
      parsed.success
      && isChineseUiText(parsed.data.text)
      && hasValidObservedAssets(parsed.data, message)
    ) {
      return { reply: parsed.data, warnings: [] };
    }
    return {
      reply: fallbackNpcReply(message.speaker, message.text, resolution.finalState),
      warnings: [parsed.success
        ? 'post-commit npcReply returned ungrounded display text or asset references; deterministic fallback used.'
        : 'post-commit npcReply failed schema validation; deterministic fallback used.'],
    };
  } catch (error) {
    return {
      reply: fallbackNpcReply(message.speaker, message.text, resolution.finalState),
      warnings: [`post-commit npcReply failed; deterministic fallback used. ${
        error instanceof Error ? error.message : String(error)
      }`],
    };
  }
}

function hasValidObservedAssets(
  reply: NpcReply,
  message: ReturnType<typeof buildNpcInboundMessages>[number],
): boolean {
  const confirmedAssetIds = new Set(message.attachments.map((attachment) => attachment.id));
  const observedAssetIds = reply.observedAssetIds ?? [];
  if (message.attachments.length > 0 && observedAssetIds.length === 0) return false;
  if (observedAssetIds.length !== new Set(observedAssetIds).size) return false;
  return observedAssetIds.every((assetId) => confirmedAssetIds.has(assetId))
    && confirmedAssetIds.size === new Set(observedAssetIds).size;
}

function appendNpcReply(narration: Narration, reply: NpcReply): Narration {
  if (narration.text.includes(reply.text)) return narration;
  const label = reply.speaker === 'linyue'
    ? '林越回复'
    : reply.speaker === 'police_dispatch'
      ? '接线员回复'
      : '陈怀民回复';
  return {
    ...narration,
    text: `${narration.text}\n\n${label}：“${reply.text}”`,
  };
}

async function runNarratorSlot(
  slot: NarrationSlot,
  narrator: AiAdapters['narrateAction'] | AiAdapters['narrateAmbient'],
  context: ReturnType<typeof buildNarratorContext>,
): Promise<{ narration?: Narration; warnings: string[] }> {
  if (!narrator) {
    return {
      warnings: [`post-commit ${slot} adapter unavailable; confirmed material remains visible.`],
    };
  }

  try {
    const parsed = NarrationSchema.safeParse(await narrator(context));
    if (!parsed.success) {
      return {
        warnings: [`post-commit ${slot} failed schema validation; confirmed material remains visible.`],
      };
    }
    if (!isChineseUiNarration(parsed.data)) {
      return {
        warnings: [`post-commit ${slot} returned non-Chinese display text; confirmed material remains visible.`],
      };
    }
    const authorityWarnings = parsed.data.ending
      || parsed.data.isFatal
      || parsed.data.killerKilled
      || parsed.data.clue
      ? [`post-commit ${slot} authority fields ignored; narration is presentation-only.`]
      : [];
    return {
      narration: presentationOnlyNarration(parsed.data),
      warnings: authorityWarnings,
    };
  } catch (error) {
    return {
      warnings: [
        `post-commit ${slot} failed; confirmed material remains visible. ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
}

export async function narrateConfirmedTurn(
  resolution: TurnResolution,
  adapters: AiAdapters,
): Promise<ConfirmedTurnNarration> {
  const context = buildNarratorContext({
    state: resolution.finalState,
    playerResult: resolution.playerResult,
    killerResult: resolution.killerResult,
  });
  const [action, ambient, npc] = await Promise.all([
    runNarratorSlot('actionNarration', adapters.narrateAction ?? adapters.narrate, context),
    runNarratorSlot('ambientNarration', adapters.narrateAmbient ?? adapters.narrate, context),
    runConfirmedNpcReply(resolution, adapters),
  ]);

  let actionNarration = action.narration ?? confirmedActionFallback(resolution);
  if (actionNarration) {
    const groundingIssues = actionNarrationGroundingIssues(actionNarration, resolution);
    if (groundingIssues.length > 0) {
      action.warnings.push(
        `post-commit actionNarration not grounded in confirmed actions: ${groundingIssues.join(', ')}; confirmed material remains visible.`,
      );
      actionNarration = confirmedActionFallback(resolution);
    }
  }
  if (npc.reply) {
    actionNarration = appendNpcReply(
      actionNarration ?? presentationOnlyNarration(resolution.actionNarration ?? resolution.narration),
      npc.reply,
    );
  }

  return {
    actionNarration,
    ambientNarration: ambient.narration,
    npcReply: npc.reply,
    warnings: [...action.warnings, ...ambient.warnings, ...npc.warnings],
  };
}
