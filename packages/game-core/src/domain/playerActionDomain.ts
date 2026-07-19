import { createClueFromTemplate } from '@murder-loop-ai/content';
import type { ClueRecord, GameState } from '@murder-loop-ai/shared';
import type { DomainEvent, PlayerCommand } from './domainEvents';

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function isPhysicalDoorBlock(text: string) {
  const lower = text.toLowerCase();
  return includesAny(lower, [
    '堵门',
    '抵住门',
    '顶住门',
    '椅子',
    '行李箱',
    '胶带',
    '封门',
    '挡住门',
    'barricade',
    'block the door',
    'chair',
    'luggage',
    'suitcase',
  ]);
}

function commandText(command: PlayerCommand) {
  return `${command.raw} ${command.method ?? ''}`;
}

function mentionsPhoto(text: string) {
  const lower = text.toLowerCase();
  return lower.includes('photo')
    || lower.includes('picture')
    || text.includes('照片')
    || text.includes('拍');
}

function mentionsCloset(text: string) {
  return text.toLowerCase().includes('closet') || text.includes('衣柜');
}

function mentionsDoorActivity(text: string) {
  const lower = text.toLowerCase();
  return lower.includes('door')
    || lower.includes('hallway')
    || lower.includes('corridor')
    || lower.includes('police')
    || lower.includes('knock')
    || lower.includes('voice')
    || text.includes('门')
    || text.includes('楼道')
    || text.includes('警察')
    || text.includes('敲门')
    || text.includes('原话');
}

function isAskingAboutLinYueRetraction(text: string) {
  return includesAny(text, ['撤回', '为什么', '包裹你别', '哪里不对', '怎么了', '说清楚']);
}

function isWarningLinYueNotToCome(text: string) {
  return includesAny(text, ['别上楼', '不要上楼', '别过来', '不要过来', '别来', '别靠近', '留在楼下', '安全位置']);
}

function isAskingLinYueToAssistPolice(text: string) {
  return includesAny(text, ['报警', '打110', '叫警察', '等警察', '备份', '留证', '录下来', '记录']);
}

function createDomainEvent(
  command: PlayerCommand,
  eventType: DomainEvent['eventType'],
  subject: string,
  summary: string,
  facts: string[],
  payload: Record<string, unknown> = {},
): DomainEvent {
  return {
    id: `domain.${eventType}.${command.id}`,
    kind: 'domain_event',
    source: 'rule',
    createdAt: command.createdAt,
    causationId: command.id,
    correlationId: command.correlationId,
    eventType,
    authority: 'game',
    subject,
    summary,
    facts,
    visibility: 'player',
    payload: {
      commandType: command.commandType,
      target: command.target,
      noise: command.noise ?? 0,
      risk: command.risk ?? 'low',
      ...payload,
    },
  };
}

const usableItemIds = new Set([
  'tape',
  'first_aid_kit',
  'phone_charger',
  'lighter',
  'screwdriver',
  'hanger',
  'mirror',
  'bleach',
  'pen_paper',
  'newspaper',
  'belt',
  'flashlight',
]);

type ContactChannel = 'phone' | 'doorstep' | 'unspecified';
type ItemKind = 'weapon' | 'utility' | 'evidence' | 'unknown';

function inferChenContactChannel(text: string): ContactChannel {
  if (includesAny(text, ['陌生号码', '短信', '消息', '手机', '来电', '打电话', '通话'])) return 'phone';
  if (includesAny(text, ['门外', '门口', '开门', '隔门', '当面', '门后'])) return 'doorstep';
  return 'unspecified';
}

function resolveCommandContactChannel(command: PlayerCommand, text: string): ContactChannel {
  const agentChannel = command.payload?.contactChannel;
  if (agentChannel === 'phone' || agentChannel === 'doorstep' || agentChannel === 'unspecified') {
    return agentChannel;
  }
  return inferChenContactChannel(text);
}

