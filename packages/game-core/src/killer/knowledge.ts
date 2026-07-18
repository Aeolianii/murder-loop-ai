import { DEADLINE_MINUTE, type GameState, type RuleEvent } from '@murder-loop-ai/shared';

export function updateKillerKnowledgeFromState(state: GameState, events: RuleEvent[] = []) {
  const doorState = state.room.front_door?.state;
  const windowState = state.room.window?.state;
  const visibleEvents = events.filter((event) => event.visibility === 'killer');
  const observedPackageOpened = visibleEvents.some((event) => matchesPackageEvent(event, ['open', 'opened', '打开', '拆开']));
  const observedPackagePhotographed = visibleEvents.some((event) => matchesPackageEvent(event, ['photo', 'photograph', 'photographed', '拍照', '照片']));

  state.killerKnowledge.knowsDoorBarricaded = Boolean(doorState?.barricaded) || state.killerKnowledge.knowsDoorBarricaded;
  state.killerKnowledge.knowsWindowLocked = Boolean(windowState?.locked) && state.killerKnowledge.suspectsPlayerIsAlert;
  state.killerKnowledge.knowsPlayerOpenedPackage = observedPackageOpened ? true : state.killerKnowledge.knowsPlayerOpenedPackage;
  state.killerKnowledge.knowsPlayerPhotographedPackage = observedPackagePhotographed || state.killerKnowledge.knowsPlayerPhotographedPackage;
}

function matchesPackageEvent(event: RuleEvent, keywords: string[]): boolean {
  const text = `${event.subject} ${event.summary} ${event.sensoryHints.join(' ')}`.toLowerCase();
  return (text.includes('package') || text.includes('包裹') || text.includes('纸板箱') || text.includes('箱子'))
    && keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function projectKillerVisibleState(state: GameState) {
  return {
    minute: state.minute,
    phase: state.phase,
    threat: state.threat,
    killerPhase: state.killerPhase,
    policeActive: state.policePhase !== 'not_contacted',
    linYuePhase: state.killerKnowledge.knowsPlayerContactedLinYue ? state.linYuePhase : 'unknown',
    knowledge: state.killerKnowledge,
  };
}
