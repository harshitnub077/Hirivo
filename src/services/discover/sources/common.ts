// Small helpers shared by the job-site adapters.
import { parsePostedDate } from '../../repostFingerprint';

export { parsePostedDate };

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Rupees per month from text like "₹ 3,000 - 5,000 /month", "3-5 Lacs PA", "Unpaid". Upper end of a range. */
export function monthlyPay(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/,/g, '');
  if (/unpaid|no stipend/.test(t)) return 0;
  const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length || /not disclosed|undisclosed|competitive/.test(t)) return undefined;
  let n = Math.max(...nums);
  if (/lac|lakh|lpa|\bl\b/.test(t)) n *= 100_000;
  else if (/\bk\b|\dk/.test(t)) n *= 1000;
  if (/year|annum|\bpa\b|lpa|p\.a/.test(t)) n /= 12;
  else if (/week/.test(t)) n *= 4.3;
  else if (/day/.test(t)) n *= 22;
  else if (/hour/.test(t)) n *= 176;
  if (/\$|usd/.test(t)) n *= 84; // rough, only for filtering
  return Math.round(n);
}

export const INTERN_WORDS = /\b(intern|interns|internship|trainee|apprentice(ship)?)\b/i;

/** "LinkedIn location" for the search: the city with its country, all of India, or worldwide. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
