import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseApiKeys } from './ai/apiKeyPool';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: true });

const deepseekApiKeys = parseApiKeys(process.env.DEEPSEEK_API_KEYS);

export const env = {
  port: Number(process.env.AI_SERVER_PORT || 8788),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  deepseekApiKeys,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekKillerApiKey: process.env.DEEPSEEK_KILLER_API_KEY || '',
  deepseekKillerBaseUrl: process.env.DEEPSEEK_KILLER_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekKillerModel: process.env.DEEPSEEK_KILLER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekNarratorApiKey: process.env.DEEPSEEK_NARRATOR_API_KEY || '',
  deepseekNarratorBaseUrl: process.env.DEEPSEEK_NARRATOR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekNarratorModel: process.env.DEEPSEEK_NARRATOR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekNpcApiKey: process.env.DEEPSEEK_NPC_API_KEY || '',
  deepseekNpcBaseUrl: process.env.DEEPSEEK_NPC_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekNpcModel: process.env.DEEPSEEK_NPC_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekRecapApiKey: process.env.DEEPSEEK_RECAP_API_KEY || '',
  deepseekRecapBaseUrl: process.env.DEEPSEEK_RECAP_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekRecapModel: process.env.DEEPSEEK_RECAP_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekDirectorApiKey: process.env.DEEPSEEK_DIRECTOR_API_KEY || process.env.DEEPSEEK_RECAP_API_KEY || '',
  deepseekDirectorBaseUrl: process.env.DEEPSEEK_DIRECTOR_BASE_URL || process.env.DEEPSEEK_RECAP_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekDirectorModel: process.env.DEEPSEEK_DIRECTOR_MODEL || process.env.DEEPSEEK_RECAP_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  duckingmindApiKey: process.env.DUCKINGMIND_API_KEY || '',
  duckingmindBaseUrl: process.env.DUCKINGMIND_BASE_URL || 'https://api.duckingmind.com/v1',
  duckingmindModel: process.env.DUCKINGMIND_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  aiParseProvider: process.env.AI_PARSE_PROVIDER || 'deepseek',
  aiKillerProvider: process.env.AI_KILLER_PROVIDER || 'openai',
  aiNarratorProvider: process.env.AI_NARRATOR_PROVIDER || 'duckingmind',
  aiDirectorProvider: process.env.AI_DIRECTOR_PROVIDER || 'deepseek_recap',
  aiNpcProvider: process.env.AI_NPC_PROVIDER || 'duckingmind',
  aiRecapProvider: process.env.AI_RECAP_PROVIDER || 'deepseek',
  aiParseModel: process.env.AI_PARSE_MODEL || '',
  aiKillerModel: process.env.AI_KILLER_MODEL || '',
  aiNarratorModel: process.env.AI_NARRATOR_MODEL || '',
  aiDirectorModel: process.env.AI_DIRECTOR_MODEL || '',
  aiNpcModel: process.env.AI_NPC_MODEL || '',
  aiRecapModel: process.env.AI_RECAP_MODEL || '',
};
