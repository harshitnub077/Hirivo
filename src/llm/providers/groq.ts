export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

let verifiedGroqModel: string | null = null;

// Filter and find verified chat models on user's Groq account
export async function getVerifiedGroqModel(apiKey: string): Promise<string> {
  if (verifiedGroqModel) return verifiedGroqModel;

  const cleanKey = apiKey.trim();

  // Standard high-reliability candidate models on Groq
  const standardCandidates = [
    'llama-3.3-70b-versatile',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'llama-3.2-3b-preview',
    'llama-3.2-1b-preview',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
  ];

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${cleanKey}` },
    });

    if (res.ok) {
      const data = await res.json();
      const allModels: any[] = Array.isArray(data.data) ? data.data : [];

      // Filter out non-text/specialized models (whisper, vision, orpheus, guard, audio)
      const validTextModels = allModels
        .filter((m) => {
          const id = (m.id || '').toLowerCase();
          const isBlacklisted =
            id.includes('whisper') ||
            id.includes('orpheus') ||
            id.includes('guard') ||
            id.includes('vision') ||
            id.includes('audio') ||
            id.includes('canopylabs');
          return !isBlacklisted && (id.includes('llama') || id.includes('gemma') || id.includes('mixtral'));
        })
        .map((m) => m.id);

      // Match against preference order
      for (const candidate of standardCandidates) {
        if (validTextModels.includes(candidate)) {
          verifiedGroqModel = candidate;
          return candidate;
        }
      }

      if (validTextModels.length > 0) {
        verifiedGroqModel = validTextModels[0];
        return validTextModels[0];
      }
    }
  } catch (err) {
    console.warn('Could not list Groq models dynamically:', err);
  }

  // Default to rock-solid llama3-8b-8192 or llama-3.3-70b-versatile
  verifiedGroqModel = 'llama-3.3-70b-versatile';
  return verifiedGroqModel;
}

export async function callGroq(
  apiKey: string,
  messages: LLMMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Groq API Key is empty. Please enter your key in Settings.');
  }

  const model = options.model || (await getVerifiedGroqModel(cleanKey));
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

  let res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify(payload),
  });

  // If 400 (e.g. model terms or invalid model) or 404, fallback to llama3-8b-8192 or llama-3.3-70b-versatile
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    const alternateCandidates = ['llama-3.3-70b-versatile', 'llama3-8b-8192', 'llama3-70b-8192', 'gemma2-9b-it'];
    for (const alt of alternateCandidates) {
      if (alt === model) continue;
      payload.model = alt;
      const retryRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (retryRes.ok) {
        verifiedGroqModel = alt;
        res = retryRes;
        break;
      }
    }
  }

  if (!res.ok) {
    const errorBody = await res.text();
    let parsedMessage = errorBody;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson.error?.message) {
        parsedMessage = errJson.error.message;
      }
    } catch {}

    const error = new Error(`Groq API error (${res.status}): ${parsedMessage}`);
    (error as any).status = res.status;
    throw error;
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error('Groq returned empty response');
  }
  return choice;
}

export async function testGroqConnection(apiKey: string): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  verifiedGroqModel = null; // Clear cached model for fresh probe

  // Candidate chat models to test in priority order
  const probeCandidates = [
    'llama-3.3-70b-versatile',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'llama-3.2-3b-preview',
    'llama-3.2-1b-preview',
    'gemma2-9b-it',
  ];

  const cleanKey = apiKey.trim();

  // Try each candidate until one succeeds
  for (const candidate of probeCandidates) {
    try {
      const response = await callGroq(
        cleanKey,
        [{ role: 'user', content: 'Say PONG' }],
        { model: candidate, maxTokens: 20 }
      );
      if (response && response.trim().length > 0) {
        const latencyMs = Date.now() - start;
        verifiedGroqModel = candidate;
        return {
          success: true,
          latencyMs,
          message: `Connected successfully! Active Groq model: ${candidate} (${latencyMs}ms)`,
        };
      }
    } catch (err: any) {
      console.log(`Probe for Groq ${candidate} failed: ${err.message}. Trying next...`);
    }
  }

  return {
    success: false,
    latencyMs: Date.now() - start,
    message: 'Could not connect with standard Groq models. Please verify your Groq API key is valid at console.groq.com/keys.',
  };
}
