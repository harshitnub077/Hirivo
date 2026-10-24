import { ModelRole, ProviderId } from './types';

// Preference order per role. Only IDs the provider's /models endpoint actually returns are used;
// anything retired simply drops out. Update these lists when better free models appear.
const PREFERENCES: Record<Exclude<ProviderId, 'nano'>, Record<ModelRole, string[]>> = {
  // Checked against a live key on 2026-10-24: the Llama 3.x models are gone from Groq; GPT-OSS and Qwen remain.
  groq: {
    fast: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant'],
    reason: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
    write: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
  },
  gemini: {
    fast: ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'],
    reason: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'],
    write: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'],
  },
  openrouter: {
    fast: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'],
    reason: ['openai/gpt-oss-120b:free', 'deepseek/deepseek-chat-v3.1:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    write: ['openai/gpt-oss-120b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3.1:free'],
  },
};

// Non-chat models some providers list alongside chat ones.
const NOT_CHAT = /whisper|tts|orpheus|guard|safeguard|embed|vision|audio|image|aqa|imagen|veo|compound|allam/i;

const CACHE_MS = 12 * 60 * 60 * 1000;
const memory = new Map<string, { at: number; ids: string[] }>();

async function fetchModelIds(provider: Exclude<ProviderId, 'nano'>, apiKey: string): Promise<string[]> {
  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Groq /models returned ${res.status}`);
    const data = await res.json();
    return (data.data || []).filter((m: any) => m.active !== false).map((m: any) => m.id as string);
  }
  if (provider === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) throw new Error(`Gemini /models returned ${res.status}`);
    const data = await res.json();
    return (data.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''));
  }
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: any) => m.id as string).filter((id: string) => id.endsWith(':free'));
}

export async function listModels(provider: Exclude<ProviderId, 'nano'>, apiKey: string, fresh = false): Promise<string[]> {
  const key = `${provider}:${apiKey.slice(-6)}`;
  const hit = memory.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  const ids = (await fetchModelIds(provider, apiKey)).filter((id) => !NOT_CHAT.test(id));
  memory.set(key, { at: Date.now(), ids });
  return ids;
}

/** Up to `max` usable models for a role, best first. Free tiers limit each model separately
 * (Groq's per-model daily token cap), so a second model often works when the first is spent. */
export async function pickModels(provider: Exclude<ProviderId, 'nano'>, apiKey: string, role: ModelRole, max = 3): Promise<string[]> {
  let available: string[] = [];
  try {
    available = await listModels(provider, apiKey);
  } catch {
    return PREFERENCES[provider][role].slice(0, max);
  }
  const preferred = PREFERENCES[provider][role].filter((id) => available.includes(id));
  const list = preferred.length ? preferred : available.slice(0, 1);
  if (!list.length) throw new Error(`No chat models are available to this ${provider} key.`);
  return list.slice(0, max);
}

export async function pickModel(provider: Exclude<ProviderId, 'nano'>, apiKey: string, role: ModelRole): Promise<string> {
  let available: string[] = [];
  try {
    available = await listModels(provider, apiKey);
  } catch {
    // Listing failed (offline, CORS hiccup). Fall back to the first preference and let the call decide.
    return PREFERENCES[provider][role][0];
  }
  const preferred = PREFERENCES[provider][role].find((id) => available.includes(id));
  if (preferred) return preferred;
  if (available.length > 0) return available[0];
  throw new Error(`No chat models are available to this ${provider} key.`);
}

export function forgetModels(provider?: ProviderId) {
  for (const key of memory.keys()) if (!provider || key.startsWith(`${provider}:`)) memory.delete(key);
}
