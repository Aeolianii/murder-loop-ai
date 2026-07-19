import assert from 'node:assert/strict';
import type {
  Proposal,
  ProposalDomain,
  SemanticCompilerRequest,
  SpecialistCandidate,
  TurnBrief,
  TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  finalizeShadowRun,
  runShadowCandidateWave,
  type ShadowCandidateAdapter,
  type ShadowSpecialistRegistration,
} from './shadowRunner';

function envelope(deadlineAt: string): TurnEnvelope {
  return {
    loopId: 'legacy-run-1',
    turnId: 'shadow-turn-1',
    inputStateVersion: 0,
    deadlineAt,
  };
}

function brief(turnEnvelope: TurnEnvelope): TurnBrief {
  return {
    ...turnEnvelope,
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    utteranceMode: 'command',
    resolvedReferences: [],
    orderedActions: [{
      actionId: 'action-1',
      actorId: 'player',
      operation: 'wait',
      targetIds: ['room_503'],
      dependsOnActionIds: [],
      inputHandleIds: [],
      outputHandleIds: [],
      originalSpan: { start: 0, end: 2, text: '等待' },
    }],
    globalConstraints: [],
    scopedConstraints: [],
    communications: [],
    candidateHandles: [],
    ambiguities: [],
  };
}

function proposal(
  turnEnvelope: TurnEnvelope,
  sourceAgent: string,
  domain: ProposalDomain,
  rank = 0,
): Proposal {
  const eventId = `event.shadow.${sourceAgent}.${domain}`.replace(/:/g, '.');
  return {
    ...turnEnvelope,
    id: `proposal.${sourceAgent}.${domain}`.replace(/:/g, '.'),
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: 'world-model-v1',
    sourceAgent,
    domain,
    candidateRank: rank,
    turnBriefActionIds: ['action-1'],
    replacementFor: [],
    actorId: domain === 'killer' ? 'killer' : 'player',
    operation: 'wait',
    targetIds: ['room_503'],
    basedOnFactIds: [],
    preconditions: [],
    forbiddenScopes: [],
    proposedEffects: [],
    observations: [],
    visibility: ['player'],
    confidence: 0.8,
    riskClass: 'reversible',
    evidenceRefs: [],
    causalParentIds: [],
    proposedEvents: [{
      id: eventId,
      eventType: `${domain}_waited`,
      subject: domain,
      summary: `${domain} waited`,
      facts: [`fact.shadow.${domain}.waited`],
      visibility: ['player'],
      riskClass: 'reversible',
      evidenceRefs: [],
      causalParentIds: [],
    }],
    clueCandidates: [],
    recommendations: [],
    displayFragments: [{
      id: `display.${eventId}`,
      text: `${domain} waited`,
      eventRefs: [eventId],
      claimRefs: [`fact.shadow.${domain}.waited`],
    }],
  };
}

function specialistCandidate(
  turnEnvelope: TurnEnvelope,
  id: string,
  domain: ProposalDomain,
): SpecialistCandidate {
  return {
    ...proposal(turnEnvelope, id, domain, 1),
    candidateType: 'specialist',
    specialistId: id,
  };
}

function registrations(
  run: (id: string, domain: ProposalDomain, context: Parameters<ShadowCandidateAdapter>[1]) => Promise<unknown>,
): ShadowSpecialistRegistration[] {
  return [
    ['player-specialist', 'player'],
    ['killer-specialist', 'killer'],
    ['npc-specialist:lin_yue', 'npc'],
    ['npc-specialist:police_dispatch', 'npc'],
    ['environment-specialist', 'environment'],
    ['clue-specialist', 'clue'],
    ['recommendation-specialist', 'recommendation'],
  ].map(([id, domain]) => ({
    id,
    domain: domain as ProposalDomain,
    npcId: id.startsWith('npc-specialist:') ? id.split(':')[1] : undefined,
    generate: (projection, context) => run(id, domain as ProposalDomain, context),
  }));
}

