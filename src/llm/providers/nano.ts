// Chrome's built-in Gemini Nano (Prompt API). Free, on-device, no key. Only some desktops
// have it (it needs a capable GPU and disk space), so it is always optional.
import { CompletionOptions, CompletionResult, LLMMessage, ProviderError } from '../types';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

declare const LanguageModel:
  | {
      availability(): Promise<Availability>;
      create(options?: Record<string, unknown>): Promise<{
        prompt(input: string, options?: Record<string, unknown>): Promise<string>;
        destroy(): void;
      }>;
    }
  | undefined;

export async function nanoAvailability(): Promise<Availability> {
  try {
    if (typeof LanguageModel === 'undefined') return 'unavailable';
    return await LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

// Starts the one-time model download. Must be called from a user click.
export async function prepareNano(): Promise<Availability> {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  const session = await LanguageModel.create();
  session.destroy();
  return nanoAvailability();
}

export async function callNano(messages: LLMMessage[], options: CompletionOptions = {}): Promise<CompletionResult> {
  if ((await nanoAvailability()) !== 'available' || typeof LanguageModel === 'undefined') {
    throw new ProviderError('On-device model is not available on this computer.');
  }
  const system = messages.find((m) => m.role === 'system');
  const session = await LanguageModel.create({
    temperature: options.temperature ?? 0.2,
    topK: 3,
    initialPrompts: system ? [{ role: 'system', content: system.content }] : [],
  });
  try {
    const turn = messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n');
    const content = await session.prompt(options.jsonMode ? `${turn}\n\nRespond with JSON only.` : turn);
    return { content, model: 'gemini-nano (on-device)', totalTokens: 0 };
  } finally {
    session.destroy();
  }
}
