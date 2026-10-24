// Turns a tailored resume into a one-page document: Word (.docx), Markdown or plain text.
// The .docx is assembled directly (a zip of three XML parts) so no extra library ships.
import { strToU8, zipSync } from 'fflate';
import type { UserSettings } from '../db';
import type { TailoredResume } from './resumeTailor';

export interface ResumeDoc {
  name: string;
  contact: string[];
  summary?: string;
  highlightsTitle: string;
  highlights: string[];
  skills: string[];
  education: string[];
}

const HEADINGS = /^(?:experience|work experience|projects|skills|technical skills|education|certifications?|achievements|awards|publications|summary|profile|interests|languages)\b/i;

/** Lines under the resume's EDUCATION heading (up to four), or a line naming a college. */
export function extractEducation(resumeText: string): string[] {
  const lines = resumeText.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^education\b/i.test(l));
  if (start !== -1) {
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
      // A heading is a known section name, or a short all-caps line with no figures ("CGPA 8.6" is content).
      if (HEADINGS.test(l) || (l === l.toUpperCase() && /[A-Z]{4,}/.test(l) && !/\d/.test(l) && l.length <= 30)) break;
      out.push(l.replace(/^[-•*▪◦●]\s*/, ''));
      if (out.length === 4) break;
    }
    if (out.length) return out;
  }
  const college = lines.find((l) => /\b(?:university|college|institute|IIT|NIT|IIIT|BITS)\b/.test(l));
  return college ? [college] : [];
}

export function buildResumeDoc(t: TailoredResume, s: Pick<UserSettings, 'userFullName' | 'userEmail' | 'userPhone' | 'preferredLocation' | 'linkedinUrl' | 'githubUrl' | 'portfolioUrl'>, resumeText: string, jobTitle: string): ResumeDoc {
  const strip = (u?: string) => u?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return {
    name: s.userFullName || 'Your Name',
    contact: [s.preferredLocation, s.userEmail, s.userPhone, strip(s.linkedinUrl), strip(s.githubUrl), strip(s.portfolioUrl)].filter((x): x is string => Boolean(x)),
    summary: t.summary,
    highlightsTitle: `Selected work relevant to ${jobTitle}`,
    highlights: t.bullets.map((b) => b.text),
    skills: t.skills,
    education: extractEducation(resumeText),
  };
}

export function toPlainText(d: ResumeDoc): string {
  const parts = [d.name, d.contact.join(' · '), ''];
  if (d.summary) parts.push(d.summary, '');
  parts.push(d.highlightsTitle.toUpperCase(), ...d.highlights.map((h) => `• ${h}`), '');
  if (d.skills.length) parts.push('SKILLS', d.skills.join(', '), '');
  if (d.education.length) parts.push('EDUCATION', ...d.education, '');
  return parts.join('\n').trim() + '\n';
}

export function toMarkdown(d: ResumeDoc): string {
  const parts = [`# ${d.name}`, d.contact.join(' · '), ''];
  if (d.summary) parts.push(d.summary, '');
  parts.push(`## ${d.highlightsTitle}`, ...d.highlights.map((h) => `- ${h}`), '');
  if (d.skills.length) parts.push('## Skills', d.skills.join(', '), '');
  if (d.education.length) parts.push('## Education', ...d.education.map((e) => `- ${e}`), '');
  return parts.join('\n').trim() + '\n';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function para(text: string, opts: { bold?: boolean; size?: number; color?: string; after?: number; indent?: boolean } = {}) {
  const rPr = [opts.bold ? '<w:b/>' : '', opts.size ? `<w:sz w:val="${opts.size}"/>` : '', opts.color ? `<w:color w:val="${opts.color}"/>` : ''].join('');
  const pPr = `<w:pPr><w:spacing w:after="${opts.after ?? 80}"/>${opts.indent ? '<w:ind w:left="284" w:hanging="284"/>' : ''}</w:pPr>`;
  return `<w:p>${pPr}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

export function toDocx(d: ResumeDoc): Uint8Array {
  const heading = (t: string) => para(t.toUpperCase(), { bold: true, size: 20, color: '0A714B', after: 60 });
  const body = [
    para(d.name, { bold: true, size: 36, after: 40 }),
    para(d.contact.join('  ·  '), { size: 18, color: '555555', after: 200 }),
    d.summary ? para(d.summary, { size: 21, after: 200 }) : '',
    heading(d.highlightsTitle),
    ...d.highlights.map((h) => para(`•\t${h}`, { size: 21, indent: true, after: 60 })),
    d.skills.length ? para('', { after: 60 }) + heading('Skills') + para(d.skills.join(', '), { size: 21, after: 200 }) : '',
    d.education.length ? heading('Education') + d.education.map((e) => para(e, { size: 21, after: 40 })).join('') : '',
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(documentXml),
  });
}

export function downloadFile(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
