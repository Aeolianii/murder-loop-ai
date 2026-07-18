import type { GamePhase } from '@murder-loop-ai/shared';

export const actionSfxMap: Record<string, string[]> = {
  inspect:          [],
  secure_entry:     ['door_lock', 'door_chain', 'chair_drag'],
  record:           ['phone_tap'],
  communicate:      ['phone_msg'],
  call_police:      ['phone_dial', 'phone_call'],
  preserve_evidence: ['phone_shutter'],
  hide_evidence:    ['closet_open'],
  open_door:        ['door_chain', 'door_open'],
  wait:             [],
  self_care:        ['bottle_cap'],
  escape:           ['window_scrape'],
  attack:           ['knife_slash', 'metal_hit'],
  pick_up:          ['closet_open'],
  use_item:         ['bottle_cap'],
  verify_identity:  ['phone_tap'],
  deceive:          ['phone_msg'],
  unknown:          [],
};

export const killerSfxMap: Record<string, string[]> = {
  phone_probe:        ['phone_msg'],
  soft_knock:         ['door_knock'],
  landlord_excuse:    ['door_knock', 'footstep_near'],
  fake_police:        ['door_knock', 'footstep_near'],
  spare_key_entry:    ['key_insert', 'door_lock'],
  window_route:       ['window_scrape', 'awning_drip'],
  framing_pressure:   ['phone_msg'],
  power_cut:          ['power_cut'],
  lure_linyue:        ['phone_call'],
  fake_neighbor:      ['door_knock'],
  fake_callback:      ['phone_call'],
  message_reply:      ['phone_msg'],
  wait_for_fatigue:   ['elevator_echo'],
  retreat:            ['footstep_leave'],
  direct_confrontation: ['footstep_near'],
  deception:          ['door_knock'],
  false_authority:    ['door_knock', 'footstep_near'],
  forced_entry:       ['key_insert', 'door_lock'],
  framing:            ['phone_msg'],
  exposed:            ['footstep_near'],
};

export const ambientByPhase: Partial<Record<GamePhase, string>> = {
  intro:                   'silence_tense',
  loop_started:            'silence_tense',
  investigating:           'hallway_hum',
  killer_pressure:         'hallway_hum',
  police_called:           'hallway_hum',
  confrontation:           'hallway_hum',
  pre_2347_countdown:      'heartbeat_fast',
  death:                   'silence_tense',
  survived:                'heartbeat_slow',
  ending:                  'heartbeat_slow',
};

export function getHeartbeatByThreat(threat: number): string | null {
  if (threat >= 70) return 'heartbeat_fast';
  if (threat >= 45) return 'heartbeat_slow';
  return null;
}
