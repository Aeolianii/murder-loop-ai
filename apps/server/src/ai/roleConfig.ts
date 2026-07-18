import { env } from '../env';

export const providers = ['openai', 'deepseek', 'deepseek_killer', 'deepseek_narrator', 'deepseek_npc', 'deepseek_recap', 'duckingmind'] as const;
export type AiProvider = (typeof providers)[number];

export type AiRole = 'parse' | 'killer' | 'narrator' | 'director' | 'npc' | 'recap';

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
};

export function configForRole(role: AiRole) {
  return roleConfigs[role];
}

export function roleHealth() {
  return Object.fromEntries(Object.entries(roleConfigs).map(([role, config]) => [role, config.provider]));
}
