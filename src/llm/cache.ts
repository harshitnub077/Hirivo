import { db } from '../db';

export async function computePromptHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedResponse(hashKey: string): Promise<string | null> {
  try {
    const item = await db.llmCache.get(hashKey);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      await db.llmCache.delete(hashKey);
      return null;
    }
    return item.response;
  } catch (err) {
    console.warn('Cache lookup failed:', err);
    return null;
  }
}

export async function setCachedResponse(
  hashKey: string,
  response: string,
  model: string,
  ttlSeconds = 7 * 24 * 3600
): Promise<void> {
  try {
    await db.llmCache.put({
      hashKey,
      response,
      model,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  } catch (err) {
    console.warn('Cache write failed:', err);
  }
}
