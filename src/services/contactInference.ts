export interface EmailPermutation {
  email: string;
  pattern: string;
  confidence: number;
}

export function generateEmailPermutations(fullName: string, domain: string): EmailPermutation[] {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || !domain) return [];

  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

  const list: EmailPermutation[] = [];

  if (first && last) {
    // 1. first.last@domain (Most common enterprise pattern ~50%)
    list.push({
      email: `${first}.${last}@${cleanDomain}`,
      pattern: '{first}.{last}@{domain}',
      confidence: 85,
    });

    // 2. first@domain (Common in startups ~25%)
    list.push({
      email: `${first}@${cleanDomain}`,
      pattern: '{first}@{domain}',
      confidence: 70,
    });

    // 3. f.last@domain
    list.push({
      email: `${first[0]}${last}@${cleanDomain}`,
      pattern: '{f}{last}@{domain}',
      confidence: 65,
    });

    // 4. first.l@domain
    list.push({
      email: `${first}.${last[0]}@${cleanDomain}`,
      pattern: '{first}.{l}@{domain}',
      confidence: 50,
    });
  } else if (first) {
    list.push({
      email: `${first}@${cleanDomain}`,
      pattern: '{first}@{domain}',
      confidence: 80,
    });
  }

  return list;
}
