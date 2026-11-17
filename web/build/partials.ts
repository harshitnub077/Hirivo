// Build-time HTML helpers for the static site: Lucide icons inlined as SVG (no runtime flash,
// no icon font), and the shared header and footer, so every page stays plain HTML for search
// engines and loads with zero JavaScript before first paint.
import type { Plugin } from 'vite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { SITE } from '../site.config';
import { renderMarkdown } from './markdown';

// Lucide icon paths (ISC licence), the same set the extension uses through lucide-react.
const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'circle-minus': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'clipboard-check': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  'hard-drive': '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'pen-line': '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
};

/** The hirivo mark, drawn with theme tokens so the ink shoulder and jade tick suit both themes. */
export function mark(size: number): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g transform="translate(4.4 0.3) skewX(-16)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 13 A5 5 0 0 1 18.7 13 V19.8" stroke="var(--ink)"/><path d="M4.6 15.4 L8.7 19.8 L8.7 3.6" stroke="var(--brand)"/></g></svg>`;
}

export function icon(name: string, cls = ''): string {
  const body = ICONS[name];
  if (!body) throw new Error(`Unknown icon "${name}" in the site HTML`);
  return `<svg${cls ? ` class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const LINKS: [string, string][] = [
  ['index.html#how', 'How it works'],
  ['index.html#compare', 'Compare'],
  ['scam-check.html', 'Scam check'],
  ['keyword-match.html', 'Keyword match'],
  ['privacy.html', 'Privacy'],
];

function header(active: string): string {
  const links = LINKS.map(([href, label]) => `<a href="./${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="nav" data-nav>
  <div class="wrap">
    <a class="brand" href="./index.html" aria-label="hirivo home">${mark(22)}hirivo</a>
    <nav class="nav-links" aria-label="Main">${links}</nav>
    <div class="nav-end">
      <button class="icon-btn" type="button" data-theme-toggle aria-label="Switch to light theme">${icon('sun')}</button>
      <a class="btn primary sm" href="${SITE.installHref}">${icon('download')}Add to Chrome</a>
      <button class="icon-btn menu-btn" type="button" data-menu aria-expanded="false" aria-label="Menu">${icon('menu')}</button>
    </div>
  </div>
</header>`;
}

function footer(): string {
  return `<footer class="foot">
  <div class="wrap">
    <a class="brand" href="./index.html">${mark(20)}hirivo</a>
    <span>Get noticed. Get connected. Get hired.</span>
    <nav aria-label="Footer">
      <a href="./scam-check.html">Scam check</a>
      <a href="./keyword-match.html">Keyword match</a>
      <a href="./privacy.html">Privacy</a>
      <a href="${SITE.repoUrl}">Source</a>
    </nav>
  </div>
</footer>`;
}

/** Replaces <!--markdown:path.md-->, <!--header:page.html-->, <!--footer-->, {{icon:name}} / {{icon:name:class}} and {{SITE.key}}. */
export function sitePartials(): Plugin {
  return {
    name: 'hirivo-site-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          // <!--markdown:docs/privacy.md--> (path from the repo root) becomes rendered HTML.
          .replace(/<!--markdown:([\w./-]+)-->/g, (_m, file) => renderMarkdown(readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8')))
          .replace(/<!--header:([\w.#-]*)-->/g, (_m, active) => header(active))
          .replace(/<!--footer-->/g, footer())
          .replace(/\{\{mark:(\d+)\}\}/g, (_m, size) => mark(Number(size)))
          .replace(/\{\{icon:([\w-]+)(?::([\w -]+))?\}\}/g, (_m, name, cls) => icon(name, cls))
          .replace(/\{\{SITE\.(\w+)\}\}/g, (_m, key) => String((SITE as Record<string, unknown>)[key] ?? ''));
      },
    },
  };
}
