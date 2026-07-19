import { describe, expect, test } from 'vitest';
import { fallbackParseAction } from './fallbackParser';

describe('fallbackParseAction - 拍照 vs 录音 distinction', () => {
  test('给包裹拍张照片 → preserve_evidence, not record', () => {
    const result = fallbackParseAction('给包裹拍张照片');
    const intents = result.actions.map(a => a.intent);
    expect(intents).toContain('preserve_evidence');
    expect(intents).not.toContain('record');
    // Should not generate duplicate preserve_evidence actions for the same photo
    const preserveActions = result.actions.filter(a => a.intent === 'preserve_evidence');
    expect(preserveActions.length).toBe(1);
  });

  test('拍照 without 包裹 → preserve_evidence/phone', () => {
    const result = fallbackParseAction('用手机拍下照片留证');
    const photoAction = result.actions.find(a => a.intent === 'preserve_evidence');
    expect(photoAction).toBeDefined();
    expect(photoAction!.target).toBe('phone');
  });

  test('打开手机录音 → record', () => {
    const result = fallbackParseAction('打开手机录音');
    expect(result.actions.some(a => a.intent === 'record')).toBe(true);
    expect(result.actions.some(a => a.intent === 'preserve_evidence')).toBe(false);
  });

  test('录像 → record, not preserve_evidence', () => {
    const result = fallbackParseAction('打开手机录像功能');
    expect(result.actions.some(a => a.intent === 'record')).toBe(true);
    expect(result.actions.some(a => a.intent === 'preserve_evidence')).toBe(false);
  });

  test('拍照备份包裹 → preserve_evidence only once', () => {
    const result = fallbackParseAction('给包裹拍照备份到云盘');
    const preserveActions = result.actions.filter(a => a.intent === 'preserve_evidence');
    expect(preserveActions.length).toBe(1);
  });
});

describe('fallbackParseAction - 复合动作分解', () => {
  test('悄悄把门锁上 → secure_entry/front_door, not inspect/front_door', () => {
    const result = fallbackParseAction('悄悄把门锁上');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ intent: 'secure_entry', target: 'front_door' });
    expect(result.actions[0].noise).toBe(1);
  });

  test('悄悄把门锁上并翻找检查包裹 → secure_entry/front_door + inspect/package in order', () => {
    const result = fallbackParseAction('悄悄把门锁上并翻找检查包裹');
    expect(result.actions.map(a => [a.intent, a.target])).toEqual([
      ['secure_entry', 'front_door'],
      ['inspect', 'package'],
    ]);
  });

  test('给包裹拍照发给林越 → preserve_evidence + communicate/linyue', () => {
    const result = fallbackParseAction('我给包裹拍了照片，发送给林越');
    expect(result.actions.some(a => a.intent === 'preserve_evidence')).toBe(true);
    expect(result.actions.some(a => a.intent === 'communicate' && a.target === 'linyue')).toBe(true);
    // preserve_evidence 应该在 communicate 前面（拍照先于发送）
    const preserveIdx = result.actions.findIndex(a => a.intent === 'preserve_evidence');
    const commIdx = result.actions.findIndex(a => a.intent === 'communicate');
    expect(preserveIdx).toBeLessThan(commIdx);
  });

  test('拍照发给林越 → 两个独立 action', () => {
    const result = fallbackParseAction('给包裹拍张照片，发给林越');
    const preserveActions = result.actions.filter(a => a.intent === 'preserve_evidence');
    const commActions = result.actions.filter(a => a.intent === 'communicate' && a.target === 'linyue');
    expect(preserveActions.length).toBeGreaterThanOrEqual(1);
    expect(commActions.length).toBeGreaterThanOrEqual(1);
  });

  test('拍照发到小红书 → 只有 preserve_evidence/social_media', () => {
    const result = fallbackParseAction('把包裹照片发到小红书上');
    expect(result.actions.some(a => a.intent === 'preserve_evidence' && a.target === 'social_media')).toBe(true);
    // 发到平台不是发给联系人，不应有 communicate
    expect(result.actions.some(a => a.intent === 'communicate')).toBe(false);
  });

  test('开门把包裹给房东 → open_door + communicate/chen_huaimin, not inspect/package', () => {
    const result = fallbackParseAction('开门把包裹给房东');

    expect(result.actions.map(a => [a.intent, a.target])).toEqual([
      ['open_door', 'front_door'],
      ['communicate', 'chen_huaimin'],
    ]);
    expect(result.actions.some(a => a.intent === 'inspect' && a.target === 'package')).toBe(false);
    expect(result.actions[1]?.method).toContain('把包裹交给');
  });
});
