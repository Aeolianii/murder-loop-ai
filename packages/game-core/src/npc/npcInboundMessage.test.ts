import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { buildNpcInboundMessages } from './npcInboundMessage';

const plan: ActionPlan = {
  id: 'split-photo-question-plan',
  raw: '拍张照片，发给林越，问这个包裹是不是他的，再告诉陈怀民我稍后回复',
  summary: '拍摄并发送包裹照片，然后分别联系林越和陈怀民',
  actions: [{
    id: 'action-photograph-package',
    raw: '拍张照片',
    intent: 'preserve_evidence',
    target: 'package',
    method: '用手机拍摄包裹照片',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }, {
    id: 'action-send-photo-to-linyue',
    raw: '发给林越，',
    intent: 'communicate',
    target: 'linyue',
    method: '通过手机发送照片',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }, {
    id: 'action-ask-linyue-about-package',
    raw: '这个包裹是不是他的',
    intent: 'communicate',
    target: 'linyue',
    method: '在消息中询问',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }, {
    id: 'action-message-chen',
    raw: '告诉陈怀民我稍后回复',
    intent: 'communicate',
    target: 'chen_huaimin',
    method: '发送文字消息',
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }],
  confidence: 1,
  warnings: [],
};

const messages = buildNpcInboundMessages(plan, [{
  eventType: 'package_photographed',
  subject: 'package',
  facts: ['package_photo_exists'],
}, {
  eventType: 'message_delivered',
  subject: 'linyue',
  facts: ['message_delivered:linyue'],
}, {
  eventType: 'message_delivered',
  subject: 'chen_huaimin',
  facts: ['message_delivered:chen_huaimin'],
}]);

assert.equal(messages.length, 2);
const linYueMessage = messages.find((message) => message.speaker === 'linyue');
assert.ok(linYueMessage);
assert.equal(linYueMessage.text, '发给林越，这个包裹是不是他的');
assert.deepEqual(linYueMessage.actionIds, [
  'action-send-photo-to-linyue',
  'action-ask-linyue-about-package',
]);
assert.equal(linYueMessage.deliveryConfirmed, true);
assert.deepEqual(linYueMessage.attachments.map((attachment) => attachment.id), ['package_photo']);

const chenMessage = messages.find((message) => message.speaker === 'chen_huaimin');
assert.ok(chenMessage);
assert.equal(chenMessage.text, '告诉陈怀民我稍后回复');
assert.equal(chenMessage.deliveryConfirmed, true);
assert.deepEqual(chenMessage.attachments, []);

const unconfirmed = buildNpcInboundMessages(plan);
assert.equal(unconfirmed.find((message) => message.speaker === 'linyue')?.deliveryConfirmed, false);
assert.deepEqual(
  unconfirmed.find((message) => message.speaker === 'linyue')?.attachments,
  [],
);

const genericAssetPlan: ActionPlan = {
  id: 'generic-asset-plan',
  raw: '把录音发给警方',
  summary: '发送已有录音',
  actions: [{
    id: 'action-send-recording',
    raw: '把录音发给警方',
    intent: 'communicate',
    target: 'police_dispatch',
    communication: {
      content: '这是刚才保存的录音',
      attachmentIds: ['asset.audio.recording-1'],
      channel: 'phone',
    },
    confidence: 1,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  }],
  confidence: 1,
  warnings: [],
};
const policeAssetMessage = buildNpcInboundMessages(genericAssetPlan, [{
  eventType: 'asset_transferred',
  subject: 'police_dispatch',
  facts: ['asset_transferred:asset.audio.recording-1:police_dispatch'],
  payload: {
    deliveredAssets: [{
      id: 'asset.audio.recording-1',
      kind: 'audio',
      label: '走廊录音',
      sourceActionIds: ['action-record-hallway'],
    }],
  },
}]).find((message) => message.speaker === 'police_dispatch');
assert.ok(policeAssetMessage);
assert.equal(policeAssetMessage.deliveryConfirmed, true);
assert.deepEqual(policeAssetMessage.attachments, [{
  id: 'asset.audio.recording-1',
  kind: 'audio',
  label: '走廊录音',
  sourceActionIds: ['action-record-hallway'],
  confirmedByEventTypes: ['asset_transferred'],
}]);
