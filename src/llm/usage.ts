import { ProviderId } from './types';
import { todayKey } from '../db/settings';

export interface DailyUsage {
  date: string;
  tokens: Partial<Record<ProviderId, number>>;
  calls: Partial<Record<ProviderId, number>>;
  cacheHits: number;
}

const KEY = 'llmUsage';
const hasStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function getUsageToday(): Promise<DailyUsage> {
  const empty: DailyUsage = { date: todayKey(), tokens: {}, calls: {}, cacheHits: 0 };
  if (!hasStorage()) return empty;
  const stored = (await chrome.storage.local.get(KEY))[KEY] as DailyUsage | undefined;
  return stored?.date === empty.date ? stored : empty;
}

export async function recordUsage(provider: ProviderId | 'cache', tokens = 0): Promise<void> {
  if (!hasStorage()) return;
  const usage = await getUsageToday();
  if (provider === 'cache') usage.cacheHits++;
  else {
    usage.tokens[provider] = (usage.tokens[provider] ?? 0) + tokens;
    usage.calls[provider] = (usage.calls[provider] ?? 0) + 1;
  }
  await chrome.storage.local.set({ [KEY]: usage });
}
