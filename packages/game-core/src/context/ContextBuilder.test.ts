import { strict as assert } from 'node:assert';
import type { RuleEvent, RuleResult, WorldEvent } from '@murder-loop-ai/shared';
import type { AgentTraceEntryContract } from '@murder-loop-ai/ai-contracts';
import { DirectorAgentInputSchema, KillerAgentInputSchema, NarratorAgentInputSchema } from '@murder-loop-ai/ai-contracts';
import { createInitialGameState } from '../state/createInitialState';
import { createInitialWorldState } from '../world/worldSimulator';
import {
  buildDirectorContext,
  buildKillerContext,
  buildNarratorContext,
  buildParserContext,
} from './ContextBuilder';

function event(subject: string, visibility: RuleEvent['visibility']): RuleEvent {
  return {
    kind: 'action',
    subject,
    summary: `${subject} summary`,
    sensoryHints: [`${subject} hint`],
    visibility,
  };
}

function ruleResult(events: RuleEvent[] = [], state = createInitialGameState()): RuleResult {
  return {
    title: 'rule',
    text: 'rule text',
    tone: 'neutral',
    addedClues: [],
    timePassed: 1,
    threatDelta: 0,
    events,
    state,
  };
}

{
  const state = createInitialGameState();
  for (let index = 0; index < 5; index += 1) {
    state.memory.shortTerm.push({
      id: `short-${index}`,
      run: 1,
      minute: 1380 + index,
      title: `short ${index}`,
      text: `short text ${index}`,
      scope: 'short_term',
      kind: 'action',
    });
  }

  const context = buildParserContext('check the door', state);

  assert.equal(context.input, 'check the door');
  assert.equal(context.recentMemory.length, 3);
  assert(context.recentMemory[0].includes('short 2'));
  assert.equal('room' in context.stateSummary, false);
  assert(context.worldInfo.some((card) => card.id === 'object.front_door'));
  assert(!context.worldInfo.some((card) => card.id === 'style.no_player_mind_reading'));
}

{
  const state = createInitialGameState();
  state.memory.crossRun.push({
    id: 'player-death-memory',
    run: 1,
    title: 'player death',
    text: 'player remembers the last death',
    scope: 'cross_run',
    kind: 'death',
    owner: 'player',
  });
  state.memory.characters.killer.push({
    id: 'killer-visible-memory',
    run: 1,
    title: 'killer noticed door',
    text: 'killer saw the chair near the door',
    scope: 'character',
    kind: 'observation',
    owner: 'killer',
  });

  const context = buildKillerContext(state, {
    plan: {
      id: 'plan-1',
      raw: 'photograph the package',
      summary: 'photograph the package',
      actions: [],
      confidence: 1,
      warnings: [],
    },
    playerResult: ruleResult([
      event('phone_screen_lit', 'killer'),
      event('linyue_received_photo', 'hidden'),
      event('player_breathing', 'player'),
    ]),
  });

  assert(context.visibleState.knowledge);
  assert.deepEqual(context.observableEvents.map((item) => item.subject), ['phone_screen_lit']);
  assert.equal(context.planSummary, 'phone_screen_lit summary');
  assert(context.recentKillerMemory.some((line) => line.includes('killer noticed door')));
  assert(!context.recentKillerMemory.some((line) => line.includes('player-death-memory')));
  assert(context.worldInfo.some((card) => card.id === 'rule.killer_visibility'));
  assert(!context.worldInfo.some((card) => card.id === 'clue.linyue_has_photo'));
  assert(!context.worldInfo.some((card) => card.id === 'style.no_player_mind_reading'));
  assert(context.uncertainty.some((line) => line.includes('hidden player facts')));
  assert.equal(KillerAgentInputSchema.safeParse({ killerContext: context }).success, true);
  assert.equal(KillerAgentInputSchema.safeParse({ killerContext: context, state }).success, false);
}

