import { strict as assert } from 'node:assert';
import { getWorldInfoCards, selectWorldInfoCards } from './worldInfo';

{
  const cards = getWorldInfoCards();
  assert(cards.some((card) => card.id === 'object.front_door'));
  assert(cards.some((card) => card.id === 'clue.wrong_package'));
  assert(cards.some((card) => card.id === 'rule.killer_visibility'));
  assert(cards.some((card) => card.id === 'rule.phone_visibility'));
  assert(cards.some((card) => card.id === 'rule.object_creation_boundary'));
  assert(cards.some((card) => card.id === 'style.no_player_mind_reading'));
  assert(cards.some((card) => card.id === 'rule.narrator_no_rule_change'));
  assert(cards.some((card) => card.id === 'rule.world_info_not_authority'));
  assert(!cards.some((card) => card.id === 'rule.evidence_backup'));
  assert(cards.find((card) => card.id === 'object.phone')?.content.includes('手机可用于拍照'));
  assert(cards.find((card) => card.id === 'clue.package_photo')?.content.includes('消耗一定电量'));
  assert(cards.find((card) => card.id === 'npc.linYue')?.content.includes('青荷公寓的维修工'));
}

{
  const selected = selectWorldInfoCards({
    agent: 'killer',
    input: 'I photograph the package and send it to Lin Yue',
    limit: 6,
  });

  assert(selected.some((card) => card.id === 'object.package'));
  assert(selected.some((card) => card.id === 'rule.killer_visibility'));
  assert(!selected.some((card) => !card.visibleToAgents.includes('killer')));
}

{
  const selected = selectWorldInfoCards({
    agent: 'parser',
    input: 'I move the chair to barricade the front door',
    limit: 4,
  });

  assert(selected.some((card) => card.id === 'object.front_door'));
  assert(selected.some((card) => card.id === 'object.chair'));
}
