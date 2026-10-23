import { routeLLMRequest } from '../llm/router';
import { ResumeRecord, ResumeFact } from '../db';

export interface FitAnalysisResult {
  matchScore: number; // 0-100
  verdict: 'STRONG_FIT' | 'MODERATE_FIT' | 'DO_NOT_APPLY';
  honestAdvice: string;
  dealbreakers: string[];
  matchingStrengths: string[];
  skillGaps: {
    skill: string;
    studyRecommendation: string;
    timeToAcquire: string;
  }[];
}

export async function analyzeJobFit(
  jobTitle: string,
  companyName: string,
  jobDescription: string,
  resume: ResumeRecord | null,
  facts: ResumeFact[]
): Promise<FitAnalysisResult> {
  const factSummary = facts.length > 0
    ? facts.map((f) => `[${f.id}] (${f.category}): ${f.claim}`).join('\n')
    : resume?.rawText.slice(0, 3000) || 'General software engineer profile with web development, API engineering, and software delivery experience.';

  const systemPrompt = `You are Hirivo's Honest Fit Advisor.
Your objective is to provide a brutally honest, objective assessment of a candidate's fit for a job.
You are the opposite of "spray-and-pray" bots.
DO NOT flatter the candidate. If the candidate is underqualified, CLEARLY mark verdict as "DO_NOT_APPLY" (score < 55) and explain why applying is a waste of time.
Identify hard blockers (e.g. requires 5+ years Go distributed systems while candidate only has 1 year React; or explicit clearance/citizenship requirements).

You must respond ONLY with a JSON object following this EXACT schema:
{
  "matchScore": <number between 0 and 100>,
  "verdict": "STRONG_FIT" (if score >= 80) | "MODERATE_FIT" (if 55-79) | "DO_NOT_APPLY" (if < 55),
  "honestAdvice": "<2-4 sentences of direct, candid guidance. If do not apply, explain what to build/learn instead>",
  "dealbreakers": ["<hard missing requirement 1>", "<hard missing requirement 2>"],
  "matchingStrengths": ["<top matching qualification 1>", "<top matching qualification 2>"],
  "skillGaps": [
    {
      "skill": "<missing skill/tech>",
      "studyRecommendation": "<specific project or concept to build/learn>",
      "timeToAcquire": "<estimated time, e.g. '2 weeks' or '6 months'>"
    }
  ]
}`;

  const userPrompt = `JOB TITLE: ${jobTitle}
COMPANY: ${companyName}

JOB DESCRIPTION:
${jobDescription.slice(0, 4000)}

CANDIDATE QUALIFICATIONS & FACTS:
${factSummary}

Analyze the match honestly. Provide the required JSON response.`;

  const response = await routeLLMRequest({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    taskType: 'fit_analysis',
    jsonMode: true,
    temperature: 0.1,
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      matchScore: Math.min(100, Math.max(0, Number(parsed.matchScore) || 50)),
      verdict: parsed.verdict || (parsed.matchScore >= 80 ? 'STRONG_FIT' : parsed.matchScore >= 55 ? 'MODERATE_FIT' : 'DO_NOT_APPLY'),
      honestAdvice: parsed.honestAdvice || 'Assessment completed.',
      dealbreakers: Array.isArray(parsed.dealbreakers) ? parsed.dealbreakers : [],
      matchingStrengths: Array.isArray(parsed.matchingStrengths) ? parsed.matchingStrengths : [],
      skillGaps: Array.isArray(parsed.skillGaps) ? parsed.skillGaps : [],
    };
  } catch (err) {
    console.error('Failed to parse fit analysis JSON:', response.content);
    throw new Error('LLM did not return valid fit analysis JSON. Please retry.');
  }
}