{
  const state = createInitialGameState();
  state.memory.crossRun.push({
    id: 'previous-loop',
    run: 1,
    title: 'previous loop',
    text: 'the lock clicked before death',
    scope: 'cross_run',
    kind: 'death',
    owner: 'player',
  });
  const playerResult = ruleResult([event('package_opened', 'player')], state);
  const killerResult = ruleResult([event('knock_heard', 'player')], state);

  const context = buildNarratorContext({
    state,
    playerResult,
    killerResult,
  });

  const contextRecord = context as unknown as Record<string, unknown>;
  assert.equal('playerInput' in contextRecord, false);
  assert.equal('recentLog' in contextRecord, false);
  assert.equal('memorySummary' in contextRecord, false);
  assert.equal('worldInfo' in contextRecord, false);
  assert(context.confirmedFacts.some((fact) => fact.subject === 'package_opened'));
  assert(context.confirmedFacts.some((fact) => fact.subject === 'knock_heard'));
  assert.equal(NarratorAgentInputSchema.safeParse({ narrationContext: context }).success, true);
  assert.equal(NarratorAgentInputSchema.safeParse({ narrationContext: context, state }).success, false);
  assert.equal(NarratorAgentInputSchema.safeParse({
    narrationContext: { ...context, playerInput: 'unconfirmed action' },
  }).success, false);
  assert(context.forbiddenFacts.some((line) => line.includes('不要改变死亡')));
}

{
  const state = createInitialGameState();
  state.world = createInitialWorldState();
  const conflictEvent: WorldEvent = {
    id: 'conflict.chen_intercepts_linyue',
    minute: state.minute + 1,
    type: 'conflict',
    actors: ['chen_huaimin', 'lin_yue'],
    location: 'corridor_5f',
    facts: ['chen_intercepts_linyue', 'linyue_has_external_evidence'],
    visibility: 'player',
    effects: [],
    narrationHint: 'Narrate only the confirmed corridor encounter.',
  };
  state.world.events.push(conflictEvent);
  state.world.pendingNarration = [conflictEvent];
  const playerResult = ruleResult([event('package_opened', 'player')], state);
  const killerResult = ruleResult([event('knock_heard', 'player')], state);

  const context = buildNarratorContext({
    state,
    playerResult,
    killerResult,
  });

  assert.equal(context.confirmedWorldEvents?.length, 1);
  assert.equal(context.confirmedWorldEvents?.[0].id, 'conflict.chen_intercepts_linyue');
  assert.deepEqual(context.confirmedWorldEvents?.[0].facts, ['chen_intercepts_linyue', 'linyue_has_external_evidence']);
  assert.equal('effects' in (context.confirmedWorldEvents?.[0] ?? {}), false);
  assert(context.confirmedFacts.some((fact) => fact.id === 'conflict.chen_intercepts_linyue'));
  assert(context.forbiddenFacts.some((line) => line.includes('confirmedWorldEvents')));

  state.world.narrationCursor = state.world.events.length;
  const replayContext = buildNarratorContext({ state, playerResult, killerResult });
  assert.deepEqual(replayContext.confirmedWorldEvents, []);
  assert.equal(
    replayContext.confirmedFacts.some((fact) => fact.id === 'conflict.chen_intercepts_linyue'),
    false,
  );
}

{
  const state = createInitialGameState();
  const trace: AgentTraceEntryContract[] = [
    {
      agent: 'parser',
      eventType: 'PlayerActionSubmitted',
      mode: 'ai',
      input: { input: 'check door' },
      output: { summary: 'check door' },
      validation: { valid: true, errors: [] },
      durationMs: 12,
      timestamp: '2026-07-15T00:00:00.000Z',
    },
  ];

  const before = JSON.stringify(state);
  const playerResult = ruleResult([event('door_checked', 'player')]);
  const killerResult = ruleResult();
  const context = buildDirectorContext({
    state,
    narration: { title: 'Door', text: 'The door stays shut.' },
    actionNarration: { title: 'Door', text: 'The door stays shut.' },
    ambientNarration: { title: 'Rain', text: 'Rain continues.' },
    playerResult,
    killerResult,
    agentTrace: trace,
  });

  assert.equal(JSON.stringify(state), before);
  assert.equal(context.traceSummary[0]?.agent, 'parser');
  assert(context.worldInfo.some((card) => card.id === 'rule.world_info_not_authority'));
  assert(context.worldInfo.some((card) => card.id === 'rule.narrator_no_rule_change'));
  assert(context.consistencyChecklist.some((line) => line.includes('rule results')));
  const narrationContext = buildNarratorContext({ state, playerResult, killerResult });
  assert.equal(DirectorAgentInputSchema.safeParse({ directorContext: context, narrationContext }).success, true);
  assert.equal(DirectorAgentInputSchema.safeParse({ directorContext: context, narrationContext, state }).success, false);
}
