// Free keyword match: the extension's own deterministic matcher (src/services/keywordMatch.ts)
// and resume reader (src/services/resumeFile.ts). No AI, no network: the resume stays on this page.
import { keywordMatch } from '@/services/keywordMatch';
import { readResumeFile } from '@/services/resumeFile';
import { SITE } from '../../site.config';
import { $, esc, ICON, upsell } from './dom';

const SAMPLE_JOB = `Frontend Engineer (React), Bengaluru, hybrid.
You'll build our merchant dashboard in React and TypeScript with Next.js, and work with our Node.js and GraphQL APIs.
Must have: 1+ years with React, TypeScript, HTML and CSS; testing with Jest or Playwright; Git.
Nice to have: Tailwind, Figma handoff, AWS, Docker, payments or UPI experience, CI/CD.`;

const SAMPLE_RESUME = `Aarav Mehta · B.Tech Computer Science, 2025
Frontend intern, Zeta (Jan–Jun 2025): cut checkout page load time 38% by moving to React Server Components; wrote Jest tests for the payments form.
Projects: open-source UPI payment status tracker (React, Node.js, PostgreSQL), 1.2k GitHub stars.
Skills: JavaScript, React, Node.js, HTML, CSS, Git, PostgreSQL.`;

const form = $<HTMLFormElement>('#kw-form');
const job = $<HTMLTextAreaElement>('#job');
const resume = $<HTMLTextAreaElement>('#resume');
const file = $<HTMLInputElement>('#file');
const fileLabel = $('#file-label');
const out = $('#result');
const err = $('#err');

const fail = (msg: string) => {
  err.textContent = msg;
  err.hidden = !msg;
};

file.addEventListener('change', async () => {
  const f = file.files?.[0];
  if (!f) return;
  fail('');
  fileLabel.textContent = `Reading ${f.name}…`;
  try {
    resume.value = await readResumeFile(f);
    fileLabel.textContent = `${f.name} · read in your browser`;
  } catch (e) {
    fileLabel.textContent = 'Upload a PDF, DOCX or TXT, or paste below';
    fail(e instanceof Error ? e.message : 'Couldn’t read that file.');
  }
});

$('#sample').addEventListener('click', () => {
  job.value = SAMPLE_JOB;
  resume.value = SAMPLE_RESUME;
  form.requestSubmit();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  fail('');
  if (job.value.trim().length < 40) return fail('Paste the job description first.');
  if (resume.value.trim().length < 40) return fail('Upload your resume or paste its text.');
  const m = keywordMatch(job.value, resume.value);
  if (m.present.length + m.missing.length === 0) {
    out.innerHTML = `<div class="result-empty">${ICON.info}This job doesn’t name any of the ${esc('skills and tools')} Hirivo tracks. Read it for the soft skills it wants instead.</div>`;
    return;
  }
  const tag = (t: string, cls: string) => `<span class="tag ${cls}">${esc(t)}</span>`;
  out.innerHTML = `
    <div style="display:flex; align-items:baseline; gap:12px">
      <span class="score">${m.share}%</span>
      <span style="color:var(--ink-2)">of the job’s keywords are on your resume</span>
    </div>
    <div class="meter" role="img" aria-label="${m.share}% matched"><i style="width:0%"></i></div>
    ${m.missing.length ? `<p class="subhead">Missing (${m.missing.length}), most mentioned first</p><div class="tags">${m.missing.map((t) => tag(t, 'miss')).join('')}</div>` : ''}
    ${m.present.length ? `<p class="subhead">On your resume (${m.present.length})</p><div class="tags">${m.present.map((t) => tag(t, 'ok')).join('')}</div>` : ''}
    <div class="note"><b>Add a keyword only if it’s true.</b> If you have used it, name it the way the job does, in a line that shows what you did with it. If you haven’t, leave it out: interviews find out.</div>
    ${upsell('In Hirivo, every job you open gets this check, an honest fit score and a resume tailored to it, without inventing anything.', SITE.installHref, 'Get Hirivo free')}`;
  requestAnimationFrame(() => {
    const bar = out.querySelector<HTMLElement>('.meter i');
    if (bar) bar.style.width = `${m.share}%`;
  });
  if (matchMedia('(max-width: 900px)').matches) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
