import { findFirstNewClue, isClueUnread, markClueRead } from './clueRevealState';
import type { Clue } from './types';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const previous: Clue[] = [
  { id: 'wrong_package', name: '标记模糊的包裹', description: '旧线索', status: 'known' },
];

const next: Clue[] = [
  ...previous,
  { id: 'door_scratch', name: '锁芯划痕', description: '新线索', status: 'new' },
];

const discovered = findFirstNewClue(previous, next);
assert(discovered?.id === 'door_scratch', 'findFirstNewClue should return the first newly added clue');

const readMap = markClueRead({}, 'door_scratch');
assert(readMap.door_scratch === true, 'markClueRead should mark the clue as read');
assert(!isClueUnread(next[1], readMap), 'read clues should not remain unread');
assert(isClueUnread(next[1], {}), 'new clues should be unread until closed');
