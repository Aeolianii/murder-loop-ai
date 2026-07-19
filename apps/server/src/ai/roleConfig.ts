import { env } from '../env';

export const providers = ['openai', 'deepseek', 'deepseek_killer', 'deepseek_narrator', 'deepseek_npc', 'deepseek_recap', 'duckingmind'] as const;
export type AiProvider = (typeof providers)[number];

export type AiRole =
  | 'parse'
  | 'killer'
  | 'narrator'
  | 'director'
  | 'recommendation'
  | 'npc'
  | 'recap'
  | 'npc_intent'
  | 'npc_task'
  | 'semantic_compiler'
  | 'world_model'
  | 'player_specialist'
  | 'killer_specialist'
  | 'npc_specialist'
  | 'environment_specialist'
  | 'clue_specialist'
  | 'recommendation_specialist';

export interface RoleConfig {
  role: AiRole;
  provider: AiProvider;
  modelOverride?: string;
}

function toProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  return providers.includes(value as AiProvider) ? (value as AiProvider) : fallback;
}

const roleConfigs: Record<AiRole, RoleConfig> = {
  parse: {
    role: 'parse',
    provider: toProvider(env.aiParseProvider, 'deepseek'),
    modelOverride: env.aiParseModel || undefined,
  },
  killer: {
    role: 'killer',
    provider: toProvider(env.aiKillerProvider, 'openai'),
    modelOverride: env.aiKillerModel || undefined,
  },
  narrator: {
    role: 'narrator',
    provider: toProvider(env.aiNarratorProvider, 'duckingmind'),
    modelOverride: env.aiNarratorModel || undefined,
  },
  director: {
    role: 'director',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
  recommendation: {
    role: 'recommendation',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
  npc: {
    role: 'npc',
    provider: toProvider(env.aiNpcProvider, 'deepseek_npc'),
    modelOverride: env.aiNpcModel || undefined,
  },
  recap: {
    role: 'recap',
    provider: toProvider(env.aiRecapProvider, 'deepseek_recap'),
    modelOverride: env.aiRecapModel || undefined,
  },
  npc_intent: {
    role: 'npc_intent',
    provider: toProvider(env.aiNpcProvider, 'deepseek_npc'),
    modelOverride: env.aiNpcModel || undefined,
  },
  npc_task: {
    role: 'npc_task',
    provider: toProvider(env.aiNpcProvider, 'deepseek_npc'),
    modelOverride: env.aiNpcModel || undefined,
  },
  semantic_compiler: {
    role: 'semantic_compiler',
    provider: toProvider(env.aiParseProvider, 'deepseek'),
    modelOverride: env.aiParseModel || undefined,
  },
  world_model: {
    role: 'world_model',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
  player_specialist: {
    role: 'player_specialist',
    provider: toProvider(env.aiParseProvider, 'deepseek'),
    modelOverride: env.aiParseModel || undefined,
  },
  killer_specialist: {
    role: 'killer_specialist',
    provider: toProvider(env.aiKillerProvider, 'openai'),
    modelOverride: env.aiKillerModel || undefined,
  },
  npc_specialist: {
    role: 'npc_specialist',
    provider: toProvider(env.aiNpcProvider, 'deepseek_npc'),
    modelOverride: env.aiNpcModel || undefined,
  },
  environment_specialist: {
    role: 'environment_specialist',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
  clue_specialist: {
    role: 'clue_specialist',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
  recommendation_specialist: {
    role: 'recommendation_specialist',
    provider: toProvider(env.aiDirectorProvider, 'deepseek_recap'),
    modelOverride: env.aiDirectorModel || undefined,
  },
};

export function configForRole(role: AiRole) {
  return roleConfigs[role];
}

export function roleHealth() {
  return Object.fromEntries(Object.entries(roleConfigs).map(([role, config]) => [role, config.provider]));
}
