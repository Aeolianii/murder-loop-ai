import type { ActionPlan, NpcReply } from '@murder-loop-ai/shared';

export interface NpcInboundAttachment {
  id: string;
  kind: 'image' | 'audio' | 'document';
  label: string;
  sourceActionIds: string[];
  confirmedByEventTypes: string[];
}

export interface NpcInboundMessage {
  speaker: NpcReply['speaker'];
  text: string;
  actionIds: string[];
  attachments: NpcInboundAttachment[];
  deliveryConfirmed: boolean;
}

export interface NpcInboundDomainEvent {
  eventType: string;
  subject?: string;
  facts?: string[];
  payload?: Record<string, unknown>;
}

export function npcSpeakerForTarget(target?: string): NpcReply['speaker'] | undefined {
  if (target === 'linyue' || target === 'lin_yue') return 'linyue';
  if (target === 'police' || target === 'police_dispatch' || target === 'real_police') {
    return 'police_dispatch';
  }
  if (target === 'chen_huaimin') return 'chen_huaimin';
  return undefined;
}

function mergeMessageSegments(segments: string[]): string {
  return segments.reduce((merged, segment) => {
    const next = segment.trim();
    if (!next) return merged;
    if (!merged) return next;
    return /[，。！？；、,:;!?]$/.test(merged)
      ? `${merged}${next}`
      : `${merged}，${next}`;
  }, '');
}

function eventTargetsSpeaker(
  event: NpcInboundDomainEvent,
  speaker: NpcReply['speaker'],
): boolean {
  return npcSpeakerForTarget(event.subject) === speaker;
}

function isConfirmedDelivery(
  event: NpcInboundDomainEvent,
  speaker: NpcReply['speaker'],
): boolean {
  return eventTargetsSpeaker(event, speaker)
    && (
      event.eventType === 'message_delivered'
      || event.eventType === 'asset_transferred'
      || event.eventType === 'photo_sent_to_linyue'
    );
}

function deliveredAssets(event: NpcInboundDomainEvent): NpcInboundAttachment[] {
  const payload = event.payload?.deliveredAssets;
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const value = candidate as Record<string, unknown>;
    if (
      typeof value.id !== 'string'
      || !['image', 'audio', 'document'].includes(String(value.kind))
      || typeof value.label !== 'string'
      || !Array.isArray(value.sourceActionIds)
    ) return [];
    return [{
      id: value.id,
      kind: value.kind as NpcInboundAttachment['kind'],
      label: value.label,
      sourceActionIds: value.sourceActionIds.filter((id): id is string => typeof id === 'string'),
      confirmedByEventTypes: [event.eventType],
    }];
  });
}

function mentionsPackagePhoto(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes('照片')
    || normalized.includes('拍照')
    || normalized.includes('影像')
    || normalized.includes('photo')
    || normalized.includes('picture');
}

function confirmsPackagePhoto(event: NpcInboundDomainEvent): boolean {
  return event.eventType === 'package_photographed'
    || event.facts?.some((fact) => (
      fact === 'package_photo_exists'
      || fact === 'fact.package.exterior.photo_captured'
      || fact === 'photographed:package'
    )) === true;
}

function confirmsLinYueReceivedPhoto(event: NpcInboundDomainEvent): boolean {
  return eventTargetsSpeaker(event, 'linyue')
    && (
      event.eventType === 'photo_sent_to_linyue'
      || event.payload?.hasPhotoForLinYue === true
      || event.facts?.some((fact) => (
        fact === 'linyue_has_package_photo'
        || fact === 'fact.lin_yue.package_photo_received'
      )) === true
    );
}

export function buildNpcInboundMessages(
  plan: ActionPlan,
  confirmedEvents: NpcInboundDomainEvent[] = [],
): NpcInboundMessage[] {
  const speakers: NpcReply['speaker'][] = [];
  for (const action of plan.actions) {
    if (action.intent !== 'communicate') continue;
    const speaker = npcSpeakerForTarget(action.target);
    if (speaker && !speakers.includes(speaker)) speakers.push(speaker);
  }

  return speakers.map((speaker) => {
    const communicationActions = plan.actions.filter((action) => (
      action.intent === 'communicate' && npcSpeakerForTarget(action.target) === speaker
    ));
    const text = mergeMessageSegments(
      communicationActions.map((action) => (
        action.communication?.content || action.raw || action.method || ''
      )),
    ) || plan.raw;
    const deliveryEvents = confirmedEvents.filter((event) => isConfirmedDelivery(event, speaker));
    const deliveryConfirmed = deliveryEvents.length > 0;
    const genericAttachments = [...new Map(
      deliveryEvents
        .flatMap(deliveredAssets)
        .map((attachment) => [attachment.id, attachment]),
    ).values()];
    const photoActionIds = plan.actions
      .filter((action) => (
        action.intent === 'preserve_evidence'
        && action.target === 'package'
        && mentionsPackagePhoto(`${action.raw} ${action.method ?? ''}`)
      ))
      .map((action) => action.id);
    const photoCommunicationActionIds = communicationActions
      .filter((action) => (
        action.communication?.attachmentIds.includes('package_photo')
        || mentionsPackagePhoto(
          `${action.communication?.content ?? ''} ${action.raw} ${action.method ?? ''}`,
        )
      ))
      .map((action) => action.id);
    const explicitlyConfirmedPhoto = speaker === 'linyue'
      && confirmedEvents.some(confirmsLinYueReceivedPhoto);
    const inferredConfirmedPhoto = speaker === 'linyue'
      && deliveryConfirmed
      && photoActionIds.length > 0
      && photoCommunicationActionIds.length > 0
      && confirmedEvents.some(confirmsPackagePhoto);
    const legacyAttachments: NpcInboundAttachment[] = explicitlyConfirmedPhoto || inferredConfirmedPhoto
      ? [{
          id: 'package_photo',
          kind: 'image',
          label: '包裹照片',
          sourceActionIds: [...new Set([...photoActionIds, ...photoCommunicationActionIds])],
          confirmedByEventTypes: [...new Set(confirmedEvents
            .filter((event) => (
              confirmsPackagePhoto(event)
              || confirmsLinYueReceivedPhoto(event)
              || isConfirmedDelivery(event, speaker)
            ))
            .map((event) => event.eventType))],
        }]
      : [];
    const attachments = genericAttachments.length > 0
      ? genericAttachments
      : legacyAttachments;

    return {
      speaker,
      text,
      actionIds: communicationActions.map((action) => action.id),
      attachments,
      deliveryConfirmed,
    };
  });
}

export function createDirectNpcInboundMessage(
  speaker: NpcReply['speaker'],
  text: string,
): NpcInboundMessage {
  return {
    speaker,
    text,
    actionIds: [],
    attachments: [],
    deliveryConfirmed: false,
  };
}
