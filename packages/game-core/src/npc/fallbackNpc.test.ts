import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { fallbackNpcReply } from './fallbackNpc';

const state = createInitialGameState();
state.policePhase = 'dispatch_pending';
state.linYuePhase = 'received_photo';

const reply = fallbackNpcReply('linyue', '联系林越，让他帮忙报警，楼下好像有警察', state);

assert.equal(reply.speaker, 'linyue');
assert.match(reply.text, /不太对劲/);
assert.match(reply.text, /假警察|冒充警察/);
assert.doesNotMatch(reply.text, /停车场有真警察/);
assert.match(reply.text, /别开门|不要开门/);
assert.match(reply.suggestedExternalAction, /真警察|官方|报警/);

console.log('fallbackNpc.test.ts passed');
