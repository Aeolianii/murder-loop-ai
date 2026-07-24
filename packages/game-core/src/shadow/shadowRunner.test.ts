import assert from 'node:assert/strict';
import {
  WORLD_MODEL_SCHEMA_VERSION,
  type Proposal,
  type ProposalDomain,
  type SemanticCompilerRequest,
  type SpecialistCandidate,
  type TurnBrief,
  type TurnEnvelope,
} from '@murder-loop-ai/ai-contracts';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import {
  compileShadowTurnBrief,
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
    schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
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
  const actorId = domain === 'killer'
    ? 'killer'
    : domain === 'npc'
      ? sourceAgent.includes('police_dispatch')
        ? 'real_police'
        : 'lin_yue'
      : 'player';
  const operation = domain === 'killer'
    ? 'enter'
    : domain === 'npc'
      ? 'move'
      : 'wait';
  const event = ['player', 'killer', 'npc'].includes(domain)
    ? [{
        id: eventId,
        kind: domain === 'npc' ? 'state_transition' as const : 'action' as const,
        sourceActionIds: domain === 'player' ? ['action-1'] : [],
        actorId,
        operation,
        targetIds: ['room_503'],
        status: 'completed' as const,
        summary: `${domain} completed ${operation}`,
        assertions: [{
          id: `assertion.shadow.${domain}.${operation}`,
          subject: domain,
          predicate: 'result',
          value: operation,
          visibleTo: ['player'],
        }],
        visibility: ['player'],
        riskClass: 'reversible' as const,
        evidenceRefs: [],
        causalParentIds: [],
      }]
    : [];
  return {
    ...turnEnvelope,
    id: `proposal.${sourceAgent}.${domain}`.replace(/:/g, '.'),
    compilerVersion: 'semantic-compiler-v1',
    schemaVersion: WORLD_MODEL_SCHEMA_VERSION,
    sourceAgent,
    domain,
    candidateRank: rank,
    turnBriefActionIds: domain === 'player' ? ['action-1'] : [],
    replacementFor: [],
    actorId,
    operation: event[0]?.operation ?? 'no_op',
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
    proposedEvents: event,
    clueCandidates: [],
    recommendations: [],
    displayFragments: event.map((item) => ({
      id: `display.${eventId}`,
      text: item.summary,
      eventRefs: [eventId],
      claimRefs: item.assertions.map((assertion) => assertion.id),
    })),
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
      assert(
        request.playerContext.availableAssets?.some((asset) => (
          asset.id === 'asset.physical.phone'
          && asset.ownerId === 'player'
        )),
        'Semantic Compiler must receive a read-only projection of the player assets.',
      );
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
  assert.equal(report.replay.legacyPlan.id, legacyPlan.id);
  assert.equal(report.replay.current.stateVersion, 0);
  assert.equal(report.replay.semantic.status, 'compiled');
  assert.equal(report.replay.callRecords.length, 8);
  assert.equal(typeof report.replay.completedAt, 'string');
}

{
  const prefetchedEnvelope = envelope(new Date(Date.now() + 1_000).toISOString());
  const formalEnvelope: TurnEnvelope = {
    ...prefetchedEnvelope,
    turnId: 'shadow-turn-prefetch-hit',
    deadlineAt: new Date(Date.now() + 2_000).toISOString(),
  };
  let compilerCalls = 0;
  let observedBrief: TurnBrief | undefined;
  const specialists = registrations(async (id, domain) => (
    [specialistCandidate(formalEnvelope, id, domain)]
  ));

  const wave = await runShadowCandidateWave({
    state: createInitialGameState(),
    rawInput: '等待',
    envelope: formalEnvelope,
    precompiledBrief: brief(prefetchedEnvelope),
    adapters: {
      semanticCompiler: {
        async compile() {
          compilerCalls += 1;
          throw new Error('a validated prefetched brief must skip semantic compilation');
        },
      },
      mainWorldModel: async (projection) => {
        observedBrief = (projection as { turnBrief?: TurnBrief }).turnBrief;
        return [proposal(formalEnvelope, 'main-world-model', 'player')];
      },
      specialists,
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
    compilerTimeoutMs: 20,
  });

  assert.equal(compilerCalls, 0, 'a semantic prefetch hit must remove the compiler from the formal critical path');
  assert.equal(wave.semantic.status, 'compiled');
  assert.ok(wave.semantic.issues.includes('semantic_prefetch_hit'));
  assert.equal(wave.turnBrief?.turnId, formalEnvelope.turnId);
  assert.equal(wave.turnBrief?.deadlineAt, formalEnvelope.deadlineAt);
  assert.equal(observedBrief?.turnId, formalEnvelope.turnId);
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const playerCandidate = specialistCandidate(
    turnEnvelope,
    'player-specialist',
    'player',
  );
  playerCandidate.displayFragments[0].claimRefs = [];

  const wave = await runShadowCandidateWave({
    state: createInitialGameState(),
    rawInput: '尝试打开窗户',
    envelope: turnEnvelope,
    adapters: {
      semanticCompiler: {
        async compile() {
          return { status: 'compiled' as const, brief: brief(turnEnvelope) };
        },
      },
      mainWorldModel: async () => ({ proposals: [] }),
      specialists: registrations(async (id, domain) => (
        id === 'player-specialist'
          ? { candidates: [playerCandidate] }
          : { candidates: [specialistCandidate(turnEnvelope, id, domain)] }
      )),
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
    compilerTimeoutMs: 20,
  });

  const normalizedPlayerCandidate = wave.specialistCandidates.find(
    (candidate) => candidate.id === playerCandidate.id,
  );
  assert.deepEqual(
    normalizedPlayerCandidate?.displayFragments[0].claimRefs,
    playerCandidate.proposedEvents[0].assertions.map((assertion) => assertion.id),
    'missing display claim refs must be completed from the fragment referenced visible events',
  );
  assert.equal(
    wave.arbitration?.transition.fallbackDomains.includes('player'),
    false,
    'a recoverable display reference omission must not discard the player outcome',
  );
  assert.equal(
    wave.arbitration?.rejectedProposals.some((rejection) => (
      rejection.proposalId === playerCandidate.id
      && rejection.reasonCodes.includes('display_claim_reference_invalid')
    )),
    false,
  );
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const hiddenClaimCandidate = specialistCandidate(
    turnEnvelope,
    'player-specialist',
    'player',
  );
  hiddenClaimCandidate.proposedEvents[0].visibility = ['killer'];
  hiddenClaimCandidate.proposedEvents[0].assertions[0].visibleTo = ['killer'];
  hiddenClaimCandidate.displayFragments[0].claimRefs = [];

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
      mainWorldModel: async () => ({ proposals: [] }),
      specialists: registrations(async (id, domain) => (
        id === 'player-specialist'
          ? { candidates: [hiddenClaimCandidate] }
          : { candidates: [specialistCandidate(turnEnvelope, id, domain)] }
      )),
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
    compilerTimeoutMs: 20,
  });

  const parsedHiddenCandidate = wave.specialistCandidates.find(
    (candidate) => candidate.id === hiddenClaimCandidate.id,
  );
  assert.deepEqual(
    parsedHiddenCandidate?.displayFragments[0].claimRefs,
    [],
    'hidden assertions must never be promoted into player display claim refs',
  );
  assert(
    wave.arbitration?.rejectedProposals.some((rejection) => (
      rejection.proposalId === hiddenClaimCandidate.id
      && rejection.reasonCodes.includes('display_claim_reference_invalid')
    )),
    'the existing arbiter must still reject fragments that have no visible grounded claim',
  );
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const controller = new AbortController();
  let observedAbort = false;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending = new Promise<never>(() => undefined);
  const compilation = compileShadowTurnBrief({
    state: createInitialGameState(),
    rawInput: '等待',
    envelope: turnEnvelope,
    semanticCompiler: {
      async compile(_request, context) {
        context?.signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
        markStarted();
        return pending;
      },
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    compilerTimeoutMs: 1_000,
    signal: controller.signal,
  });

  await started;
  controller.abort('natural_language_submitted');
  const result = await compilation;
  assert.equal(result.brief, undefined);
  assert.ok(result.record.issues.includes('semantic_compiler_cancelled'));
  assert.equal(observedAbort, true, 'cancelling semantic prefetch must reach the compiler adapter');
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

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const specialists = registrations(async (id, domain) => {
    const candidate = specialistCandidate(turnEnvelope, id, domain) as SpecialistCandidate & {
      scope?: string;
    };
    if (id === 'player-specialist') {
      candidate.scope = 'model-only-extra-field';
      candidate.observations = [{
        id: 'observation.invalid-enrichment',
        subject: 'room_503',
        predicate: 'looked_at',
        value: true,
        scope: 'visible',
        basedOnEffectIds: [],
        basedOnEventIds: [],
        visibleAssertionIds: [],
      }];
      candidate.recommendations = [{
        id: 'recommendation.out-of-domain',
        label: '无权威的建议',
        rationale: '这个字段不属于玩家结果域。',
        basedOnFactIds: ['fact.not-authorized'],
        basedOnEventIds: [],
      }];
    }
    return [candidate];
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
      mainWorldModel: async () => ({}),
      specialists,
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
    compilerTimeoutMs: 1_000,
  });

  const playerRecord = wave.callRecords.find(
    (record) => record.sourceAgent === 'player-specialist',
  );
  assert.equal(
    playerRecord?.status,
    'partial',
    'safe contract recovery must remain visible in telemetry',
  );
  assert.equal(playerRecord?.schemaValidCount, 1);
  assert(
    wave.specialistCandidates.some((candidate) => (
      candidate.sourceAgent === 'player-specialist'
      && !('scope' in candidate)
      && candidate.observations.length === 0
      && candidate.recommendations.length === 0
    )),
    'invalid non-authoritative enrichment must be removed without discarding the event graph',
  );
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const fallbackRawInput = 'fallback-secret-raw-input';
  let mainProjection: unknown;
  const specialistProjections: Array<{ id: string; projection: unknown }> = [];
  const specialists = registrations(async (_id, _domain, _context) => ({}));
  for (const registration of specialists) {
    const generate = registration.generate;
    registration.generate = async (projection, context) => {
      specialistProjections.push({ id: registration.id, projection });
      return generate(projection, context);
    };
  }

  const wave = await runShadowCandidateWave({
    state: createInitialGameState(),
    rawInput: fallbackRawInput,
    envelope: turnEnvelope,
    adapters: {
      semanticCompiler: {
        async compile() {
          throw new Error('compiler unavailable');
        },
      },
      mainWorldModel: async (projection) => {
        mainProjection = projection;
        return {};
      },
      specialists,
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: ['canonical.rule_kernel_is_authoritative'],
    compilerTimeoutMs: 20,
  });

  assert.equal(wave.status, 'completed', 'compiler failure should enter a second-wave fallback');
  assert.equal(wave.semantic.status, 'failed');
  assert.equal((mainProjection as { fallbackMode?: string }).fallbackMode, 'raw_input');
  assert.equal((mainProjection as { rawInput?: string }).rawInput, fallbackRawInput);
  assert.deepEqual(
    (mainProjection as { canonicalStoryMaterial?: Array<{ id: string }> })
      .canonicalStoryMaterial
      ?.map((material) => material.id),
    [
      'material.handoff_2347',
      'material.room_403_receipt',
      'material.lin_yue_retracted_message',
      'material.fake_store_call',
    ],
  );
  assert.equal(specialistProjections.length, 7, 'all Specialists still run on conservative projections');
  assert.equal(
    specialistProjections.some(({ projection }) => JSON.stringify(projection).includes(fallbackRawInput)),
    false,
    'no Specialist may receive raw input during compiler fallback',
  );
  assert.equal(
    specialistProjections.some(({ projection }) => JSON.stringify(projection).includes('material.handoff_2347')),
    false,
    'authored story material must remain scoped to the Main World Model',
  );
  assert.deepEqual(
    (specialistProjections.find(({ id }) => id === 'clue-specialist')?.projection as {
      clueDefinitions?: Array<{ id: string }>;
    }).clueDefinitions?.map((definition) => definition.id),
    ['wrong_package', 'package_contents', 'package_photo', 'linyue_has_photo'],
    'Clue Specialist must receive the deterministic clue registry it is allowed to propose.',
  );
  assert.ok(wave.turnBrief?.compilerVersion.includes('fallback'));
}

{
  const turnEnvelope = envelope(new Date(Date.now() + 2_000).toISOString());
  const compiledBrief: TurnBrief = {
    ...brief(turnEnvelope),
    utteranceMode: 'non_action',
    orderedActions: [],
  };
  let downstreamCalls = 0;
  const wave = await runShadowCandidateWave({
    state: createInitialGameState(),
    rawInput: 'sdsad',
    envelope: turnEnvelope,
    adapters: {
      semanticCompiler: {
        async compile(request) {
          assert.equal(request.rawInput, 'sdsad');
          return { status: 'compiled', brief: compiledBrief };
        },
      },
      mainWorldModel: async () => {
        downstreamCalls += 1;
        return {};
      },
      specialists: registrations(async () => {
        downstreamCalls += 1;
        return {};
      }),
    },
    npcIds: ['lin_yue', 'police_dispatch'],
    canonicalConstraints: [],
  });

  assert.equal(wave.status, 'non_action');
  assert.equal(wave.turnBrief?.utteranceMode, 'non_action');
  assert.equal(wave.callRecords.length, 0);
  assert.equal(wave.arbitration, undefined);
  assert.equal(downstreamCalls, 0, 'non_action must skip Main and every Specialist');
}
