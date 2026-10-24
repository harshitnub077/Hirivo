export interface LinterIssue {
  phrase: string;
  category: 'EMPTY_OPENING' | 'DESPERATION' | 'AI_BUZZWORD' | 'VAGUE_FLATTERY' | 'STIFF_FORMALITY';
  explanation: string;
  suggestedReplacement?: string;
  startIndex: number;
  endIndex: number;
}

export interface LinterResult {
  humanScore: number; // 0-100% (100% = clean human tone)
  issues: LinterIssue[];
  cleanText: string;
}

interface Rule {
  pattern: RegExp;
  category: LinterIssue['category'];
  explanation: string;
  suggestedReplacement?: string;
  /** The phrase sits mid-sentence and can't be cut on its own: Fix removes the whole filler sentence. */
  wholeSentence?: boolean;
}

const BANNED_RULES: Rule[] = [
  // Empty Openings
  {
    pattern: /\bi hope this email finds you well\b/gi,
    category: 'EMPTY_OPENING',
    explanation: 'Overused automated opening. Jump straight to the context or reason.',
    suggestedReplacement: '',
  },
  {
    pattern: /\bi hope you(?:'re| are) having a great (?:week|day)\b/gi,
    category: 'EMPTY_OPENING',
    explanation: 'Generic small talk that signals cold mass email.',
    suggestedReplacement: '',
  },
  {
    pattern: /\bmy name is [a-z\s]+ and i am reaching out because\b/gi,
    category: 'EMPTY_OPENING',
    explanation: 'Robotic intro. State your relevance directly.',
    suggestedReplacement: '',
  },

  // Flattery & Desperation
  {
    pattern: /\bi am writing to express my keen interest\b/gi,
    category: 'DESPERATION',
    explanation: 'Classic AI boilerplate. Replace with direct capability.',
    suggestedReplacement: 'I noticed your team is building',
  },
  {
    pattern: /\bi would be thrilled to join\b/gi,
    category: 'DESPERATION',
    explanation: 'Signals generic excitement over specific value creation.',
    suggestedReplacement: 'I’d love to contribute to',
  },
  {
    pattern: /\byour esteemed company\b/gi,
    category: 'VAGUE_FLATTERY',
    explanation: 'Sounds like a template translated from a bot.',
    suggestedReplacement: 'your team',
  },
  {
    pattern: /\bdream job\b/gi,
    category: 'DESPERATION',
    explanation: 'Overused hyperbole that recruiters filter out.',
    suggestedReplacement: 'compelling opportunity',
  },

  // AI Buzzwords
  {
    pattern: /\bdelve(?:s|d|ing)? into\b/gi,
    category: 'AI_BUZZWORD',
    explanation: '"Delve" is a hallmark ChatGPT word.',
    suggestedReplacement: 'examine',
  },
  {
    pattern: /\btestament to\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Cliché AI transition.',
    suggestedReplacement: 'reflection of',
  },
  {
    pattern: /\bgame-?changer\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Marketing jargon with zero concrete meaning.',
    suggestedReplacement: 'major improvement',
  },
  {
    pattern: /\bsynerg(?:y|ies|istic)\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Empty corporate jargon.',
    suggestedReplacement: 'alignment',
  },
  {
    pattern: /\bspearheaded\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Over-embellished resume verb.',
    suggestedReplacement: 'led',
  },
  {
    pattern: /\bharness(?:ing|ed)? the power of\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Dramatic AI cliché.',
    suggestedReplacement: 'using',
  },
  {
    pattern: /\brockstar|ninja|guru\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Dated Silicon Valley cliché.',
    suggestedReplacement: 'skilled engineer',
  },
  {
    pattern: /\bin today's fast-paced world\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Instant flag of AI generation.',
    suggestedReplacement: '',
  },
  {
    pattern: /\btapestry of\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Hallmark poetic hallucination.',
    suggestedReplacement: 'collection of',
  },
  {
    pattern: /\bbeacon of\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Over-the-top corporate flattery.',
    suggestedReplacement: 'leader in',
  },

  // Generic closers and filler seen in real model drafts.
  {
    pattern: /\bI would love to (?:discuss|chat about|explore|learn more about) how (?:my|I)[^.]*\./gi,
    category: 'VAGUE_FLATTERY',
    explanation: 'Generic closer. Ask for one specific, small thing instead.',
    suggestedReplacement: '',
  },
  {
    pattern: /\b(?:accelerate|drive|support) (?:your|the team's|[A-Z]\w+['’]s) (?:engineering |business |growth )?(?:goals|mission|vision)\b/gi,
    category: 'VAGUE_FLATTERY',
    explanation: 'Says nothing specific about them. Name the actual product or problem.',
    wholeSentence: true,
  },
  {
    // "my background fits", "my recent work aligns with", "my experience matches"
    pattern: /\b(?:caught my eye|(?:I think )?my (?:\w+ ){0,2}(?:background|experience|work|skills?|profile|skill ?set) (?:fits|aligns?|matches)(?: well| nicely| closely)?(?: with)?)\b/gi,
    category: 'VAGUE_FLATTERY',
    explanation: 'Filler. Say what specifically about the role matches one of your results.',
    wholeSentence: true,
  },
  {
    pattern: /\bI specialize in\b/gi,
    category: 'AI_BUZZWORD',
    explanation: 'Reads like a resume line. Show one result instead.',
    wholeSentence: true,
  },
  {
    pattern: /\bthank you for your time and consideration\b\.?/gi,
    category: 'EMPTY_OPENING',
    explanation: 'Stock sign-off. A plain "Thanks," is warmer.',
    suggestedReplacement: '',
  },

  // Stiff formality common in Indian cold emails; reads as a template to most hiring managers.
  {
    pattern: /\b(?:respected|dear) (?:sir|ma'?am|madam|sir\s*\/\s*ma'?am)\b,?/gi,
    category: 'STIFF_FORMALITY',
    explanation: 'Use their first name. "Respected Sir/Madam" signals a mass email.',
    suggestedReplacement: 'Hi there,',
  },
  {
    pattern: /\bkindly do the needful\b\.?/gi,
    category: 'STIFF_FORMALITY',
    explanation: 'Vague and formulaic. Ask for one specific thing instead.',
    suggestedReplacement: '',
  },
  {
    pattern: /\b(?:PFA|please find (?:the )?attached(?: my)? (?:resume|cv))\b\.?/gi,
    category: 'STIFF_FORMALITY',
    explanation: 'Skip attachments in a first email; link one strong project instead.',
    suggestedReplacement: '',
  },
  {
    pattern: /\bI am writing (?:this mail|this email|to you) (?:to|in order to)\b/gi,
    category: 'STIFF_FORMALITY',
    explanation: 'They can see you are writing. Start with why them, why now.',
    suggestedReplacement: '',
  },
  {
    pattern: /\b(?:revert back|do revert)\b/gi,
    category: 'STIFF_FORMALITY',
    explanation: '"Revert" means undo to most readers. Say "reply".',
    suggestedReplacement: 'reply',
  },
];

