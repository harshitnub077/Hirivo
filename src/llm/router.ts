import { db, UserSettings } from '../db';
import { computePromptHash, getCachedResponse, setCachedResponse } from './cache';
import { callGroq, LLMMessage, CompletionOptions } from './providers/groq';
import { callGemini } from './providers/gemini';
import { callOpenRouter } from './providers/openrouter';

export interface RouteRequest {
  messages: LLMMessage[];
  taskType: 'fit_analysis' | 'draft_writing' | 'general';
  jsonMode?: boolean;
  temperature?: number;
  skipCache?: boolean;
}

export interface RouteResult {
  content: string;
  providerUsed: 'groq' | 'gemini' | 'openrouter' | 'cache';
  cached: boolean;
}

async function getEffectiveSettings(): Promise<UserSettings | null> {
  let settings = await db.settings.get('config');
  if (!settings?.groqApiKey && !settings?.geminiApiKey && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get('config');
      if (stored?.config) {
        settings = stored.config;
      }
    } catch {}
  }
  return settings || null;
}

export async function routeLLMRequest(req: RouteRequest): Promise<RouteResult> {
  const settings = await getEffectiveSettings();

  // Build cache key from all messages + jsonMode flag
  const promptKey = JSON.stringify({
    msgs: req.messages,
    json: req.jsonMode,
    task: req.taskType,
  });
  const hash = await computePromptHash(promptKey);

  if (!req.skipCache) {
    const cached = await getCachedResponse(hash);
    if (cached) {
      return {
        content: cached,
        providerUsed: 'cache',
        cached: true,
      };
    }
  }

  const options: CompletionOptions = {
    jsonMode: req.jsonMode,
    temperature: req.temperature ?? (req.taskType === 'fit_analysis' ? 0.1 : 0.4),
    maxTokens: req.taskType === 'fit_analysis' ? 1200 : 800,
    // Do not hardcode model; allow callGroq and callGemini to dynamically auto-detect the user's available model!
  };

  // Provider order: User's preferred first, then fallbacks
  const preferred = settings?.activeProvider || 'groq';
  const providerChain: Array<'groq' | 'gemini' | 'openrouter'> = [
    preferred,
    ...(['groq', 'gemini', 'openrouter'] as const).filter((p) => p !== preferred),
  ];

  let lastError: Error | null = null;

  for (const provider of providerChain) {
    try {
      if (provider === 'groq') {
        const key = settings?.groqApiKey?.trim();
        if (!key) continue;
        const res = await callGroq(key, req.messages, options);
        await setCachedResponse(hash, res, 'groq-auto');
        return { content: res, providerUsed: 'groq', cached: false };
      }

      if (provider === 'gemini') {
        const key = settings?.geminiApiKey?.trim();
        if (!key) continue;
        const res = await callGemini(key, req.messages, options);
        await setCachedResponse(hash, res, 'gemini-auto');
        return { content: res, providerUsed: 'gemini', cached: false };
      }

      if (provider === 'openrouter') {
        const key = settings?.openrouterApiKey?.trim();
        if (!key) continue;
        const res = await callOpenRouter(key, req.messages, { ...options, model: 'meta-llama/llama-3.1-8b-instruct:free' });
        await setCachedResponse(hash, res, 'openrouter-free');
        return { content: res, providerUsed: 'openrouter', cached: false };
      }
    } catch (err: any) {
      console.warn(`Provider ${provider} failed (${err.status || err.message}). Checking next fallback...`);
      lastError = err;
    }
  }

  // If no API keys were configured
  if (!settings?.groqApiKey && !settings?.geminiApiKey && !settings?.openrouterApiKey) {
    throw new Error('No API key configured. Please paste your free Groq or Gemini API key in Settings and click "Save API Keys".');
  }

  throw lastError || new Error('All configured LLM providers failed or were rate-limited.');
}
