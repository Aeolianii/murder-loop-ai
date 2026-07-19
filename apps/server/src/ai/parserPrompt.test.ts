import assert from 'node:assert/strict';
import { buildParseSystemPrompt } from './parserPrompt';

const prompt = buildParseSystemPrompt();

assert.match(prompt, /把包裹交给\/递给\/还给房东/);
assert.match(prompt, /open_door \(target=front_door\).*communicate \(target=chen_huaimin\)/);
assert.match(prompt, /保留“玩家把包裹给房东”的动作方向/);

console.log('parserPrompt.test.ts passed');
