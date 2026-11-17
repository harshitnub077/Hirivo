import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { inline, renderMarkdown } from '../../web/build/markdown';

describe('website markdown (privacy page)', () => {
  it('renders headings, lists, tables and inline marks', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code` with [a link](https://x.com).\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://x.com">a link</a>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<td>1</td><td>2</td>');
  });
  it('escapes HTML and refuses script links', () => {
    expect(inline('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(inline('[x](javascript:alert(1))')).toContain('href="#"');
  });
  it('renders the real privacy policy without leftover markdown', () => {
    const html = renderMarkdown(readFileSync('docs/privacy.md', 'utf8'));
    expect(html).toContain('<h1>Hirivo privacy policy</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/\*\*|^\s*\|/m);
  });
});
