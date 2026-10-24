// Store-readiness checks: every permission in the manifest is used by the code and explained
// in CHROMEWEBSTORE.md, and the listing makes no claims we can't back up.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const listing = readFileSync(join(root, 'CHROMEWEBSTORE.md'), 'utf8');
const privacy = readFileSync(join(root, 'docs/privacy.md'), 'utf8');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.startsWith('demo.') ? [path] : [];
  });
const code = sourceFiles(join(root, 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** The chrome.* call that proves each API permission is needed. */
const API_USE: Record<string, RegExp> = {
  sidePanel: /chrome\.sidePanel\.\w+/,
  storage: /chrome\.storage\.local\.(get|set)/,
  scripting: /chrome\.scripting\.executeScript/,
  activeTab: /chrome\.tabs\.query\(\{\s*active:\s*true/,
  alarms: /chrome\.alarms\.create/,
  notifications: /chrome\.notifications\.create/,
  identity: /chrome\.identity\.launchWebAuthFlow/,
};

/** "https://*.naukri.com/*" -> "*.naukri.com" */
const hostOf = (pattern: string) => pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');

/** A host counts as used when code names it, or its parent domain, as a URL or regex. */
function hostUsed(host: string): boolean {
  const bare = host.replace(/^\*\./, '').replace(/^www\./, '');
  const labels = bare.split('.');
  const candidates = [bare, ...(labels.length > 2 ? [labels.slice(1).join('.')] : [])];
  return candidates.some((h) => code.includes(h) || code.includes(h.replace(/\./g, '\\.')));
}

const permissionsTable = listing.split('## Permission justifications')[1]?.split('\n## ')[0] ?? '';
const ticked = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('manifest permissions', () => {
  const apis = [...manifest.permissions, ...(manifest.optional_permissions ?? [])];
  const hosts = [...manifest.host_permissions, ...(manifest.optional_host_permissions ?? [])].map(hostOf);

  it.each(apis)('%s is used in code and justified', (perm: string) => {
    expect(API_USE[perm], `add a usage rule for ${perm}`).toBeDefined();
    expect(code).toMatch(API_USE[perm]);
    expect(ticked(permissionsTable)).toContain(perm);
  });

  it.each(hosts.filter((h) => h !== '*'))('host %s is used in code and justified', (host: string) => {
    expect(hostUsed(host)).toBe(true);
    expect(ticked(permissionsTable)).toContain(host);
  });

  it('the any-site optional host is only ever requested one origin at a time', () => {
    expect(hosts).toContain('*');
    expect(code).toMatch(/chrome\.permissions\.request\(\{\s*origins:\s*\[origin\]/);
    expect(ticked(permissionsTable)).toContain('https://*/*');
  });

  it('content scripts run only on application-form hosts, never LinkedIn, and are listed', () => {
    const matches: string[] = manifest.content_scripts.flatMap((c: any) => c.matches).map(hostOf);
    expect(matches.some((m) => /linkedin|naukri|indeed/.test(m))).toBe(false);
    for (const m of matches) expect(ticked(permissionsTable), m).toContain(m);
    expect(manifest.web_accessible_resources).toBeUndefined();
  });

  it('the table justifies nothing the manifest no longer asks for', () => {
    const declared = new Set([
      ...apis,
      ...hosts,
      'https://*/*',
      ...manifest.content_scripts.flatMap((c: any) => c.matches).map(hostOf),
    ]);
    const rows = permissionsTable.split('\n').filter((l) => l.startsWith('| `') || l.startsWith('| Host') || l.startsWith('| Optional') || l.startsWith('| Content'));
    for (const name of rows.flatMap((r) => ticked(r.split('|')[1]))) expect(declared, name).toContain(name);
  });
});

describe('store listing', () => {
  it('matches the shipped version', () => {
    expect(manifest.version).toBe(pkg.version);
    expect(listing).toContain(`**Version:** ${manifest.version}`);
  });

  it('keeps the short description within 132 characters', () => {
    const short = listing.split('## Short description')[1].split('\n').find((l) => l.trim() && !l.startsWith('('))!;
    expect(short.trim().length).toBeLessThanOrEqual(132);
  });

  it('makes no unverifiable numeric claims', () => {
    for (const text of [listing, privacy]) {
      expect(text).not.toMatch(/\b\d+(\.\d+)?x\b/i);
      expect(text).not.toMatch(/\d+(\.\d+)?\s?%/);
      expect(text).not.toMatch(/\b(first|only|best|#1)\b[^.\n]{0,30}\b(in the world|ever|on the market)\b/i);
    }
  });

  it('uses the same screenshot captions as the capture script', () => {
    const script = readFileSync(join(root, 'scripts/store-screenshots.js'), 'utf8');
    const shots = [...script.matchAll(/file: '([^']+)',\s*view: '\w+',\s*caption: '([^']+)'/g)];
    expect(shots).toHaveLength(4);
    for (const [, file, caption] of shots) expect(listing).toContain(`| \`store/${file}\` | ${caption} |`);
  });

  it('links the privacy policy', () => {
    expect(listing).toMatch(/docs\/privacy\.md/);
  });
});