function resolveCommandItemKind(command: PlayerCommand): ItemKind {
  const agentItemKind = command.payload?.itemKind;
  if (agentItemKind === 'weapon' || agentItemKind === 'utility' || agentItemKind === 'evidence' || agentItemKind === 'unknown') {
    return agentItemKind;
  }
  return 'unknown';
}

function resolveCommandItemId(command: PlayerCommand) {
  const payloadItemId = command.payload?.itemId;
  if (typeof payloadItemId === 'string' && payloadItemId) return payloadItemId;
  if (command.target && usableItemIds.has(command.target)) return command.target;
  const text = `${command.raw} ${command.method ?? ''} ${command.target ?? ''}`.toLowerCase();
  const chargesPhone = command.target === 'phone'
    && (text.includes('充电') || text.includes('charger') || text.includes('charge'));
  return chargesPhone ? 'phone_charger' : undefined;
}

export function evaluatePlayerCommandDomainEvents(
  state: GameState,
  commands: PlayerCommand[],
): DomainEvent[] {
  const events: DomainEvent[] = [];
  let packagePhotoWillExist = state.room.package?.state.photographed === true
    || state.evidencePhase === 'package_photographed'
    || state.evidencePhase === 'evidence_shared'
    || state.evidencePhase === 'evidence_backed_up';

  for (const command of commands) {
    const text = commandText(command);

    if (command.commandType === 'inspect') {
      events.push(createDomainEvent(command, 'inspection_completed', command.target ?? 'unknown', 'Player completed an inspection.', [
        `inspected:${command.target ?? 'unknown'}`,
      ]));
      continue;
    }

    if (command.commandType === 'preserve_evidence') {
      const backedUp = includesAny(text, ['备份', '云盘', '上传', '定时', '小红书', '社交平台', '发帖', '发布', '公开']);
      packagePhotoWillExist = true;
      events.push(createDomainEvent(command, 'package_photographed', 'package', 'Player photographed the package.', [
        'package_photo_exists',
        ...(backedUp ? ['package_photo_backed_up'] : []),
      ], { backedUp }));
      continue;
    }

    if (command.commandType === 'communicate' && command.target === 'linyue') {
      const hasPhotoForLinYue = packagePhotoWillExist || mentionsPhoto(text);
      const reportedDoorActivity = !hasPhotoForLinYue && mentionsDoorActivity(text);
      const warnedNotToCome = isWarningLinYueNotToCome(text);
      const askedToAssistPolice = isAskingLinYueToAssistPolice(text);
      const askedAboutRetraction = isAskingAboutLinYueRetraction(text);
      const linYuePhase = warnedNotToCome && askedToAssistPolice
        ? 'calling_police'
        : askedAboutRetraction && state.linYuePhase === 'worried'
          ? 'calling_player'
          : text.includes('上来') || text.includes('来看看') || text.includes('你过来')
            ? 'coming_to_apartment'
            : hasPhotoForLinYue
              ? 'received_photo'
              : 'worried';

      events.push(createDomainEvent(command,
        hasPhotoForLinYue
          ? 'photo_sent_to_linyue'
          : reportedDoorActivity
            ? 'door_activity_reported_to_linyue'
            : 'npc_message_received',
        'linyue',
        'Player contacted Lin Yue.',
        [
        'player_contacted_linyue',
        ...(hasPhotoForLinYue ? ['linyue_has_package_photo'] : []),
        ...(reportedDoorActivity ? ['player_reported_door_activity'] : []),
      ], { hasPhotoForLinYue, reportedDoorActivity, linYuePhase }));
      continue;
    }

    if (command.commandType === 'deceive' && command.target === 'chen_huaimin') {
      const factId = mentionsCloset(text) ? 'package_in_closet' : 'player_false_statement';
      const contactChannel = resolveCommandContactChannel(command, text);
      events.push(createDomainEvent(command, 'player_lied_to_chen', 'chen_huaimin', 'Player supplied Chen Huaimin with an unverified claim.', [
        'player_lied_to_chen',
      ], { factId, confidence: 0.65, contactChannel }));
      continue;
    }

    if (command.commandType === 'communicate' && command.target === 'chen_huaimin') {
      const contactChannel = resolveCommandContactChannel(command, text);
      events.push(createDomainEvent(command, 'player_messaged_chen', 'chen_huaimin', 'Player sent a message to Chen Huaimin.', [
        'player_messaged_chen',
      ], { contactChannel }));
      continue;
    }

    if (command.commandType === 'record') {
      events.push(createDomainEvent(command, 'recording_started', 'phone', 'Player started recording.', [
        'phone_recording_started',
      ]));
      continue;
    }

    if (command.commandType === 'secure_entry' && command.target === 'front_door') {
      const physicallyBlocked = isPhysicalDoorBlock(text);
      events.push(createDomainEvent(command, 'front_door_secured', 'front_door', 'Player secured the front door.', [
        'front_door_locked',
        'front_door_chain_locked',
        ...(physicallyBlocked ? ['front_door_barricaded'] : []),
      ], { physicallyBlocked }));
      continue;
    }

    if (command.commandType === 'secure_entry' && command.target === 'window') {
      events.push(createDomainEvent(command, 'window_secured', 'window', 'Player secured the window.', [
        'window_locked',
        'curtain_closed',
      ]));
      continue;
    }

    if (command.commandType === 'secure_entry' && command.target === 'phone') {
      events.push(createDomainEvent(command, 'phone_secured', 'phone', 'Player reduced phone exposure.', [
        'phone_muted',
      ], {
        dimmed: includesAny(text, ['暗', '亮度', 'dim']),
        lightsOff: includesAny(text, ['关灯', '灯关', 'lights off']),
      }));
      continue;
    }

    if (command.commandType === 'hide_evidence') {
      events.push(createDomainEvent(command, 'evidence_hidden', 'package', 'Player hid the package.', [
        'package_hidden',
      ], { hiddenAt: command.target === 'bathroom' ? 'bathroom' : 'inside_room' }));
      continue;
    }

    if (command.commandType === 'call_police') {
      events.push(createDomainEvent(command, 'police_alert_raised', 'police', 'Player called police dispatch.', [
        'police_report_received',
      ], { noisy: Number(command.noise ?? 0) > 0 }));
      continue;
    }

    if (command.commandType === 'verify_identity') {
      events.push(createDomainEvent(command, 'police_identity_verified', 'police', 'Player requested official identity verification.', [
        'police_identity_verification_requested',
      ]));
      continue;
    }

    if (command.commandType === 'escape') {
      events.push(createDomainEvent(command, 'escape_attempted', command.target ?? 'front_door', 'Player attempted an escape route.', [
        `escape_attempted:${command.target ?? 'front_door'}`,
      ]));
      continue;
    }

    if (command.commandType === 'open_door') {
      events.push(createDomainEvent(command, 'front_door_opened', 'front_door', 'Player opened the front door.', [
        'front_door_opened',
      ]));
      continue;
    }

    if (command.commandType === 'self_care') {
      events.push(createDomainEvent(command, 'self_care_completed', 'player', 'Player completed a self-care action.', [
        'player_stress_reduced',
      ]));
      continue;
    }

    if (command.commandType === 'wait') {
      events.push(createDomainEvent(command, 'player_waited', 'player', 'Player waited and observed.', [
        'player_waited',
      ]));
      continue;
    }

    if (command.commandType === 'attack') {
      events.push(createDomainEvent(command, 'combat_attempted', command.target ?? 'unknown', 'Player attempted an attack.', [
        'combat_attempted',
      ], { weaponId: typeof command.payload?.weaponId === 'string' ? command.payload.weaponId : undefined }));
      continue;
    }

    if (command.commandType === 'pick_up') {
      const itemId = resolveCommandItemId(command);
      const itemKind = resolveCommandItemKind(command);
      events.push(createDomainEvent(command, 'item_picked_up', itemId ?? 'unknown', 'Player attempted to pick up an item.', [
        ...(itemId ? [`item_picked_up:${itemId}`] : ['item_pickup_failed']),
      ], { itemId, itemKind }));
      continue;
    }

    if (command.commandType === 'use_item') {
      const itemId = resolveCommandItemId(command);
      events.push(createDomainEvent(command, 'item_used', itemId ?? 'unknown', 'Player attempted to use an item.', [
        ...(itemId ? [`item_used:${itemId}`] : ['item_use_unknown']),
      ], { itemId }));
      continue;
    }

    events.push(createDomainEvent(command, 'player_action_accepted', command.target ?? 'unknown', 'Rules accepted an unmodeled player action.', [
      `player_action:${command.commandType}`,
    ]));
  }

  return events;
}

