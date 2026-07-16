import type { GameState, ScoreResult } from '@murder-loop-ai/shared';

function hasClue(state: GameState, id: string) {
  return state.clues.some(c => c.id === id);
}

export function scoreRun(state: GameState): ScoreResult {
  // 更新结局判定：把新的结局 id 也纳入"存活"范围
  const survived = state.ending !== null && state.ending !== 'death';
  const survival = survived ? (state.player.injury === 'none' ? 20 : 12) : 0;
  const truth = Math.min(20, state.clues.filter(c => ['wrong_package', 'chen_probe', 'police_verified', 'door_scratch', 'chen_phone_found'].includes(c.id)).length * 5);
  const evidence = Math.min(20, state.clues.filter(c => ['package_photo', 'linyue_has_photo', 'recording_pressure', 'self_defense_evidence'].includes(c.id)).length * 7);
  const npc = state.linYuePhase === 'dead' ? 0 : state.linYuePhase === 'injured' ? 6 : state.linYuePhase === 'safe' || state.linYuePhase === 'received_photo' ? 14 : 10;
  const injury = state.player.injury === 'none' ? 10 : state.player.injury === 'minor' ? 7 : state.player.injury === 'leg_injured' ? 4 : 2;
  const riskControl = Math.min(15, [state.room.front_door.state.barricaded, state.room.window.state.locked, hasClue(state, 'police_verified')].filter(Boolean).length * 5);
  const total = survival + truth + evidence + npc + injury + riskControl;
  const rank = total >= 90 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

  const notes: string[] = [];
  if (!survived) notes.push('这一轮没有活下来，但死亡会变成下一轮的情报。');
  if (!hasClue(state, 'package_photo')) notes.push('缺少包裹照片，证据链很脆弱。');
  if (!hasClue(state, 'police_verified')) notes.push('没有核实警察身份，假警察路线仍然危险。');
  if (hasClue(state, 'linyue_has_photo')) notes.push('林越成为外部备份，但也要注意他的风险。');
  if (state.endingReason === 'killer_dead_with_evidence') notes.push('你成功反击并保留了证据——自卫成立。');
  if (state.endingReason === 'killer_dead_no_evidence') notes.push('你杀了陈怀民，但无法证明他该死。');
  if (riskControl >= 10) notes.push('门窗防御处理得较好，凶手必须改变策略。');

  return { total, rank, survival, truth, evidence, npc, injury, riskControl, notes };
}
