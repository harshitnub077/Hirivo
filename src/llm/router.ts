import { getSettings } from '../db/settings';
import { computePromptHash, getCachedResponse, setCachedResponse } from './cache';
import { pickModels } from './registry';
import { recordUsage } from './usage';
import { parseJsonLoose } from './json';
import { LLMMessage, ModelRole, ProviderId } from './types';
import { callGroq } from './providers/groq';
import { callGemini } from './providers/gemini';
import { callOpenRouter } from './providers/openrouter';
import { callNano } from './providers/nano';

export type { LLMMessage } from './types';

export interface RouteRequest {
  messages: LLMMessage[];
  taskType: 'fit_analysis' | 'draft_writing' | 'general';
  jsonMode?: boolean;
  temperature?: number;
  skipCache?: boolean;
}

export interface RouteResult {
  content: string;
  providerUsed: ProviderId | 'cache';
  model: string;
  cached: boolean;
}

const ROLE_FOR_TASK: Record<RouteRequest['taskType'], ModelRole> = {
  fit_analysis: 'reason',
  draft_writing: 'write',
  general: 'fast',
};

export async function routeLLMRequest(req: RouteRequest): Promise<RouteResult> {
  const settings = await getSettings();
  const role = ROLE_FOR_TASK[req.taskType];
  const hash = await computePromptHash(JSON.stringify({ m: req.messages, j: req.jsonMode, r: role }));

  // In JSON mode, a reply that doesn't parse is a failure: never return it from the cache or store it,
  // or every retry for a week would hit the same broken answer.
  const usable = (content: string) => {
    if (!req.jsonMode) return true;
    try {
      parseJsonLoose(content);
      return true;
    } catch {
      return false;
    }
  };

  if (!req.skipCache) {
    const cached = await getCachedResponse(hash);
    if (cached && usable(cached)) {
      await recordUsage('cache');
      return { content: cached, providerUsed: 'cache', model: 'cache', cached: true };
    }
  }

  const keys: Record<Exclude<ProviderId, 'nano'>, string> = {
    groq: settings.groqApiKey.trim(),
    gemini: settings.geminiApiKey.trim(),
    openrouter: settings.openrouterApiKey.trim(),
  };
  const preferred = settings.activeProvider || 'groq';
  const chain: ProviderId[] = [preferred, ...(['groq', 'gemini', 'openrouter'] as const).filter((p) => p !== preferred)];
  // The on-device model is only good enough for short classification work, never for writing.
  if (role === 'fast') chain.push('nano');

  const base = {
    jsonMode: req.jsonMode,
    temperature: req.temperature ?? (role === 'write' ? 0.4 : 0.1),
    maxTokens: role === 'reason' ? 1400 : 900,
  };

  const failures: string[] = [];
  for (const provider of chain) {
    try {
      let result;
      if (provider === 'nano') {
        result = await callNano(req.messages, base);
      } else {
        const key = keys[provider];
        if (!key) continue;
        const call = provider === 'groq' ? callGroq : provider === 'gemini' ? callGemini : callOpenRouter;
        // Rate limits, daily caps and "high demand" are per model: try the next model of the
        // same provider before moving to another provider.
        let lastErr: any;
        for (const model of await pickModels(provider, key, role)) {
          try {
            result = await call(key, req.messages, { ...base, model });
            if (req.jsonMode && !usable(result.content)) throw new Error(`${model} returned malformed JSON`);
            break;
          } catch (err: any) {
            lastErr = err;
            const status = err?.status ?? 0;
            if (!(status === 429 || status === 404 || status >= 500 || /malformed JSON|ran out of room|empty reply|no text/i.test(err?.message || ''))) break;
          }
        }
        if (!result) throw lastErr;
      }
      await recordUsage(provider, result.totalTokens);
      if (!usable(result.content)) throw new Error(`${result.model} returned malformed JSON`);
      await setCachedResponse(hash, result.content, result.model);
      return { content: result.content, providerUsed: provider, model: result.model, cached: false };
    } catch (err: any) {
      failures.push(`${provider}: ${err.message}`);
    }
  }

  if (!keys.groq && !keys.gemini && !keys.openrouter) {
    throw new Error('Add a free Groq key in You → AI keys to use this. It takes about a minute.');
  }
  throw new Error(`Every AI provider failed. ${failures.join(' | ')}`);
}
