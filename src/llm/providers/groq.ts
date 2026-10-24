import { CompletionOptions, CompletionResult, LLMMessage, ProviderError } from '../types';
import { forgetModels, pickModel } from '../registry';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export async function callGroq(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions & { model: string }
): Promise<CompletionResult> {
  const isGptOss = options.model.startsWith('openai/gpt-oss');
  const payload: Record<string, unknown> = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.2,
    // GPT-OSS spends tokens on hidden reasoning before answering, so give it room.
    max_completion_tokens: isGptOss ? Math.max(2048, (options.maxTokens ?? 1024) * 2) : options.maxTokens ?? 1024,
  };
  if (isGptOss) {
    payload.reasoning_effort = 'low';
    payload.include_reasoning = false;
  }
  if (options.jsonMode) payload.response_format = { type: 'json_object' };

  let res = await post(apiKey, payload);
  // Free tiers limit tokens per minute; Groq says how long to wait. Wait once if it's short.
  if (res.status === 429) {
    const wait = retryAfterSeconds(res.headers.get('retry-after'), await res.clone().text());
    if (wait !== undefined && wait <= 20) {
      await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
      res = await post(apiKey, payload);
    }
  }
  // Not every model accepts JSON mode; retry once without it (callers parse JSON loosely).
  if (res.status === 400 && options.jsonMode) {
    delete payload.response_format;
    res = await post(apiKey, payload);
  }
  if (res.status === 404) forgetModels('groq');
  if (!res.ok) throw new ProviderError(`Groq ${res.status}: ${await errorMessage(res)}`, res.status);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError('Groq returned an empty reply.');
  return { content, model: options.model, totalTokens: data.usage?.total_tokens ?? 0 };
}

/** Seconds to wait from a Retry-After header or "Please try again in 3.675s" in the body. */
export function retryAfterSeconds(header: string | null, body: string): number | undefined {
  const fromHeader = Number(header);
  if (header && Number.isFinite(fromHeader)) return fromHeader;
  const m = body.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)(m?s)/i);
  if (!m) return undefined;
  const secs = m[3].toLowerCase() === 'ms' ? Number(m[2]) / 1000 : Number(m[2]);
  return (Number(m[1]) || 0) * 60 + secs;
}

function post(apiKey: string, payload: Record<string, unknown>) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error?.message || text;
  } catch {
    return text;
  }
}

export async function testGroqConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    forgetModels('groq');
    const model = await pickModel('groq', apiKey.trim(), 'fast');
    const writeModel = await pickModel('groq', apiKey.trim(), 'write');
    const started = Date.now();
    await callGroq(apiKey.trim(), [{ role: 'user', content: 'Reply with the single word: ok' }], { model, maxTokens: 5 });
    return { success: true, message: `Connected in ${Date.now() - started} ms. Fast model: ${model}. Writing model: ${writeModel}.` };
  } catch (err: any) {
    return { success: false, message: err.message || 'Could not reach Groq. Check the key at console.groq.com/keys.' };
  }
}
