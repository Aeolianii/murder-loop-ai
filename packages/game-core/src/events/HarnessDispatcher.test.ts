import assert from 'node:assert/strict';
import { z } from 'zod';
import { GameEventBus } from './EventBus';
import { AgentRegistry, type AgentRegistration } from './AgentRegistry';
import { HarnessDispatcher } from './HarnessDispatcher';
import { RuleAgent } from '../agents/RuleAgent';
import { fallbackParseAction } from '../actions/fallbackParser';
import { createInitialGameState } from '../state/createInitialState';

const baseContract = {
  version: '1.0.0',
  input: z.any(),
  output: z.object({ value: z.string() }),
  validate: true,
};

function createAgent(overrides: Partial<AgentRegistration>): AgentRegistration {
  return {
    id: 'parser',
    subscriptions: [{ event: 'PlayerActionSubmitted', priority: 10, role: 'primary' }],
    contract: baseContract,
    handler: async () => ({ value: 'ai' }),
    fallback: async () => ({ value: 'fallback' }),
    mode: 'ai',
    ...overrides,
  };
}

async function testCommandUsesPrimaryAgentResult() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({}));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'ai' });
  assert.equal(dispatcher.getTrace()[0].agentId, 'parser');
  assert.equal(dispatcher.getTrace()[0].source, 'ai');
}

async function testCommandFallsBackWhenAiThrows() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    handler: async () => {
      throw new Error('ai down');
    },
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'fallback' });
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
  assert.match(dispatcher.getTrace()[0].warnings[0], /ai down/);
}

async function testCommandFallsBackWhenAiViolatesContract() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    handler: async () => ({ wrong: true }),
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'fallback' });
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
  assert.match(dispatcher.getTrace()[0].warnings[0], /output violation|parser.*output/i);
  assert.equal(dispatcher.getAgentTrace()[0].agent, 'parser');
  assert.equal(dispatcher.getAgentTrace()[0].mode, 'fallback');
  assert.equal(dispatcher.getAgentTrace()[0].validation.valid, false);
  assert.match(dispatcher.getAgentTrace()[0].validation.errors[0], /output violation|parser.*output/i);
  assert.deepEqual(dispatcher.getAgentTrace()[0].output, { value: 'fallback' });
}

async function testFallbackModeTraceUsesFallbackSource() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({ mode: 'fallback' }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'fallback' });
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
  assert.equal(dispatcher.getAgentTrace()[0].mode, 'fallback');
  assert.equal(dispatcher.getAgentTrace()[0].validation.valid, true);
}

async function testAgentTraceRecordsWorldInfoSummary() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({}));
  const dispatcher = new HarnessDispatcher(bus, registry);

  await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'check the door',
    state: {} as never,
    traceContext: {
      worldInfo: [{
        id: 'object.front_door',
        title: '入户门',
        content: 'full card content should stay out of trace summary',
        tags: ['object', 'door'],
        priority: 8,
        source: 'derived',
      }],
    },
  } as never);

  const trace = dispatcher.getAgentTrace()[0];
  assert.deepEqual(trace.worldInfo, [{
    id: 'object.front_door',
    title: '入户门',
    source: 'derived',
    priority: 8,
  }]);
  assert.equal('content' in (trace.worldInfo?.[0] ?? {}), false);
}

async function testFallbackModeFailureTraceUsesFallbackSource() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    fallback: async () => ({ wrong: true }),
    mode: 'fallback',
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  await assert.rejects(
    () => dispatcher.runCommand('PlayerActionSubmitted', {
      input: 'look around',
      state: {} as never,
    }),
    /output violation/,
  );
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
}

async function testCommandRejectsInvalidFallbackOutput() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    handler: async () => {
      throw new Error('ai down');
    },
    fallback: async () => ({ wrong: true }),
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  await assert.rejects(
    () => dispatcher.runCommand('PlayerActionSubmitted', {
      input: 'look around',
      state: {} as never,
    }),
    /output violation/,
  );
}

async function testRuleAgentRejectsMalformedDeterministicOutput() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register({
    ...RuleAgent,
    fallback: async () => ({ wrong: true }),
  });
  const dispatcher = new HarnessDispatcher(bus, registry);

  await assert.rejects(
    () => dispatcher.runCommand('ActionParsed', {
      plan: fallbackParseAction('check the package'),
      state: createInitialGameState(),
    }),
    /rule.*output violation/i,
  );
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
  assert.equal(dispatcher.getAgentTrace()[0].validation.valid, false);
  assert.match(dispatcher.getAgentTrace()[0].validation.errors[0], /output violation/i);
}

async function testCommandRunsObserverArtifacts() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({}));
  registry.register({
    ...createAgent({
      id: 'sidebar',
      subscriptions: [{ event: 'PlayerActionSubmitted', priority: 20, role: 'observer' }],
      handler: async () => ({ value: 'observer' }),
      fallback: async () => ({ value: 'observer-fallback' }),
    }),
  });
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'ai' });
  assert.equal(dispatcher.getTrace().length, 2);
  assert.deepEqual(dispatcher.getLatestArtifact('sidebar', 'PlayerActionSubmitted'), { value: 'observer' });
}

async function testObserversCanRunWithoutPrimaryCommand() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  let primaryCalls = 0;
  registry.register(createAgent({
    handler: async () => {
      primaryCalls += 1;
      return { value: 'primary' };
    },
  }));
  registry.register(createAgent({
    id: 'sidebar',
    subscriptions: [{ event: 'PlayerActionSubmitted', priority: 20, role: 'observer' }],
    handler: async () => ({ value: 'observer-only' }),
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const results = await dispatcher.runObservers('PlayerActionSubmitted', {
    input: 'prepared elsewhere',
    state: {} as never,
  });

  assert.equal(primaryCalls, 0);
  assert.deepEqual(results, [{ value: 'observer-only' }]);
  assert.deepEqual(dispatcher.getLatestArtifact('sidebar', 'PlayerActionSubmitted'), { value: 'observer-only' });
}

async function testDeferredCriticDoesNotBlockAndRecordsDiagnosticArtifact() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  let releaseCritic!: () => void;
  const criticGate = new Promise<void>((resolve) => {
    releaseCritic = resolve;
  });
  registry.register(createAgent({
    id: 'director',
    subscriptions: [{ event: 'NarrationCritiqueRequested', priority: 80, role: 'reviewer', defer: true }],
    handler: async () => {
      await criticGate;
      return { value: 'critique' };
    },
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  dispatcher.dispatchDeferred('NarrationCritiqueRequested', {
    directorContext: {},
    narrationContext: {} as never,
  });

  assert.equal(dispatcher.getLatestArtifact('director', 'NarrationCritiqueRequested'), undefined);
  releaseCritic();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    dispatcher.getLatestArtifact('director', 'NarrationCritiqueRequested'),
    { value: 'critique' },
  );
}

await testCommandUsesPrimaryAgentResult();
await testCommandFallsBackWhenAiThrows();
await testCommandFallsBackWhenAiViolatesContract();
await testFallbackModeTraceUsesFallbackSource();
await testAgentTraceRecordsWorldInfoSummary();
await testFallbackModeFailureTraceUsesFallbackSource();
await testCommandRejectsInvalidFallbackOutput();
await testRuleAgentRejectsMalformedDeterministicOutput();
await testCommandRunsObserverArtifacts();
await testObserversCanRunWithoutPrimaryCommand();
await testDeferredCriticDoesNotBlockAndRecordsDiagnosticArtifact();
