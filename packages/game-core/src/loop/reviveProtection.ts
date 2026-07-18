import { DEADLINE_MINUTE, type GameState, type RuleResult } from '@murder-loop-ai/shared';
import { event } from '../narration/buildNarrationContext';

type ProtectionCause = 'forced_entry' | 'window_route' | 'deadline' | 'ambient_pressure';

export function hasReviveProtection(state: GameState): boolean {
  return (state.reviveProtectionTurns ?? 0) > 0;
}

export function grantReviveProtection(state: GameState): void {
  state.reviveProtectionTurns = 1;
}

export function clearReviveProtection(state: GameState): void {
  state.reviveProtectionTurns = 0;
}

function stabilizeAgainstImmediateDeath(state: GameState, cause: ProtectionCause) {
  state.room.front_door.state.locked = true;
  state.room.front_door.state.chainLocked = true;
  state.room.front_door.state.barricaded = true;
  state.room.front_door.state.opened = false;
  state.room.chair.state.movedToDoor = true;
  state.room.window.state.locked = true;
  state.room.window.state.curtainClosed = true;
  state.room.window.state.checked = true;
  state.threat = Math.min(state.threat, cause === 'ambient_pressure' ? 68 : 58);
  state.killerPhase = 'soft_pressure';

  if (cause === 'deadline' && state.minute >= DEADLINE_MINUTE) {
    state.minute = DEADLINE_MINUTE - 1;
  }
}

export function absorbReviveProtection(state: GameState, cause: ProtectionCause): Omit<RuleResult, 'state'> {
  clearReviveProtection(state);
  stabilizeAgainstImmediateDeath(state, cause);

  const title = cause === 'window_route'
    ? '雨棚外的影子滑开了'
    : cause === 'deadline'
      ? '电子钟慢了半拍'
      : '门板替你扛住了第一下';
  const text = cause === 'window_route'
    ? '你刚从死亡里挣回来，窗外那道贴近玻璃的黑影却没有如上一轮那样扑进来。雨水在窗沿上打滑，金属锁扣在你手边发出一声脆响，像是命运自己错开了半寸。至少这一回合，窗户重新站在你这边。'
    : cause === 'deadline'
      ? '电子钟本该跳到那个你已经记住的数字，可它像被什么拽住似的慢了半拍。门链绷紧，窗锁扣死，上一轮逼你赴死的条件在这一刻被硬生生掐断。你知道这不是结束，只是循环给你的一个喘息口。'
      : '门外那一下本该和上一轮一样直接把你拖进黑暗，可这次门板先顶住了，门链和椅背同时绷紧，金属摩擦声贴着耳膜刮过去，又硬生生停住。上一轮致死的入口被你抢先卡死了，至少这一回合，它进不来。';

  return {
    title,
    text,
    tone: 'threat',
    addedClues: [],
    timePassed: 0,
    threatDelta: 0,
    events: [
      event('state_change', 'revive_protection', '死亡回溯后的首回合保护生效，刚刚致死的入口或条件被强制切断。', ['门链', '窗锁', '电子钟']),
    ],
  };
}
