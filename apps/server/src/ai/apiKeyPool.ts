import type { AiProvider } from './roleConfig';

export function parseApiKeys(value: string | undefined) {
  return (value || '')
    .split(/[\n,]+/)
    .map((key) => key.trim())
    .filter(Boolean);
}

export function createKeyPicker(pooledKeys: string[]) {
  let nextIndex = 0;

  return function pickKey(provider: AiProvider, explicitKey = '') {
    if (explicitKey) return explicitKey;
    if (!provider.startsWith('deepseek') || pooledKeys.length === 0) return '';

    const key = pooledKeys[nextIndex % pooledKeys.length];
    nextIndex += 1;
    return key;
  };
}
