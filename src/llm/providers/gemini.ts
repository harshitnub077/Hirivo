import { CompletionOptions, CompletionResult, LLMMessage, ProviderError } from '../types';
import { forgetModels, pickModel } from '../registry';

export async function callGemini(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions & { model: string }
): Promise<CompletionResult> {
  const system = messages.find((m) => m.role === 'system');
  const payload: Record<string, any> = {
    contents: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      // Flash models think before answering and that counts against this limit, so leave room
      // (only the tokens actually used are billed against the free quota).
      maxOutputTokens: Math.max(8192, (options.maxTokens ?? 1024) * 4),
      // 2.5 models think freely unless capped; a capped budget keeps answers fast and complete.
      ...(/2\.5/.test(options.model) ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system.content }] };

  // Key goes in a header, never in the URL, so it can't leak into logs or history.
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  if (res.status === 404) forgetModels('gemini');
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).error?.message || text;
    } catch {}
    throw new ProviderError(`Gemini ${res.status}: ${message}`, res.status);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const content = (candidate?.content?.parts || [])
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text || '')
    .join('')
    .trim();
  if (!content) throw new ProviderError(`Gemini returned no text (${candidate?.finishReason || 'empty'}).`);
  // A reply cut off at the token limit is half an answer (and broken JSON); let the router move on.
  if (candidate?.finishReason === 'MAX_TOKENS') throw new ProviderError('Gemini ran out of room before finishing.');
  return { content, model: options.model, totalTokens: data.usageMetadata?.totalTokenCount ?? 0 };
}

export async function testGeminiConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    forgetModels('gemini');
    const model = await pickModel('gemini', apiKey.trim(), 'write');
    const started = Date.now();
    await callGemini(apiKey.trim(), [{ role: 'user', content: 'Reply with the single word: ok' }], { model, maxTokens: 16 });
    return { success: true, message: `Connected in ${Date.now() - started} ms using ${model}.` };
  } catch (err: any) {
    return { success: false, message: err.message || 'Could not reach Gemini. Check the key at aistudio.google.com.' };
  }
}
