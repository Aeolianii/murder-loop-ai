import assert from 'node:assert/strict';
import { buildActionNarrationSystemPrompt } from './actionNarrationPrompt';

const prompt = buildActionNarrationSystemPrompt({
  allowedTimeLabels: ['23:03'],
  confirmedWorldEventsBlock: 'CONFIRMED EVENTS',
});

assert.match(prompt, /只转述本回合已经确认的动作和直接后果/);
assert.match(prompt, /不承担推进剧情/);
assert.match(prompt, /没有产生新线索时，不需要强行制造线索或新问题/);
assert.match(prompt, /每个动作、物品、人物和后果都必须能由 confirmedFacts 支持/);
assert.match(prompt, /所有面向玩家的 title、text 和 clue 文案必须使用简体中文/);

assert.doesNotMatch(prompt, /我打开纸条|玩家在锁门|书脊\/包裹\/纸条/);
assert.doesNotMatch(prompt, /每段叙事必须让调查前进一步/);
assert.doesNotMatch(prompt, /厨房区：|书桌区：|卫生间：|衣柜：|门边：/);

console.log('actionNarrationPrompt.test.ts passed');
