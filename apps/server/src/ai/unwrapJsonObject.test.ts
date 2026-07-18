import { describe, expect, test } from 'vitest';
import { extractJson } from './unwrapJsonObject';

describe('extractJson', () => {
  test('纯 JSON 对象', () => {
    const input = '{"actions":[],"confidence":0.9}';
    const result = extractJson(input);
    expect(result).toBe(input);
    expect(() => JSON.parse(result!)).not.toThrow();
  });

  test('纯 JSON 数组', () => {
    const input = '[{"a":1},{"b":2}]';
    const result = extractJson(input);
    expect(result).toBe(input);
  });

  test('Markdown 代码块包裹（带 json 标记）', () => {
    const input = '```json\n{"actions":[],"confidence":0.9}\n```';
    const result = extractJson(input);
    expect(result).toBe('{"actions":[],"confidence":0.9}');
  });

  test('Markdown 代码块包裹（无语言标记）', () => {
    const input = '```\n{"result":"ok"}\n```';
    const result = extractJson(input);
    expect(result).toBe('{"result":"ok"}');
  });

  test('文本中嵌入 JSON 对象', () => {
    const input = '好的，以下是解析结果：\n{"intent":"preserve_evidence","target":"package"}';
    const result = extractJson(input);
    expect(result).toBe('{"intent":"preserve_evidence","target":"package"}');
  });

  test('JSON 内包含转义字符', () => {
    const input = '{"text":"他说\\"不开门\\"","value":1}';
    const result = extractJson(input);
    expect(result).toBe(input);
    const parsed = JSON.parse(result!);
    expect(parsed.text).toBe('他说"不开门"');
  });

  test('JSON 字符串内包含花括号不应干扰提取', () => {
    const input = '前文{"key":"value {inside} string","nested":{"a":1}}后文';
    const result = extractJson(input);
    expect(result).toBe('{"key":"value {inside} string","nested":{"a":1}}');
  });

  test('嵌套花括号正确匹配', () => {
    const input = '{"outer":{"inner":[1,2,3]},"other":true}';
    const result = extractJson(input);
    expect(result).toBe(input);
  });

  test('空输入返回 null', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('   ')).toBeNull();
    expect(extractJson('not json at all')).toBeNull();
  });

  test('JSON 内包含中文', () => {
    const input = '{"title":"照片留下来了","detail":"快递面单被拍照留存","weight":8}';
    const result = extractJson(input);
    expect(result).toBe(input);
    const parsed = JSON.parse(result!);
    expect(parsed.title).toBe('照片留下来了');
  });

  test('DeepSeek 风格：JSON 前后有说明', () => {
    const input = `根据您的输入，我解析出以下动作方案：

{"id":"plan-123","raw":"给包裹拍张照片","summary":"拍照保存包裹证据","actions":[{"id":"act-1","raw":"给包裹拍张照片","intent":"preserve_evidence","target":"package","method":"拍照备份包裹","confidence":0.95,"timeCost":1,"noise":0,"risk":"low"}],"confidence":0.95,"warnings":[]}

以上方案已按照规则解析，没有补全额外操作。`;
    const result = extractJson(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.actions[0].intent).toBe('preserve_evidence');
  });
});
