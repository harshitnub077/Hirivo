// Just enough Markdown for docs/privacy.md, rendered at build time so the policy page is plain
// HTML with one source of truth: headings, paragraphs, bullet and numbered lists, tables,
// **bold**, *italic*, `code` and [links](url). Everything else is escaped as text.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(text: string): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      const safe = /^(https?:|mailto:|\.\/|#|\.\.\/)/i.test(href) ? href : '#';
      return `<a href="${safe}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      const n = heading[1].length;
      out.push(`<h${n}>${inline(heading[2])}</h${n}>`);
    } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i].replace(re, '');
        // Continuation lines indented under the bullet.
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !re.test(lines[i + 1])) item += ` ${lines[++i].trim()}`;
        items.push(`<li>${inline(item)}</li>`);
        i++;
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flush();
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      out.push(
        `<table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}
