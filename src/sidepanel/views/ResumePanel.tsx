import React, { useEffect, useState } from 'react';
import { Check, Copy, FileDown, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react';
import { JobSnapshot, ResumeFact, ResumeRecord, TailoredResume, UserSettings } from '../../db';
import { checkRewrite, tailorResume } from '../../services/resumeTailor';
import { buildResumeDoc, downloadFile, toDocx, toMarkdown, toPlainText } from '../../services/resumeExport';
import { Callout, Pill, useCopy } from '../ui';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  facts: ResumeFact[];
  resume: ResumeRecord | null;
  settings: UserSettings;
  hasKey: boolean;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  goTo: (v: ViewId) => void;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Per-job resume: reordered and reworded from what the resume already says, never more. */
export function ResumePanel({ job, facts, resume, settings, hasKey, onUpdateJob, goTo }: Props) {
  const [draft, setDraft] = useState<TailoredResume | undefined>(job.tailoredResume);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  useEffect(() => setDraft(job.tailoredResume), [job.id, job.tailoredResume?.createdAt]);

  if (facts.length === 0) {
    return (
      <Callout>
        Add your resume first. Tailoring only reorders and rewords what it already says.
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => goTo('you')}>Open You</button>
        </div>
      </Callout>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await tailorResume({ job, facts, resumeText: resume?.rawText || '', skills: settings.skills || [], useAI: hasKey });
      setDraft(t);
      await onUpdateJob({ ...job, tailoredResume: t });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = (next: TailoredResume) => {
    setDraft(next);
    onUpdateJob({ ...job, tailoredResume: next });
  };

  const doc = draft ? buildResumeDoc(draft, settings, resume?.rawText || '', job.title) : undefined;
  const fileBase = `${slug(settings.userFullName || 'resume')}-${slug(job.company || 'job')}`;
  const reworded = draft?.bullets.filter((b) => b.changed).length ?? 0;
  const kept = draft?.bullets.filter((b) => b.keptOriginalBecause).length ?? 0;

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--brand)' }} />
          <div>
            <div className="h2">Tailor your resume for {job.company || 'this job'}</div>
            <p className="small muted">
              Puts the work this job cares about first and uses its wording where your resume already says the same thing. It never adds a number, tool, title
              or achievement; any suggestion that does is thrown out.
            </p>
          </div>
        </div>
        <button className={`btn block${draft ? '' : ' primary'}`} onClick={run} disabled={busy}>
          {busy ? <RefreshCw size={14} className="spin" /> : <Wand2 size={14} />} {busy ? 'Tailoring…' : draft ? 'Tailor again' : 'Tailor my resume'}
        </button>
        {!hasKey && <p className="small muted">Without an AI key, Hirivo reorders your bullets and skills but doesn't reword them.</p>}
        {error && <Callout tone="caution">{error}</Callout>}
      </section>

      {draft && doc && (
        <>
          <section className="card stack fade-in">
            <div className="row between">
              <div className="h2">Keywords from the job</div>
              <Pill tone={draft.missing.length === 0 ? 'ok' : 'neutral'}>
                {draft.covered.length} of {draft.covered.length + draft.missing.length}
              </Pill>
            </div>
            {draft.missing.length > 0 ? (
              <>
                <p className="small muted">Not on your resume. Add one only if it's true; Hirivo won't add it for you.</p>
                <div className="row wrap" style={{ gap: 5 }}>
                  {draft.missing.map((k) => (
                    <Pill key={k}>{k}</Pill>
                  ))}
                </div>
              </>
            ) : (
              <p className="small muted">Your resume already shows every keyword this job names.</p>
            )}
          </section>

          {(draft.summary !== undefined || draft.summaryDroppedBecause) && (
            <section className="card stack">
              <div className="h2">Summary</div>
              {draft.summary !== undefined ? (
                <textarea rows={3} value={draft.summary} onChange={(e) => save({ ...draft, summary: e.target.value })} />
              ) : (
                <p className="small muted">No summary: {draft.summaryDroppedBecause}</p>
              )}
            </section>
          )}

          <section className="card">
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="h2">Bullets</div>
              <span className="small muted num">
                Most relevant first · {reworded} reworded{kept ? ` · ${kept} kept` : ''}
              </span>
            </div>
            <div className="list">
              {draft.bullets.map((b, i) => {
                const ownEdit = b.text !== b.original ? checkRewrite(b.original, b.text) : [];
                return (
                  <div key={b.factId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <textarea
                      rows={2}
                      value={b.text}
                      aria-label={`Bullet ${i + 1}`}
                      onChange={(e) => save({ ...draft, bullets: draft.bullets.map((x) => (x.factId === b.factId ? { ...x, text: e.target.value, changed: e.target.value !== x.original } : x)) })}
                    />
                    <div className="row wrap" style={{ gap: 6 }}>
                      {b.keptOriginalBecause ? (
                        <Pill tone="caution" title={b.keptOriginalBecause}>Kept your words</Pill>
                      ) : b.changed ? (
                        <Pill tone="ok">Reworded</Pill>
                      ) : (
                        <Pill>Your words</Pill>
                      )}
                      <span className="small muted">{b.why}</span>
                    </div>
                    {b.keptOriginalBecause && <p className="small muted">{b.keptOriginalBecause}</p>}
                    {b.changed && <p className="small muted">Was: {b.original}</p>}
                    {ownEdit.length > 0 && <Callout tone="caution">This edit {ownEdit[0]}. Keep it only if it's true.</Callout>}
                  </div>
                );
              })}
            </div>
          </section>

          {draft.skills.length > 0 && (
            <section className="card stack">
              <div className="h2">Skills, the job's first</div>
              <div className="row wrap" style={{ gap: 5 }}>
                {draft.skills.map((s) => (
                  <span key={s} className="pill">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="card stack">
            <div className="h2">Use it</div>
            <p className="small muted">
              A one-page version with your contact details, these bullets, skills and education. Open the .docx in Word or Google Docs to adjust and save as PDF.
            </p>
            <button
              className="btn primary block"
              onClick={() => downloadFile(`${fileBase}.docx`, toDocx(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
            >
              <FileDown size={14} /> Download .docx
            </button>
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={() => downloadFile(`${fileBase}.md`, toMarkdown(doc), 'text/markdown')}>
                Markdown
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => copy('resume', toPlainText(doc))}>
                {copied === 'resume' ? <Check size={14} /> : <Copy size={14} />} Copy text
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
