// Role targets: the title words Discover, Radar and alerts match job titles against.

// Words that appear in every kind of job title. As a target on their own they match anything:
// "engineer" matched "Mechanical Engineering Expert" for a backend developer.
const GENERIC_TITLE_WORDS = new Set(
  'engineer engineers engineering developer developers dev senior sr junior jr lead staff principal software manager specialist associate intern internship trainee remote hybrid consultant analyst expert head team member i ii iii iv v'.split(' ')
);

/** True for a target made only of generic words ("senior engineer"). */
export function isGenericTarget(target: string): boolean {
  return target
    .toLowerCase()
    .split(/[\s/-]+/)
    .filter(Boolean)
    .every((w) => GENERIC_TITLE_WORDS.has(w));
}

/** Lower-cased, de-duplicated targets without the ones made only of generic words. Keeps the
 * original list if cleaning would leave nothing (no targets means "match everything"). */
export function cleanTargets(targets: string[] | undefined): string[] {
  const all = Array.from(new Set((targets || []).map((t) => t.trim().toLowerCase()).filter(Boolean)));
  const specific = all.filter((t) => !isGenericTarget(t));
  return specific.length ? specific : all;
}

/** Whole-word match, so "ml" doesn't hit "HTML" and "sde" doesn't hit "SDET". */
export function titleHasTarget(title: string, target: string): boolean {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(title.toLowerCase());
}