export function lintOutreachText(text: string): LinterResult {
  const issues: LinterIssue[] = [];
  let cleanText = text;

  for (const rule of BANNED_RULES) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);

    while ((match = regex.exec(text)) !== null) {
      issues.push({
        phrase: match[0],
        category: rule.category,
        explanation: rule.explanation,
        suggestedReplacement: rule.suggestedReplacement,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  // Deduplicate and sort issues by startIndex
  issues.sort((a, b) => a.startIndex - b.startIndex);

  // Compute Human Tone Score
  // Every issue subtracts 15% from 100%
  const penalty = issues.length * 15;
  const humanScore = Math.max(0, 100 - penalty);

  return {
    humanScore,
    issues,
    cleanText,
  };
}

export function autoPurgeRoboticPhrases(text: string): string {
  let result = text;
  for (const rule of BANNED_RULES) {
    if (rule.wholeSentence) {
      // Cutting "my work aligns with" out of a sentence leaves broken grammar, so drop the filler
      // sentence instead. A sentence that carries a resume fact stays (and stays flagged).
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
      // Same sentence rule as the grounding check: "1.5" and "Node.js" don't end a sentence.
      result = result.replace(/(?:[^.!?\n]|[.!?](?=[0-9A-Za-z]))+[.!?]*[ \t]*/g, (sentence) => (re.test(sentence) && !/\[FACT-\d+\]/.test(sentence) ? '' : sentence));
      continue;
    }
    result = result.replace(rule.pattern, rule.suggestedReplacement ?? '');
  }
  // Clean up double spaces or orphan punctuation
  return result
    .replace(/[ ]{2,}/g, ' ')
    .replace(/^[,\s]+/gm, '')
    .trim();
}