function addClueFromDomainEvent(state: GameState, addedClues: ClueRecord[] | undefined, clueId: string) {
  if (state.clues.some((clue) => clue.id === clueId)) return;
  const clue = createClueFromTemplate(clueId, state.run, state.minute);
  if (!clue) return;
  state.clues.push(clue);
  addedClues?.push(clue);
}

export function applyPlayerDomainEventsToState(
  state: GameState,
  events: DomainEvent[],
  options: { addedClues?: ClueRecord[] } = {},
): void {
  for (const domainEvent of events) {
    const risk = domainEvent.payload?.risk;
    if (risk === 'low' || risk === 'medium' || risk === 'high') {
      state.player.stress = Math.max(0, Math.min(100, state.player.stress + (
        risk === 'high' ? 8 : risk === 'medium' ? 3 : 1
      )));
    }

    switch (domainEvent.eventType) {
      case 'inspection_completed': {
        const target = domainEvent.payload?.target;
        if (target === 'package') {
          state.room.package.inspected = true;
          state.room.package.state.opened = true;
          state.evidencePhase = 'package_opened';
          state.killerKnowledge.knowsPlayerOpenedPackage = 'uncertain';
          addClueFromDomainEvent(state, options.addedClues, 'wrong_package');
        } else if (target === 'front_door') {
          state.room.front_door.inspected = true;
          state.room.front_door.state.scratched = true;
          addClueFromDomainEvent(state, options.addedClues, 'door_scratch');
        } else if (target === 'window') {
          state.room.window.inspected = true;
          state.room.window.state.checked = true;
        } else if (target === 'room') {
          state.room.closet.state.checked = true;
          state.room.bed.state.checkedUnder = true;
        }
        break;
      }
      case 'package_photographed': {
        const backedUp = domainEvent.payload?.backedUp === true;
        state.room.package.state.photographed = true;
        state.room.package.state.backedUp = backedUp;
        state.evidencePhase = state.linYuePhase === 'received_photo'
          ? 'evidence_shared'
          : backedUp
            ? 'evidence_backed_up'
            : 'package_photographed';
        addClueFromDomainEvent(state, options.addedClues, 'package_photo');
        break;
      }
      case 'photo_sent_to_linyue':
      case 'npc_message_received':
      case 'door_activity_reported_to_linyue': {
        const nextPhase = domainEvent.payload?.linYuePhase;
        if (typeof nextPhase === 'string') {
          state.linYuePhase = nextPhase as GameState['linYuePhase'];
        }
        if (domainEvent.eventType === 'photo_sent_to_linyue' || domainEvent.payload?.hasPhotoForLinYue === true) {
          addClueFromDomainEvent(state, options.addedClues, 'linyue_has_photo');
          if (state.evidencePhase === 'package_photographed' || state.evidencePhase === 'evidence_backed_up') {
            state.evidencePhase = 'evidence_shared';
          }
        }
        if (state.linYuePhase === 'calling_police') {
          addClueFromDomainEvent(state, options.addedClues, 'linyue_has_photo');
        }
        state.killerKnowledge.knowsPlayerContactedLinYue = Number(domainEvent.payload?.noise ?? 0) > 0
          && state.killerKnowledge.suspectsPlayerIsAlert;
        break;
      }
      case 'player_messaged_chen':
        state.suspicion = Math.max(0, Math.min(100, state.suspicion + 10));
        state.killerKnowledge.suspectsPlayerIsAlert = true;
        if (domainEvent.payload?.contactChannel === 'phone') {
          addClueFromDomainEvent(state, options.addedClues, 'unknown_number_probe');
        } else if (domainEvent.payload?.contactChannel === 'doorstep') {
          addClueFromDomainEvent(state, options.addedClues, 'doorstep_package_claim');
        }
        break;
      case 'player_lied_to_chen':
        state.suspicion = Math.max(0, Math.min(100, state.suspicion + 6));
        state.killerKnowledge.suspectsPlayerIsAlert = true;
        if (domainEvent.payload?.contactChannel === 'phone') {
          addClueFromDomainEvent(state, options.addedClues, 'unknown_number_probe');
        } else if (domainEvent.payload?.contactChannel === 'doorstep') {
          addClueFromDomainEvent(state, options.addedClues, 'doorstep_package_claim');
        }
        break;
      case 'recording_started':
        state.room.phone.state.recording = true;
        addClueFromDomainEvent(state, options.addedClues, 'recording_pressure');
        break;
      case 'front_door_secured': {
        const physicallyBlocked = domainEvent.payload?.physicallyBlocked === true;
        state.room.front_door.state.locked = true;
        state.room.front_door.state.chainLocked = true;
        state.room.front_door.state.barricaded = physicallyBlocked;
        state.room.chair.state.movedToDoor = physicallyBlocked;
        state.killerKnowledge.suspectsPlayerIsAlert = Number(domainEvent.payload?.noise ?? 0) >= 2
          || state.killerKnowledge.suspectsPlayerIsAlert;
        state.killerKnowledge.knowsDoorBarricaded = physicallyBlocked
          && Number(domainEvent.payload?.noise ?? 0) >= 2;
        break;
      }
      case 'window_secured':
        state.room.window.state.locked = true;
        state.room.window.state.curtainClosed = true;
        break;
      case 'phone_secured':
        state.room.phone.state.muted = true;
        state.room.phone.state.dimmed = domainEvent.payload?.dimmed === true;
        state.room.phone.state.lightsOff = domainEvent.payload?.lightsOff === true;
        break;
      case 'evidence_hidden':
        state.room.package.state.hiddenAt = domainEvent.payload?.hiddenAt === 'bathroom' ? 'bathroom' : 'inside_room';
        state.evidencePhase = 'evidence_hidden';
        break;
      case 'police_alert_raised':
        state.policePhase = 'dispatch_pending';
        state.killerKnowledge.knowsPoliceCalled = domainEvent.payload?.noisy === true || state.killerKnowledge.suspectsPlayerIsAlert;
        break;
      case 'police_identity_verified':
        state.policePhase = state.policePhase === 'not_contacted' ? 'verifying_report' : 'real_police_en_route';
        addClueFromDomainEvent(state, options.addedClues, 'police_verified');
        break;
      case 'escape_attempted':
        if (domainEvent.payload?.target === 'window') {
          state.room.window.inspected = true;
          state.room.window.state.checked = true;
          if (!state.room.window.state.locked) state.room.window.state.opened = true;
        } else {
          state.room.front_door.state.opened = true;
          state.player.stress = Math.max(0, Math.min(100, state.player.stress + 15));
        }
        break;
      case 'front_door_opened':
        state.room.front_door.state.opened = true;
        state.room.front_door.state.chainLocked = false;
        break;
      case 'self_care_completed':
        state.player.stress = Math.max(0, Math.min(100, state.player.stress - 5));
        state.killerKnowledge.suspectsPlayerIsAlert = state.killerKnowledge.suspectsPlayerIsAlert
          || Number(domainEvent.payload?.noise ?? 0) >= 2;
        break;
      case 'combat_attempted': {
        const weaponId = typeof domainEvent.payload?.weaponId === 'string' ? domainEvent.payload.weaponId : undefined;
        const weaponAvailable = weaponId
          ? state.playerHolding === weaponId || Boolean(state.room[weaponId])
          : true;
        if (weaponAvailable) {
          state.combatTriggered = true;
          state.playerHolding = state.playerHolding || weaponId || 'fists';
        }
        break;
      }
      case 'item_picked_up': {
        const itemId = domainEvent.payload?.itemId;
        if (typeof itemId === 'string' && itemId) {
          state.playerHolding = itemId;
          if (domainEvent.payload?.itemKind === 'weapon') {
            addClueFromDomainEvent(state, options.addedClues, 'weapon_found');
          }
        }
        break;
      }
      case 'item_used': {
        const itemId = domainEvent.payload?.itemId;
        if (itemId === 'tape' && state.playerHolding === 'tape') {
          state.room.front_door.state.barricaded = true;
        } else if (itemId === 'first_aid_kit') {
          state.player.stress = Math.max(0, Math.min(100, state.player.stress - 15));
          if (state.player.injury !== 'none' && state.player.injury !== 'critical') {
            const injuryOrder = ['none', 'minor', 'bleeding', 'leg_injured', 'critical'] as const;
            const index = injuryOrder.indexOf(state.player.injury);
            if (index > 0) state.player.injury = injuryOrder[index - 1];
          }
        } else if (itemId === 'phone_charger') {
          state.phoneBattery = Math.min(61, state.phoneBattery + 30);
          state.phoneFunctional = true;
          if (state.room.phone_charger?.state) state.room.phone_charger.state.pluggedIn = true;
          if (state.room.phone?.state) state.room.phone.state.battery = state.phoneBattery;
        }
        break;
      }
    }
  }
}

