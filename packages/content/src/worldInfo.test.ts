import { strict as assert } from 'node:assert';
import { getWorldInfoCards, selectWorldInfoCards } from './worldInfo';

{
  const cards = getWorldInfoCards();
  assert(cards.some((card) => card.id === 'object.front_door'));
  assert(cards.some((card) => card.id === 'clue.wrong_package'));
  assert(cards.some((card) => card.id === 'rule.killer_visibility'));
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
