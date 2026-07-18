import OpenAI from 'openai';
import { env } from '../env';
import { createKeyPicker } from './apiKeyPool';
import { configForRole, type AiProvider, type AiRole } from './roleConfig';
import { extractJson } from './unwrapJsonObject';

interface CompletionOptions {
  modelOverride?: string;
  temperature?: number;
}

const pickApiKey = createKeyPicker(env.deepseekApiKeys);

function configFor(provider: AiProvider, modelOverride?: string) {
  if (provider === 'deepseek') return { apiKey: pickApiKey(provider, env.deepseekApiKey), baseURL: env.deepseekBaseUrl, model: modelOverride || env.deepseekModel };
  if (provider === 'deepseek_killer') return { apiKey: pickApiKey(provider, env.deepseekKillerApiKey || env.deepseekApiKey), baseURL: env.deepseekKillerBaseUrl, model: modelOverride || env.deepseekKillerModel };
  if (provider === 'deepseek_narrator') return { apiKey: pickApiKey(provider, env.deepseekNarratorApiKey || env.deepseekApiKey), baseURL: env.deepseekNarratorBaseUrl, model: modelOverride || env.deepseekNarratorModel };
  if (provider === 'deepseek_npc') return { apiKey: pickApiKey(provider, env.deepseekNpcApiKey || env.deepseekApiKey), baseURL: env.deepseekNpcBaseUrl, model: modelOverride || env.deepseekNpcModel };
  if (provider === 'deepseek_recap') return { apiKey: pickApiKey(provider, env.deepseekRecapApiKey || env.deepseekApiKey), baseURL: env.deepseekRecapBaseUrl, model: modelOverride || env.deepseekRecapModel };
  if (provider === 'duckingmind') return { apiKey: env.duckingmindApiKey || env.openaiApiKey, baseURL: env.duckingmindBaseUrl, model: modelOverride || env.duckingmindModel };
  return { apiKey: env.openaiApiKey, baseURL: env.openaiBaseUrl, model: modelOverride || env.openaiModel };
}

function defaultTemperature(provider: AiProvider) {
  if (provider === 'deepseek' || provider === 'deepseek_killer' || provider === 'deepseek_narrator' || provider === 'deepseek_npc' || provider === 'deepseek_recap') return 0.35;
  return 0.68;
}

export async function completeJson<T>(provider: AiProvider, system: string, user: unknown, options: CompletionOptions = {}): Promise<T | null> {
  const config = configFor(provider, options.modelOverride);
  if (!config.apiKey) return null;

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user, null, 2) },
    ],
    response_format: { type: 'json_object' },
    temperature: options.temperature ?? defaultTemperature(provider),
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return null;

  // 先用 extractJson 裁剪出合法 JSON，避免 AI 在 JSON 外包裹 markdown 或说明文字
  const json = extractJson(content);
  if (!json) return null;
  return JSON.parse(json) as T;
}

export async function completeRoleJson<T>(role: AiRole, system: string, user: unknown, options: Omit<CompletionOptions, 'modelOverride'> = {}): Promise<T | null> {
  const config = configForRole(role);
  return completeJson<T>(config.provider, system, user, {
    ...options,
    modelOverride: config.modelOverride,
  });
}