{
  const state = createInitialGameState();
  const before = JSON.stringify(state);
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const started: string[] = [];
  const signals = new Set<AbortSignal>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const semanticCompiler = {
    async compile(request: SemanticCompilerRequest, context?: { signal: AbortSignal }) {
      assert.equal('state' in request, false);
      assert(!JSON.stringify(request).includes('killerKnowledge'));
      assert(context?.signal);
      return { status: 'compiled' as const, brief: brief(turnEnvelope) };
    },
  };
  const mainWorldModel: ShadowCandidateAdapter = async (_projection, context) => {
    started.push('main-world-model');
    signals.add(context.signal);
    assert.equal(context.envelope.deadlineAt, turnEnvelope.deadlineAt);
    await gate;
    const proposals = ['player', 'killer', 'npc', 'environment', 'clue', 'recommendation']
      .map((domain) => proposal(turnEnvelope, 'main-world-model', domain as ProposalDomain));
    const killerProposal = proposals.find((candidate) => candidate.domain === 'killer');
    if (killerProposal) killerProposal.basedOnFactIds = ['fact.player.phone_functional'];
    return proposals;
  };
  const specialists = registrations(async (id, domain, context) => {
    started.push(id);
    signals.add(context.signal);
    assert.equal(context.envelope.deadlineAt, turnEnvelope.deadlineAt);
    await gate;
    return [specialistCandidate(turnEnvelope, id, domain)];
  });

  const wavePromise = runShadowCandidateWave({
    state,
    rawInput: '等待',
    envelope: turnEnvelope,
    adapters: { semanticCompiler, mainWorldModel, specialists },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: ['invariant.package_interior_requires_open'],
    compilerTimeoutMs: 200,
  });

  for (let attempt = 0; attempt < 50 && started.length < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(started.length, 8, 'all second-wave adapters must start before any result is released');
  assert.equal(signals.size, 1, 'all second-wave adapters must share one cancellation signal');
  release();

  const wave = await wavePromise;
  assert.equal(wave.status, 'completed');
  assert.equal(wave.callRecords.every((record) => record.status === 'completed'), true);
  assert.equal(wave.mainProposals.length, 6);
  assert.equal(wave.specialistCandidates.length, 7);
  assert.equal(wave.arbitration?.transition.fallbackDomains.length, 0);
  assert.equal(wave.arbitration?.transition.selectedSourceByDomain.killer, 'killer-specialist');
  assert(wave.arbitration?.rejectedProposals.some((item) => (
    item.proposalId === 'proposal.main-world-model.killer'
    && item.reasonCodes.includes('unauthorized_fact_reference')
  )));
  assert.equal(JSON.stringify(state), before, 'Shadow candidate generation must not mutate formal state');

  const legacyPlan: ActionPlan = {
    id: 'legacy-plan',
    raw: '等待',
    summary: '等待',
    actions: [{
      id: 'legacy-action-1',
      raw: '等待',
      intent: 'wait',
      target: 'room_503',
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low',
    }],
    confidence: 1,
    warnings: [],
  };
  const report = finalizeShadowRun({
    wave,
    legacyPlan,
    legacyEvents: [],
    current: { loopId: turnEnvelope.loopId, stateVersion: 0, committedTurnIds: [] },
  });
  assert.equal(report.semanticComparison.equivalent, true);
  assert.equal(report.simulatedCommit.result.commitStatus, 'committed');
  assert.equal(report.metrics.schemaSuccessRate, 1);
  assert.equal(report.replay.envelope.turnId, turnEnvelope.turnId);
  assert.equal(report.replay.mainProposals.length, 6);
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 80).toISOString());
  let observedAbort = false;
  const specialists = registrations(async (id, domain, context) => {
    if (id === 'clue-specialist') {
      context.signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
      return new Promise(() => undefined);
    }
    if (id === 'recommendation-specialist') return {};
    return [specialistCandidate(turnEnvelope, id, domain)];
  });
  const wave = await runShadowCandidateWave({
    state: createInitialGameState(),
    rawInput: '等待',
    envelope: turnEnvelope,
    adapters: {
      semanticCompiler: {
        async compile() {
          return { status: 'compiled' as const, brief: brief(turnEnvelope) };
        },
      },
      mainWorldModel: async () => [proposal(turnEnvelope, 'main-world-model', 'player')],
      specialists,
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
    compilerTimeoutMs: 20,
  });

  assert.equal(wave.callRecords.find((record) => record.sourceAgent === 'clue-specialist')?.status, 'timed_out');
  assert.equal(
    wave.callRecords.find((record) => record.sourceAgent === 'recommendation-specialist')?.status,
    'schema_invalid',
  );
  assert.equal(observedAbort, true);
  assert.equal(wave.specialistCandidates.some((candidate) => candidate.sourceAgent === 'clue-specialist'), false);
}
