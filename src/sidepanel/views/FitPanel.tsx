import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Hammer, RefreshCw, XCircle } from 'lucide-react';
import { db, JobSnapshot } from '../../db';
import { getSettings } from '../../db/settings';
import { completeProofSprint, generateProofSprint, pickSprintGap, sprintEligible } from '../../services/proofSprint';
import { Callout, Field, Pill } from '../ui';

/** One row per requirement: what the job asks for, and the resume fact that proves it (or the gap). */
export function EvidenceTable({ job }: { job: JobSnapshot }) {
  const facts = useLiveQuery(() => db.facts.toArray(), []) ?? [];
  const rows = job.fitEvidence || [];
  return (
    <ul className="evidence" aria-label="Requirements and your evidence">
      {rows.map((r) => {
        const fact = r.factId && r.factId !== 'SKILLS' ? facts.find((f) => f.id === r.factId) : undefined;
        return (
          <li key={r.id} className={r.met ? 'ok' : 'risk'}>
            {r.met ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <div>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <span>{r.text}</span>
                <span className="kind">{r.kind === 'must' ? 'Must' : 'Nice'}</span>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
                {r.factId === 'SKILLS' ? (
                  <Pill>Listed in skills</Pill>
                ) : r.factId ? (
                  <span className="fact" title={fact?.claim}>
                    {r.factId}
                  </span>
                ) : (
                  <Pill tone="risk">Gap</Pill>
                )}
                <span className="small muted">{r.reason}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Plans, tracks and completes a Proof Sprint for the biggest gap. */
export function ProofSprintCard({
  job,
  hasKey,
  onUpdateJob,
  onWrite,
}: {
  job: JobSnapshot;
  hasKey: boolean;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  onWrite: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const sprint = job.proofSprint;

  if (sprint?.completedAt) {
    return (
      <Callout tone="ok">
        <b>Sprint done: {sprint.title}.</b> Added {sprint.factId} to your resume facts, and “{sprint.gap}” now counts as met. Your fit is {job.fitScore}%.
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={onWrite}>
            Write outreach citing it
          </button>
        </div>
      </Callout>
    );
  }

  const gap = pickSprintGap(job.fitEvidence || []);
  if (!sprint && (!sprintEligible(job) || !gap)) return null;

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const [facts, settings] = await Promise.all([db.facts.toArray(), getSettings()]);
      const next = await generateProofSprint(job, facts, settings.skills);
      await onUpdateJob({ ...job, proofSprint: next });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const { job: updated } = await completeProofSprint(job, link);
      await onUpdateJob(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!sprint) {
    return (
      <div className="sprint">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Hammer size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="h2">Close the gap in a week</div>
            <p className="small muted">
              Your biggest gap is “{gap!.text}”. A small, real project that proves it turns this from a maybe into a reason to reach out.
            </p>
          </div>
        </div>
        <button className="btn block" onClick={plan} disabled={busy || !hasKey}>
          {busy ? <RefreshCw size={14} className="spin" /> : <Hammer size={14} />} {busy ? 'Planning…' : 'Plan a Proof Sprint'}
        </button>
        {!hasKey && <p className="small muted">Needs a free AI key (You → AI keys).</p>}
        {error && <Callout tone="caution">{error}</Callout>}
      </div>
    );
  }

  return (
    <div className="sprint fade-in">
      <div className="h2">{sprint.title}</div>
      <div className="small muted">A Proof Sprint that closes “{sprint.gap}”</div>
      {sprint.scope && <p className="small">{sprint.scope}</p>}
      {sprint.stack.length > 0 && (
        <div className="row wrap" style={{ gap: 5 }}>
          {sprint.stack.map((s) => (
            <span key={s} className="pill">
              {s}
            </span>
          ))}
        </div>
      )}
      <ol className="sprint-days">
        {sprint.days.map((d) => (
          <li key={d.day}>
            <span className="mono muted">Day {d.day}</span>
            <span className="small">{d.task}</span>
          </li>
        ))}
      </ol>
      {sprint.deliverable && (
        <p className="small">
          <b>Show at the end:</b> {sprint.deliverable}
        </p>
      )}
      <div className="divider" />
      <p className="small muted">When it's built, Hirivo adds this line to your resume facts so your outreach can cite it:</p>
      <p className="small">“{sprint.factClaim}”</p>
      <Field label="Link to what you built (optional)">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="github.com/you/project" />
      </Field>
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} onClick={finish} disabled={busy}>
          <CheckCircle2 size={14} /> I finished this
        </button>
        <button className="btn ghost" onClick={plan} disabled={busy || !hasKey}>
          {busy ? <RefreshCw size={14} className="spin" /> : 'New plan'}
        </button>
      </div>
      {error && <Callout tone="caution">{error}</Callout>}
    </div>
  );
}
