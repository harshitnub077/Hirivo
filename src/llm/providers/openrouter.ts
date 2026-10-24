import { CompletionOptions, CompletionResult, LLMMessage, ProviderError } from '../types';

export async function callOpenRouter(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions & { model: string }
): Promise<CompletionResult> {
  const payload: Record<string, unknown> = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 1024,
  };
  if (options.jsonMode) payload.response_format = { type: 'json_object' };

  const post = () =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Hirivo',
      },
      body: JSON.stringify(payload),
    });
  let res = await post();
  // Some free models reject JSON mode; retry once without it (callers parse JSON loosely).
  if (res.status === 400 && options.jsonMode) {
    delete payload.response_format;
    res = await post();
  }
  if (!res.ok) throw new ProviderError(`OpenRouter ${res.status}: ${await res.text()}`, res.status);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError('OpenRouter returned an empty reply.');
  return { content, model: options.model, totalTokens: data.usage?.total_tokens ?? 0 };
}
