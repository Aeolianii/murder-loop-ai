import assert from 'node:assert/strict';
import { createKeyPicker, parseApiKeys } from './apiKeyPool';

const keys = parseApiKeys(' key-a, key-b\nkey-c ,, ');
assert.deepEqual(keys, ['key-a', 'key-b', 'key-c'], 'parseApiKeys should trim separators and discard empty entries');

const pickKey = createKeyPicker(['pool-1', 'pool-2', 'pool-3']);
assert.equal(pickKey('deepseek'), 'pool-1', 'first deepseek call should use first pooled key');
assert.equal(pickKey('deepseek'), 'pool-2', 'second deepseek call should rotate to second pooled key');
assert.equal(pickKey('deepseek_killer', 'role-key'), 'role-key', 'explicit role key should take priority');
assert.equal(pickKey('deepseek_narrator'), 'pool-3', 'role key usage should not advance the shared pool');
assert.equal(pickKey('deepseek_recap'), 'pool-1', 'pool should wrap around after the final key');

console.log('apiKeyPool tests passed');
