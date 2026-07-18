import type { CharacterId, LocationId, NpcLastPlan } from './worldTypes';

export type NpcAction =
  | 'move' | 'wait' | 'observe' | 'communicate'
  | 'use_object' | 'investigate' | 'pick_up' | 'hide' | 'report';

export interface AtomicTask {
  action: NpcAction;
  target: string;
  reason: string;
  priority: number;
  precondition?: string;
}

export interface IntentOutput {
  intent: string;
  attentionWeights: Record<string, number>;
  urgency: number;
  reasoning: string;
  affectedFacts?: string[];
}

export interface TaskPlan {
  tick: number;
  intent: string;
  tasks: AtomicTask[];
  destination?: string;
  newStatus?: string;
  newAction?: string;
}

export type { NpcLastPlan };

export interface ObjectiveState {
  minute: number;
  threat: number;
  locations: Record<string, { id: string; name: string; neighbors: string[]; risk: number }>;
  objects: Record<string, { id: string; name: string; location: string; flags: Record<string, unknown> }>;
  characters: Record<string, { id: string; name: string; faction: string; location: string; status: string; visibility: string }>;
  recentPublicEvents: Array<{ type: string; actors: string[]; location?: string; facts: string[] }>;
}

export interface SubjectiveState {
  npcId: CharacterId;
  name: string;
  faction: string;
  location: string;
  goalStack: string[];
  knowledge: Record<string, { confidence: number; source: string; minuteLearned: number }>;
  risk: number;
  riskTolerance: number;
  suspicion: number;
  stress: number;
  currentAction?: string;
  status: string;
}

export interface NpcAdapter {
  processNpc(input: {
    npcId: CharacterId;
    objectiveState: ObjectiveState;
    subjectiveState: SubjectiveState;
    othersLastPlans: Record<string, NpcLastPlan>;
  }): Promise<{ npcId: CharacterId; plan: TaskPlan | null }>;
}
