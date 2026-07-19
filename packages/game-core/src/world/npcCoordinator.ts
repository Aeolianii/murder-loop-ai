import type { CharacterId, CharacterState, LocationId, WorldState } from './worldTypes';
import type { NpcAdapter, ObjectiveState, SubjectiveState, TaskPlan, NpcLastPlan } from './npcTypes';
import { fallbackReplanAll, fallbackForNpc } from './npcFallback';

export class NpcCoordinator {
  constructor(
    private readonly adapter: NpcAdapter | null,
    private readonly options?: { alwaysRunAll?: boolean },
  ) {}

  async runTick(state: WorldState): Promise<WorldState> {
    const npcIds = this.resolveNpcsToPlan(state);
    if (npcIds.length === 0) {
      state.affectedCharacters = [];
      return state;
    }
    if (!this.adapter) {
      const result = fallbackReplanAll(state, npcIds);
      result.affectedCharacters = [];
      return result;
    }
    const allPlans = buildAllLastPlans(state);
    const results = await Promise.all(
      npcIds.map(async (npcId) => {
        try {
          const subjectiveState = buildSubjectiveState(state, npcId);
          const objectiveState = buildObjectiveState(state, npcId);
          const othersLastPlans = filterOthersLastPlans(allPlans, npcId);
          return await this.adapter!.processNpc({ npcId, objectiveState, subjectiveState, othersLastPlans });
        } catch (error) {
          console.warn(`[NpcCoordinator] NPC ${npcId} LLM failed, using fallback:`, error);
          return { npcId, plan: fallbackForNpc(state, npcId) };
        }
      }),
    );
    const result = applyPlansToState(state, results);
    result.affectedCharacters = [];
    return result;
  }

  private resolveNpcsToPlan(state: WorldState): CharacterId[] {
    if (this.options?.alwaysRunAll) {
      return (Object.keys(state.characters) as CharacterId[]).filter((id) => id !== 'player');
    }
    return ([...new Set(state.affectedCharacters)] as CharacterId[])
      .filter((id) => id !== 'player' && Boolean(state.characters[id]));
  }
}

export function buildObjectiveState(state: WorldState, viewerId?: CharacterId): ObjectiveState {
  return {
    minute: state.minute, threat: state.threat,
    locations: Object.fromEntries(Object.entries(state.locations).map(([id, loc]) => [id, { id, name: loc.name, neighbors: [...loc.neighbors], risk: loc.risk }])),
    objects: Object.fromEntries(Object.entries(state.objects).map(([id, obj]) => [id, projectObjectForViewer(state, obj, viewerId)])),
    characters: Object.fromEntries(Object.entries(state.characters).map(([id, ch]) => [id, { id, name: ch.name, faction: ch.faction, location: ch.location, status: ch.status, visibility: ch.visibility }])),
    recentPublicEvents: state.events.slice(-5).filter((e) => e.visibility === 'public').map((e) => ({ type: e.type, actors: [...e.actors], location: e.location, facts: [...e.facts] })),
  };
}

function projectObjectForViewer(
  state: WorldState,
  obj: WorldState['objects'][keyof WorldState['objects']],
  viewerId?: CharacterId,
): { id: string; name: string; location: string; flags: Record<string, unknown> } {
  if (!viewerId) return { id: obj.id, name: obj.name, location: 'unknown', flags: {} };

  const viewer = state.characters[viewerId];
  const facts = state.knowledge[viewerId]?.facts ?? {};
  const directlyVisible = obj.location === viewerId || obj.location === viewer?.location;
  if (directlyVisible) {
    return { id: obj.id, name: obj.name, location: String(obj.location), flags: { ...obj.flags } };
  }

  if (obj.id === 'package_photo' && facts.package_photo) {
    return {
      id: obj.id,
      name: obj.name,
      location: 'message',
      flags: { exists: true },
    };
  }

  if (obj.id === 'package' && (facts.package_at_503 || facts.package_photo)) {
    return {
      id: obj.id,
      name: obj.name,
      location: String(obj.location),
      flags: facts.package_opened_by_player ? { opened: true } : {},
    };
  }

  return { id: obj.id, name: obj.name, location: 'unknown', flags: {} };
}

export function buildSubjectiveState(state: WorldState, npcId: CharacterId): SubjectiveState {
  const ch = state.characters[npcId];
  return { npcId: ch.id, name: ch.name, faction: ch.faction, location: ch.location, goalStack: [...ch.goalStack], knowledge: { ...state.knowledge[npcId]?.facts }, risk: ch.risk, riskTolerance: ch.riskTolerance, suspicion: ch.suspicion, stress: ch.stress, currentAction: ch.currentAction, status: ch.status };
}

function buildAllLastPlans(state: WorldState): Record<string, NpcLastPlan> {
  const plans: Record<string, NpcLastPlan> = {};
  for (const [id, ch] of Object.entries(state.characters)) { if (ch.lastPlan) plans[id] = ch.lastPlan; }
  return plans;
}

export function buildOthersLastPlans(state: WorldState, currentNpcs: CharacterId[]): Record<string, NpcLastPlan> {
  const all = buildAllLastPlans(state);
  const filtered: Record<string, NpcLastPlan> = {};
  for (const [id, plan] of Object.entries(all)) { if (!currentNpcs.includes(id as CharacterId)) filtered[id] = plan; }
  return filtered;
}

function filterOthersLastPlans(allPlans: Record<string, NpcLastPlan>, selfId: CharacterId): Record<string, NpcLastPlan> {
  const filtered: Record<string, NpcLastPlan> = {};
  for (const [id, plan] of Object.entries(allPlans)) { if (id !== selfId) filtered[id] = plan; }
  return filtered;
}

export function applyPlansToState(state: WorldState, plans: Array<{ npcId: CharacterId; plan: TaskPlan | null }>): WorldState {
  for (const { npcId, plan } of plans) {
    if (!plan) continue;
    const ch = state.characters[npcId];
    if (!ch) continue;
    ch.lastPlan = { tick: plan.tick, intent: plan.intent, attentionWeights: {}, tasks: plan.tasks.map((t) => ({ ...t })), destination: plan.destination as LocationId | undefined };
    if (plan.destination && plan.destination !== ch.location) { ch.destination = plan.destination as LocationId; ch.status = (plan.newStatus as CharacterState['status']) || 'moving'; }
    if (plan.newAction) ch.currentAction = plan.newAction;
  }
  return state;
}
