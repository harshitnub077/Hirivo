import { LLMMessage, CompletionOptions } from './groq';

let verifiedGeminiModel: string | null = null;

export async function getVerifiedGeminiModel(apiKey: string): Promise<string> {
  if (verifiedGeminiModel) return verifiedGeminiModel;
  return 'gemini-2.0-flash';
}

export async function callGemini(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Gemini API Key is empty. Please enter your key in Settings.');
  }

  const modelCandidates = options.model
    ? [options.model]
    : [verifiedGeminiModel || 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest', 'gemini-1.5-pro'];

  // Convert messages to Gemini format
  const systemMessage = messages.find((m) => m.role === 'system');
  const userAndAssistantMessages = messages.filter((m) => m.role !== 'system');

  const contents = userAndAssistantMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: Math.max(128, options.maxTokens ?? 1024),
    },
  };

  if (options.jsonMode) {
    (payload.generationConfig as any).responseMimeType = 'application/json';
  }

  if (systemMessage) {
    payload.systemInstruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        let parsedMessage = errorBody;
        try {
          const errJson = JSON.parse(errorBody);
          if (errJson.error?.message) {
            parsedMessage = errJson.error.message;
          }
        } catch {}
        lastError = new Error(`Gemini API error with ${model} (${res.status}): ${parsedMessage}`);
        continue;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      // Extract all text parts, ignoring internal thought/reasoning objects
      const text = parts
        .map((p: any) => p.text || '')
        .join('')
        .trim();

      if (text && text.length > 0) {
        verifiedGeminiModel = model;
        return text;
      } else {
        lastError = new Error(`Gemini candidate finished with reason: ${candidate?.finishReason || 'EMPTY'}`);
      }
    } catch (netErr: any) {
      lastError = netErr;
    }
  }

  throw lastError || new Error('Gemini returned an empty response. Please verify your API key is enabled in Google AI Studio.');
}

export async function testGeminiConnection(apiKey: string): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  verifiedGeminiModel = null;

  const probeCandidates = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
  ];

  const cleanKey = apiKey.trim();

  for (const candidate of probeCandidates) {
    try {
      const res = await callGemini(
        cleanKey,
        [{ role: 'user', content: 'Say PONG' }],
        { model: candidate, maxTokens: 128 }
      );
      if (res && res.trim().length > 0) {
        const latencyMs = Date.now() - start;
        verifiedGeminiModel = candidate;
        return {
          success: true,
          latencyMs,
          message: `Connected successfully! Active Gemini model: ${candidate} (${latencyMs}ms)`,
        };
      }
    } catch (err: any) {
      console.log(`Gemini probe for ${candidate} failed: ${err.message}. Trying next...`);
    }
  }

  return {
    success: false,
    latencyMs: Date.now() - start,
    message: 'Could not connect to Gemini. Please check your key at aistudio.google.com/app/apikey.',
  };
}
