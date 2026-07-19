import type { GameState, KillerKnowledge, KillerStatus, RuleEvent } from '@murder-loop-ai/shared';
import { chenKnowsPoliceCalled } from '../world/knowledgeEvents';

export function updateKillerKnowledgeFromState(state: GameState, events: RuleEvent[] = []) {
  const visibleEvents = events.filter((event) => event.visibility === 'killer');
  const observedPackageOpened = visibleEvents.some((event) => matchesPackageEvent(event, ['open', 'opened', '打开', '拆开']));
  const observedPackagePhotographed = visibleEvents.some((event) => matchesPackageEvent(event, ['photo', 'photograph', 'photographed', '拍照', '照片']));
  const observedDoorBarricaded = visibleEvents.some((event) => matchesEvent(event, ['door', '门'], ['barricade', 'block', '堵', '抵住']));
  const observedWindowLocked = visibleEvents.some((event) => matchesEvent(event, ['window', '窗'], ['lock', '锁']));

  state.killerKnowledge.knowsDoorBarricaded = observedDoorBarricaded || state.killerKnowledge.knowsDoorBarricaded;
  state.killerKnowledge.knowsWindowLocked = observedWindowLocked || state.killerKnowledge.knowsWindowLocked;
  state.killerKnowledge.knowsPlayerOpenedPackage = observedPackageOpened ? true : state.killerKnowledge.knowsPlayerOpenedPackage;
  state.killerKnowledge.knowsPlayerPhotographedPackage = observedPackagePhotographed || state.killerKnowledge.knowsPlayerPhotographedPackage;
}

function matchesPackageEvent(event: RuleEvent, keywords: string[]): boolean {
  const text = `${event.subject} ${event.summary} ${event.sensoryHints.join(' ')}`.toLowerCase();
  return (text.includes('package') || text.includes('包裹') || text.includes('纸板箱') || text.includes('箱子'))
    && keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export interface KillerVisibleState {
  minute: number;
  phase: GameState['phase'];
  threat: number;
  killerPhase: GameState['killerPhase'];
  killerStatus: KillerStatus;
  ending: boolean;
  policeActive: boolean;
  policePhase: GameState['policePhase'] | 'unknown';
  linYuePhase: GameState['linYuePhase'] | 'unknown';
  knowledge: KillerKnowledge;
  observedFactIds: string[];
  recentStrategyTypes: string[];
  recentKillerActions: Array<{ title: string; text: string }>;
}

function matchesEvent(event: RuleEvent, subjects: string[], keywords: string[]): boolean {
  const text = `${event.subject} ${event.summary} ${event.sensoryHints.join(' ')}`.toLowerCase();
  return subjects.some((subject) => text.includes(subject.toLowerCase()))
    && keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export interface KillerObservableEvent {
  subject: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'rule_event' | 'state_projection' | 'inference';
}

export interface KillerDecisionContext {
  visibleState: KillerVisibleState;
  observableEvents: KillerObservableEvent[];
}

export function projectKillerVisibleState(state: GameState): KillerVisibleState {
  const knowsPoliceCalled = killerKnowsPoliceCalled(state);
  return {
    minute: state.minute,
    phase: projectKillerVisiblePhase(state),
    threat: state.threat,
    killerPhase: state.killerPhase,
    killerStatus: state.killerStatus,
    ending: state.ending !== null,
    policeActive: knowsPoliceCalled,
    policePhase: knowsPoliceCalled ? state.policePhase : 'unknown',
    linYuePhase: state.killerKnowledge.knowsPlayerContactedLinYue ? state.linYuePhase : 'unknown',
    knowledge: { ...state.killerKnowledge },
    observedFactIds: Object.keys(state.world?.knowledge.chen_huaimin.facts ?? {}),
    recentStrategyTypes: state.log
      .filter((entry) => entry.channel === 'ambient')
      .slice(-6)
      .flatMap((entry) => extractKnownStrategyTypes(`${entry.title} ${entry.text}`)),
    recentKillerActions: state.log
      .filter((entry) => entry.channel === 'ambient')
      .slice(-6)
      .map((entry) => ({ title: entry.title, text: entry.text })),
  };
}

function extractKnownStrategyTypes(text: string): string[] {
  return [
    'phone_probe',
    'message_reply',
    'framing_pressure',
    'landlord_excuse',
    'fake_police',
    'fake_callback',
    'spare_key_entry',
    'window_route',
    'wait_for_fatigue',
  ].filter((type) => text.includes(type));
}

function projectKillerVisiblePhase(state: GameState): GameState['phase'] {
  if (
    !killerKnowsPoliceCalled(state)
    && (state.phase === 'police_called' || state.phase === 'confrontation')
  ) {
    return state.threat >= 48 ? 'killer_pressure' : 'investigating';
  }
  return state.phase;
}

export function killerKnowsPoliceCalled(state: GameState): boolean {
  return state.killerKnowledge.knowsPoliceCalled || chenKnowsPoliceCalled(state.world);
}
