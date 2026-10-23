import React, { useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, FileUp, RefreshCw, Sparkles } from 'lucide-react';
import { buildProfile, readResumeFile, ResumeProfile, saveProfile } from '../../services/resumeImport';
import { patchSettings } from '../../db/settings';
import { Callout, Pill } from '../ui';

type Stage = { kind: 'idle' } | { kind: 'reading'; step: string } | { kind: 'review'; file: File; text: string; profile: ResumeProfile } | { kind: 'done'; roles: string[] };

/** Upload → read → review found details → choose roles → save. */
export function ResumeImport({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB. Resumes are usually under 1 MB.');
      setStage({ kind: 'reading', step: 'Reading your file…' });
      const text = await readResumeFile(file);
      setStage({ kind: 'reading', step: 'Finding your details, achievements and best-fit roles…' });
      const profile = await buildProfile(text);
      setPicked(new Set(profile.roles.slice(0, 2).map((r) => r.title)));
      setStage({ kind: 'review', file, text, profile });
    } catch (err: any) {
      setError(err.message);
      setStage({ kind: 'idle' });
    }
  };

  const save = async () => {
    if (stage.kind !== 'review') return;
    const chosen = stage.profile.roles.filter((r) => picked.has(r.title));
    await saveProfile(stage.file, stage.text, stage.profile);
    await patchSettings({
      chosenRoles: chosen.map((r) => r.title),
      targetRoles: Array.from(new Set(chosen.flatMap((r) => r.keywords))),
    });
    setStage({ kind: 'done', roles: chosen.map((r) => r.title) });
    onDone?.();
  };

  if (stage.kind === 'reading') {
    return (
      <div className="card empty">
        <RefreshCw size={26} className="spin" />
        <div className="h2">{stage.step}</div>
        <p>Your file never leaves this computer, except the text sent to your own AI key.</p>
      </div>
    );
  }

  if (stage.kind === 'review') {
    const p = stage.profile;
    const found: [string, string | undefined][] = [
      ['Name', p.fullName],
      ['Email', p.email],
      ['Phone', p.phone],
      ['LinkedIn', p.linkedinUrl],
      ['GitHub', p.githubUrl],
      ['Portfolio', p.portfolioUrl],
      ['College', p.college],
    ];
    return (
      <div className="stack fade-in">
        <section className="card stack">
          <div className="row between">
            <div className="h2">Found in {stage.file.name}</div>
            <Pill tone="ok">{p.facts.length} facts</Pill>
          </div>
          <ul className="checklist">
            {found.map(([label, value]) => (
              <li key={label} className={value ? 'ok' : 'neutral'}>
                {value ? <CheckCircle2 size={14} /> : <CircleHelp size={14} />}
                <span className="truncate">
                  <b>{label}:</b> {value || <span className="muted">not found, add it in Profile</span>}
                </span>
              </li>
            ))}
          </ul>
          {p.skills.length > 0 && (
            <div className="row wrap" style={{ gap: 5 }}>
              {p.skills.slice(0, 18).map((s) => (
                <span key={s} className="pill">{s}</span>
              ))}
            </div>
          )}
          {!p.usedAI && <Callout>Read without AI. Add a free Groq key in You → AI keys for sharper facts and role suggestions, then upload again.</Callout>}
        </section>

        <section className="card stack">
          <div className="h2">Which roles should Hirivo find for you?</div>
          {p.roles.length === 0 && <p className="small muted">No clear match from the resume. Type roles in Radar → Roles you want.</p>}
          {p.roles.map((r) => {
            const on = picked.has(r.title);
            return (
              <button
                key={r.title}
                type="button"
                className={`role-option${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(picked);
                  on ? next.delete(r.title) : next.add(r.title);
                  setPicked(next);
                }}
              >
                <span className="row between">
                  <b>{r.title}</b>
                  <span className="small muted">{r.level}</span>
                </span>
                <span className="small muted">{r.why}</span>
              </button>
            );
          })}
          <button className="btn primary block" onClick={save} disabled={picked.size === 0 && p.roles.length > 0}>
            <Sparkles size={14} /> Save and find jobs
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      {stage.kind === 'done' && <Callout tone="ok">Saved. Looking for {stage.roles.join(', ') || 'your roles'} now.</Callout>}
      <div
        className={`dropzone${dragging ? ' over' : ''}${compact ? ' compact' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <FileUp size={compact ? 18 : 26} />
        <div className="h2">{stage.kind === 'done' ? 'Upload a newer resume' : 'Upload your resume'}</div>
        {!compact && <p className="small muted">PDF, DOCX or TXT. Hirivo fills your profile, finds your achievements and suggests roles.</p>}
        <input ref={input} type="file" accept=".pdf,.docx,.txt,.md,application/pdf" hidden onChange={(e) => (handle(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      {error && <Callout tone="caution">{error}</Callout>}
    </div>
  );
}