export function buildPlayerOutcomeDomainEvents(
  confirmedEvents: DomainEvent[],
  before: GameState,
  after: GameState,
): DomainEvent[] {
  const events = [...confirmedEvents];
  const causationId = confirmedEvents.at(-1)?.id;
  const correlationId = confirmedEvents.at(-1)?.correlationId;

  if (after.minute !== before.minute) {
    events.push({
      id: `domain.time_advanced.player.${before.run}.${before.minute}.${after.minute}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: { run: after.run, minute: after.minute },
      causationId,
      correlationId,
      eventType: 'time_advanced',
      authority: 'game',
      subject: 'clock',
      summary: `Time advanced from ${before.minute} to ${after.minute}.`,
      facts: [`minute:${after.minute}`, `minutes_elapsed:${after.minute - before.minute}`],
      visibility: 'player',
      payload: { before: before.minute, after: after.minute, delta: after.minute - before.minute },
    });
  }

  if (after.threat !== before.threat) {
    events.push({
      id: `domain.threat_changed.player.${before.run}.${before.minute}.${after.minute}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: { run: after.run, minute: after.minute },
      causationId,
      correlationId,
      eventType: 'threat_changed',
      authority: 'game',
      subject: 'threat',
      summary: `Threat changed from ${before.threat} to ${after.threat}.`,
      facts: [`threat:${after.threat}`, `threat_delta:${after.threat - before.threat}`],
      visibility: 'player',
      payload: { before: before.threat, after: after.threat, delta: after.threat - before.threat },
    });
  }

  if (after.ending && after.ending !== before.ending && after.endingReason) {
    events.push({
      id: `domain.ending_reached.player.${before.run}.${after.minute}`,
      kind: 'domain_event',
      source: 'rule',
      createdAt: { run: after.run, minute: after.minute },
      causationId,
      correlationId,
      eventType: 'ending_reached',
      authority: 'game',
      subject: after.ending,
      summary: `Rules confirmed ending ${after.ending}.`,
      facts: [`ending:${after.ending}`, `ending_reason:${after.endingReason}`],
      visibility: 'player',
      ending: { id: after.ending, reason: after.endingReason },
    });
  }

  return events;
}
