import { NarrationSchema, NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import {
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

function actionNarrationGroundingIssues(narration: Narration, plan: ActionPlan): string[] {
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
  return issues;
}

function npcSpeaker(target?: string): NpcReply['speaker'] | undefined {
  if (target === 'linyue' || target === 'lin_yue') return 'linyue';
  if (target === 'police_dispatch' || target === 'real_police') return 'police_dispatch';
  if (target === 'chen_huaimin') return 'chen_huaimin';
  return undefined;
}

function hasConfirmedDelivery(resolution: TurnResolution, speaker: NpcReply['speaker']) {
  const events = (resolution.playerResult as TurnResolution['playerResult'] & {
    domainEvents?: Array<{ eventType: string; subject: string }>;
  }).domainEvents ?? [];
  return events.some((event) => (
    (event.eventType === 'message_delivered' || event.eventType === 'photo_sent_to_linyue')
    && npcSpeaker(event.subject) === speaker
  ));
}

async function runConfirmedNpcReply(
  resolution: TurnResolution,
  adapters: AiAdapters,
): Promise<{ reply?: NpcReply; warnings: string[] }> {
  const action = resolution.plan.actions.find((candidate) => (
    candidate.intent === 'communicate' && npcSpeaker(candidate.target) !== undefined
  ));
  const speaker = npcSpeaker(action?.target);
  if (!action || !speaker || !hasConfirmedDelivery(resolution, speaker)) return { warnings: [] };

  const input = action.raw ?? action.method ?? resolution.plan.raw;
  if (!adapters.npcReply) {
    return {
      reply: fallbackNpcReply(speaker, input, resolution.finalState),
      warnings: ['post-commit npcReply adapter unavailable; deterministic fallback used.'],
    };
  }
  try {
    const parsed = NpcReplySchema.safeParse(await adapters.npcReply(speaker, input, resolution.finalState));
    if (parsed.success) return { reply: parsed.data, warnings: [] };
    return {
      reply: fallbackNpcReply(speaker, input, resolution.finalState),
      warnings: ['post-commit npcReply failed schema validation; deterministic fallback used.'],
    };
  } catch (error) {
    return {
      reply: fallbackNpcReply(speaker, input, resolution.finalState),
      warnings: [`post-commit npcReply failed; deterministic fallback used. ${
        error instanceof Error ? error.message : String(error)
      }`],
    };
  }
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

  let actionNarration = action.narration;
  if (actionNarration) {
    const groundingIssues = actionNarrationGroundingIssues(actionNarration, resolution.plan);
    if (groundingIssues.length > 0) {
      action.warnings.push(
        `post-commit actionNarration not grounded in confirmed actions: ${groundingIssues.join(', ')}; confirmed material remains visible.`,
      );
      actionNarration = undefined;
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
