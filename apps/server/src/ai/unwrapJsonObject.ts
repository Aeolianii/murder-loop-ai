/**
 * 从 AI 返回的原始文本中提取 JSON 子串。
 * 处理三种常见情况：
 * 1. 纯 JSON 文本（直接返回）
 * 2. Markdown 代码块包裹（```json ... ```）
 * 3. 文本中嵌入了 JSON 对象（提取第一个完整的花括号/方括号块）
 *
 * 返回可被 JSON.parse 的字符串，或 null。
 */
export function extractJson(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. 尝试直接解析（最快路径）
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    /* 继续尝试提取 */
  }

  // 2. 从 Markdown 代码块中提取
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      /* 继续 */
    }
  }

  // 3. 找第一个完整的 { } 或 [ ] 块（处理字符串转义）
  const extracted = extractBracedBlock(trimmed);
  if (extracted) {
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      /* 继续 */
    }
  }

  return null;
}

/**
 * 从文本中提取第一个完整的花括号或方括号 JSON 块。
 * 正确处理 JSON 字符串内的转义字符。
 */
function extractBracedBlock(text: string): string | null {
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  let start: number;
  let openChar: string;
  let closeChar: string;

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    start = firstBrace;
    openChar = '{';
    closeChar = '}';
  } else if (firstBracket >= 0) {
    start = firstBracket;
    openChar = '[';
    closeChar = ']';
  } else {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function unwrapJsonObject<T = unknown>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  for (const key of ['strategy', 'killerStrategy', 'result', 'data']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as T;
    }
  }

  return value;
}

export function normalizeActionPlanJson<T = unknown>(value: T): T {
  const unwrapped = unwrapJsonObject(value);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return unwrapped;

  const plan = unwrapped as Record<string, unknown>;
  if (!Array.isArray(plan.actions)) return unwrapped;

  return {
    ...plan,
    actions: plan.actions.map((action, index) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) return action;
      const record = action as Record<string, unknown>;
      return {
        ...record,
        id: record.id ?? `act-${index + 1}`,
        raw: record.raw ?? plan.raw ?? '',
        target: record.target ?? '',
        method: record.method ?? '',
        timeCost: clampNumericLevel(normalizeNumericLevel(record.timeCost, 1), 1, 5),
        noise: normalizeNumericLevel(record.noise, 0),
      };
    }),
  } as T;
}

function clampNumericLevel(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeNumericLevel(value: unknown, fallback: number) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const compact = value.trim().toLowerCase();
    if (compact === 'none' || compact === 'silent') return 0;
    if (compact === 'low') return fallback === 0 ? 0 : 1;
    if (compact === 'medium') return fallback === 0 ? 2 : 2;
    if (compact === 'high') return fallback === 0 ? 4 : 5;
  }
  return fallback;
}
