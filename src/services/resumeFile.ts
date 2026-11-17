// Reads a resume file into plain text: PDF (pdf.js), DOCX (fflate) or text. No database, no AI,
// so the side panel and the website's free tools use the same reader.
import { unzipSync, strFromU8 } from 'fflate';

export async function readResumeFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return readPdf(await file.arrayBuffer());
  if (name.endsWith('.docx')) return readDocx(new Uint8Array(await file.arrayBuffer()));
  if (/\.(txt|md|text)$/.test(name) || file.type.startsWith('text/')) return file.text();
  throw new Error('Use a PDF, DOCX or TXT file. Old .doc files: open in Word or Google Docs and save as PDF.');
}

async function readPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      } else if (item.str && !item.str.endsWith(' ')) line += ' ';
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n'));
  }
  const text = pages.join('\n').trim();
  if (text.length < 80) throw new Error('This PDF has almost no text (it may be a scanned image). Export it from Word or Google Docs as a text PDF.');
  return text;
}

export function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('This DOCX file has no document body.');
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

