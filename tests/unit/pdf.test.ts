import { describe, expect, it } from 'vitest';
import { readResumeFile } from '../../src/services/resumeImport';

// Builds a small but valid one-page PDF with real text lines.
function makePdf(lines: string[]): Uint8Array {
  const text = lines.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe('readResumeFile', () => {
  it('reads text out of a PDF line by line', async () => {
    const pdf = makePdf([
      'Aarav Mehta',
      'aarav.mehta@gmail.com | +91 98765 43210',
      'Built an open-source UPI payment status tracker with 1.2k GitHub stars',
      'Skills: React, TypeScript, Node.js, PostgreSQL',
    ]);
    const text = await readResumeFile(new File([pdf], 'resume.pdf', { type: 'application/pdf' }));
    expect(text.split('\n')[0]).toBe('Aarav Mehta');
    expect(text).toContain('aarav.mehta@gmail.com');
    expect(text).toContain('UPI payment status tracker');
  });

  it('explains unsupported files', async () => {
    await expect(readResumeFile(new File(['x'], 'resume.doc'))).rejects.toThrow(/PDF, DOCX or TXT/);
  });
});
