import type { GamePhase } from '@murder-loop-ai/shared';

export const actionSfxMap: Record<string, string[]> = {
  inspect: ['investigate'],
  secure_entry: ['defense'],
  record: ['evidence'],
  communicate: ['communicate'],
  call_police: ['phone'],
  preserve_evidence: ['evidence'],
  hide_evidence: ['wait-hide'],
  open_door: ['movement'],
  wait: ['wait-hide'],
  self_care: ['item'],
  escape: ['movement'],
  attack: ['danger'],
  pick_up: ['item'],
  use_item: ['item'],
  verify_identity: ['phone'],
  deceive: ['communicate'],
  unknown: ['default'],
};

export const killerSfxMap: Record<string, string[]> = {
  phone_probe: ['phone'],
  soft_knock: ['movement'],
  landlord_excuse: ['communicate'],
  fake_police: ['story-false-police-overknows'],
  spare_key_entry: ['danger'],
  window_route: ['movement'],
  framing_pressure: ['communicate'],
  power_cut: ['phone-functional-lost'],
  lure_linyue: ['phone'],
  fake_neighbor: ['communicate'],
  fake_callback: ['phone'],
  message_reply: ['communicate'],
  wait_for_fatigue: ['wait-hide'],
  retreat: ['movement'],
  direct_confrontation: ['danger'],
  deception: ['communicate'],
  false_authority: ['story-false-police-overknows'],
  forced_entry: ['danger'],
  framing: ['communicate'],
  exposed: ['danger'],
};

export const ambientByPhase: Partial<Record<GamePhase, string>> = {
  killer_pressure: 'danger',
  police_called: 'phone',
  confrontation: 'danger',
  pre_2347_countdown: 'story-handoff-failed-2347',
  survived: 'communicate',
};

export function getHeartbeatByThreat(threat: number): string | null {
  if (threat >= 45) return 'danger';
  return null;
}
