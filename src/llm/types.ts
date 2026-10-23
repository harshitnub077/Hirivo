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

export interface CompletionResult {
  content: string;
  model: string;
  totalTokens: number;
}

export type ProviderId = 'groq' | 'gemini' | 'openrouter' | 'nano';

// What a call needs from a model, not which model it is. The registry maps roles to whatever
// the user's key can actually reach today, so retired model IDs never break the app.
export type ModelRole = 'fast' | 'reason' | 'write';

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
