import type { Narration, RuleResult } from '@murder-loop-ai/shared';
import { clueBook } from '@murder-loop-ai/content';

function normalizeForCompare(text: string) {
  return text
    .replace(/[\s\n\r\t]+/g, '')
    .replace(/[，。！？、；：“”‘’《》（）()\[\]【】.,!?;:'"-]/g, '')
    .trim();
}

function splitSentences(paragraph: string) {
  const matches = paragraph.match(/[^。！？!?]+[。！？!?]?/g);
  return matches?.map((sentence) => sentence.trim()).filter(Boolean) ?? [paragraph.trim()].filter(Boolean);
}

function uniqueSentences(paragraph: string) {
  const seen = new Set<string>();
  const sentences: string[] = [];

  for (const sentence of splitSentences(paragraph)) {
    const key = normalizeForCompare(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sentences.push(sentence);
  }

  return sentences.join('');
}

export function sanitizeNarration(narration: Narration): Narration {
  const seenParagraphs = new Set<string>();
  const paragraphs: string[] = [];

  for (const raw of narration.text.split(/\n{2,}/)) {
    const paragraph = uniqueSentences(raw.replace(/\n+/g, ' ').trim());
    const key = normalizeForCompare(paragraph);
    if (!key || seenParagraphs.has(key)) continue;
    seenParagraphs.add(key);
    paragraphs.push(paragraph);
  }

  return {
    ...narration,
    title: narration.title.trim(),
    text: paragraphs.join('\n\n').trim(),
  };
}

function isSystemLikeSummary(text: string) {
  return /威胁变化|危险值|threatDelta|timePassed|时间推进\s*\d|推进\s*\d\s*分钟|当前时间\s*\d/.test(text);
}

function removeInternalIds(text: string) {
  return text.replace(/新增线索：([a-z_]+)/g, (_, id: string) => {
    const clue = clueBook[id];
    return clue ? `新的线索被记下：${clue.title}` : '新的线索被记下';
  });
}

function polishRuleText(text: string) {
  return removeInternalIds(text)
    .replace(/；/g, '。')
    .replace(/\s+新增线索/g, '\n\n新增线索')
    .replace(/\s+墙上的电子钟/g, '\n\n墙上的电子钟')
    .replace(/打开手机录音或录像/g, '手机录音界面亮起，红点开始一下一下闪')
    .replace(/观察门外和门锁状态/g, '我贴近猫眼，先看楼道，再去看锁芯边缘')
    .replace(/打开入户门/g, '门被主动打开')
    .trim();
}

export function createFallbackNarration(playerResult: RuleResult, killerResult: RuleResult): Narration {
  const title = killerResult.tone === 'death' ? killerResult.title : playerResult.title;
  const eventText = [...playerResult.events, ...killerResult.events]
    .filter((item) => item.visibility !== 'hidden')
    .map((item) => item.summary)
    .filter((summary) => Boolean(summary) && !isSystemLikeSummary(summary))
    .slice(0, 5)
    .join('\n');
  const text = eventText || '房间继续保持安静，但电子钟没有停。门、窗、手机和证据的位置都需要重新确认。';

  return sanitizeNarration({ title, text });
}

export function createFallbackActionNarration(playerResult: RuleResult): Narration {
  const eventText = playerResult.text || playerResult.events
    .filter((item) => item.visibility !== 'hidden')
    .map((item) => item.summary)
    .filter((summary) => Boolean(summary) && !isSystemLikeSummary(summary))
    .slice(0, 4)
    .join('\n');

  return sanitizeNarration({
    title: playerResult.title,
    text: polishRuleText(eventText || '这个动作暂时没有改变关键事实。门、窗、手机和包裹仍在原位，下一步还需要继续确认。'),
  });
}

export function createFallbackAmbientNarration(ambientResult: RuleResult, killerResult: RuleResult): Narration {
  const sourceEvents = killerResult.events.length ? killerResult.events : ambientResult.events;
  const eventText = sourceEvents
    .filter((item) => item.visibility !== 'hidden')
    .map((item) => item.summary)
    .filter((summary) => Boolean(summary) && !isSystemLikeSummary(summary))
    .slice(0, 4)
    .join('\n');

  return sanitizeNarration({
    title: killerResult.tone === 'death' ? killerResult.title : killerResult.title || ambientResult.title,
    text: polishRuleText(eventText || '电子钟往前跳了一格。楼道、电器底噪和雨声还在变化，门外的安静没有离开这一层。'),
  });
}
