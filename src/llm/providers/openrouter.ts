import { LLMMessage, CompletionOptions } from './groq';

export async function callOpenRouter(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const model = options.model || 'meta-llama/llama-3.1-8b-instruct:free';
  const temperature = options.temperature ?? 0.2;
  const max_tokens = options.maxTokens ?? 1024;

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens,
  };

  if (options.jsonMode) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
      'HTTP-Referer': 'https://hirivo.app',
      'X-Title': 'Hirivo Extension',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    const error = new Error(`OpenRouter API error (${res.status}): ${errorBody}`);
    (error as any).status = res.status;
    throw error;
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error('OpenRouter returned empty response');
  }
  return choice;
}
