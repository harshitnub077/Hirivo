// Models sometimes wrap JSON in prose or code fences even when asked not to.
// Take the first balanced {...} block and parse that.
export function parseJsonLoose<T = any>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    if (start === -1) throw new Error('Model reply contained no JSON object.');
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    throw new Error('Model reply contained an unterminated JSON object.');
  }
}
