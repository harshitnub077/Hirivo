import { VoiceProfile } from '../db';

export function calibrateVoiceProfile(samples: string[]): VoiceProfile {
  if (samples.length === 0) {
    return {
      id: 'default',
      samples: [],
      avgSentenceLength: 14,
      contractionRatio: 0.7,
      preferredGreeting: 'Hi [Name],',
      preferredSignoff: 'Best,',
      toneSummary: 'Professional and concise with natural phrasing.',
      updatedAt: Date.now(),
    };
  }

  const combinedText = samples.join('\n\n');

  // 1. Average sentence length
  const sentences = combinedText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  let totalWords = 0;
  for (const s of sentences) {
    const words = s.split(/\s+/).filter(Boolean);
    totalWords += words.length;
  }
  const avgSentenceLength = sentences.length > 0 ? Math.round(totalWords / sentences.length) : 14;

  // 2. Contraction analysis
  const contractionMatches = (combinedText.match(/\b(i'm|don't|can't|it's|we've|you'll|i've|didn't|won't)\b/gi) || []).length;
  const expandedMatches = (combinedText.match(/\b(i am|do not|cannot|it is|we have|you will|i have|did not|will not)\b/gi) || []).length;
  const totalOpportunities = contractionMatches + expandedMatches;
  const contractionRatio = totalOpportunities > 0 ? Number((contractionMatches / totalOpportunities).toFixed(2)) : 0.7;

  // 3. Greeting preference
  let preferredGreeting = 'Hi [Name],';
  if (/^hey\s+[a-z]+/im.test(combinedText)) {
    preferredGreeting = 'Hey [Name],';
  } else if (/^dear\s+[a-z]+/im.test(combinedText)) {
    preferredGreeting = 'Dear [Name],';
  }

  // 4. Sign-off preference
  let preferredSignoff = 'Best,';
  if (/cheers/i.test(combinedText)) {
    preferredSignoff = 'Cheers,';
  } else if (/thanks\b|thank you/i.test(combinedText)) {
    preferredSignoff = 'Thanks,';
  } else if (/warmly|regards/i.test(combinedText)) {
    preferredSignoff = 'Warm regards,';
  }

  // 5. Stylistic tone summary
  const toneSummary = `Average sentence length: ${avgSentenceLength} words. Contraction frequency: ${Math.round(contractionRatio * 100)}%. Greeting: "${preferredGreeting}", Sign-off: "${preferredSignoff}".`;

  return {
    id: 'default',
    samples,
    avgSentenceLength,
    contractionRatio,
    preferredGreeting,
    preferredSignoff,
    toneSummary,
    updatedAt: Date.now(),
  };
}
