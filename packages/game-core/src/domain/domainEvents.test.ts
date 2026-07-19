import assert from 'node:assert/strict';
import type { DomainEvent, PlayerCommand, RenderArtifact, SimulationIntent, TraceLog, TurnDomainConcept } from './domainEvents';
import {
  isAuthoritativeConcept,
  isDomainEvent,
  isPlayerCommand,
  isRenderArtifact,
} from './domainEvents';

const createdAt = { run: 1, minute: 23 * 60 };

function testConceptKindsStaySeparated() {
  const command: PlayerCommand = {
    id: 'cmd-photo-package',
    kind: 'command',
    source: 'parser',
    createdAt,
    actor: 'player',
    commandType: 'preserve_evidence',
    raw: '把包裹拍照',
    target: 'package',
    confidence: 0.98,
    timeCost: 1,
    noise: 0,
    risk: 'low',
  };

  const event: DomainEvent = {
    id: 'evt-package-photographed',
    kind: 'domain_event',
    source: 'rule',
    createdAt,
    causationId: command.id,
    eventType: 'package_photographed',
    authority: 'game',
    subject: 'package',
    summary: 'The package photo was confirmed by rules.',
    facts: ['package_photo_exists'],
    visibility: 'player',
    clueIds: ['package_photo'],
  };

  const artifact: RenderArtifact = {
    id: 'artifact-action-narration',
    kind: 'render_artifact',
    source: 'narrator',
    createdAt,
    causationId: event.id,
    artifactType: 'action_narration',
    basedOnEventIds: [event.id],
    consumer: 'player',
    isAuthoritative: false,
    payload: {
      title: '照片留下来了',
      text: '屏幕冷光照亮了包裹边缘。',
    },
  };

  const concepts: TurnDomainConcept[] = [command, event, artifact];

  assert.equal(isPlayerCommand(concepts[0]), true);
  assert.equal(isDomainEvent(concepts[1]), true);
  assert.equal(isRenderArtifact(concepts[2]), true);
  assert.equal(isAuthoritativeConcept(command), false);
  assert.equal(isAuthoritativeConcept(event), true);
  assert.equal(isAuthoritativeConcept(artifact), false);
}

function testSimulationIntentRequiresDomainReview() {
  const intent: SimulationIntent = {
    id: 'intent-killer-phone-probe',
    kind: 'simulation_intent',
    source: 'killer',
    createdAt,
    intentType: 'killer_plan_proposed',
    proposer: 'killer',
    actorId: 'chen_huaimin',
    requiresDomainReview: true,
    confidence: 0.75,
    rationale: 'The player may have noticed the package.',
  };

  assert.equal(intent.requiresDomainReview, true);
  assert.equal(isAuthoritativeConcept(intent), false);
}

function testTraceLogIsObservationOnly() {
  const trace: TraceLog = {
    id: 'trace-parser-fallback',
    kind: 'trace_log',
    source: 'system',
    createdAt,
    traceType: 'fallback_used',
    observedConceptIds: ['cmd-photo-package'],
    isAuthoritative: false,
    warnings: ['parser AI failed; fallback used'],
  };

  assert.equal(trace.isAuthoritative, false);
  assert.equal(isAuthoritativeConcept(trace), false);
}

testConceptKindsStaySeparated();
testSimulationIntentRequiresDomainReview();
testTraceLogIsObservationOnly();
