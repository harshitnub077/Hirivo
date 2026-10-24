import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mail, Paperclip, Plus, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { db, JobSnapshot, ResumeFact, UserSettings, VoiceProfile } from '../../db';
import type { LadderContact } from '../../services/contactLadder';
import {
  AUDIENCE_LABEL,
  manualRecipient,
  MAX_RECIPIENTS,
  pickRecipients,
  resumeAttachment,
  toRecipient,
  writeDrafts,
  type PersonDraft,
  type Recipient,
} from '../../services/multiOutreach';
import { checkGrounding, removeUnsupported } from '../../services/proofWriter';
import { dailyCapStatus, gmailComposeUrl, openUrl, recordOutreach, stripCitations } from '../../services/outreach';
import { createDraft, draftsFolderUrl, gmailConnected } from '../../services/gmail';
import { Callout, Field, Pill } from '../ui';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  ladder: LadderContact[];
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  settings: UserSettings;
  hasKey: boolean;
  goTo: (v: ViewId) => void;
}

const STATUS_LABEL = { listed: 'listed on their site', 'from-export': 'from your export', 'pattern-confirmed': 'company format, confirmed', guessed: 'guessed, may bounce', typed: 'you added' } as const;

/** Write to up to five people at the company: one email each, for their role, sent by the user. */
export function ReachOutCard({ job, ladder, facts, voiceProfile, settings, hasKey, goTo }: Props) {
  const [extra, setExtra] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<PersonDraft[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attach, setAttach] = useState(true);
  const [opened, setOpened] = useState(0);
  const [form, setForm] = useState({ name: '', role: '', email: '' });

  const sentForJob = useLiveQuery(() => db.outreach.where('jobId').equals(job.id).toArray(), [job.id]) ?? [];
  const alreadyEmailed = new Set(sentForJob.filter((o) => o.channel === 'email').map((o) => o.recipientEmail.toLowerCase()));
  const hasFile = useLiveQuery(async () => !!(await db.resumeFiles.get('primary')), []) ?? false;
  const gmail = useLiveQuery(() => gmailConnected(), [settings.gmail?.email, settings.gmail?.needsReconnect]);

  const candidates = useMemo(() => {
    const fromLadder = ladder.map(toRecipient).filter((r): r is Recipient => r !== null);
    const seen = new Set<string>();
    return [...extra, ...fromLadder].filter((r) => (seen.has(r.email.toLowerCase()) ? false : (seen.add(r.email.toLowerCase()), true)));
  }, [ladder, extra]);

  // Start with the best mix of people (once per job and whenever new people turn up).
  useEffect(() => {
    const best = pickRecipients(ladder).filter((r) => !alreadyEmailed.has(r.email.toLowerCase()));
    setSelected((cur) => (cur.size ? cur : new Set(best.map((r) => r.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder.length]);

  // The sent-list loads after the first render, so filter here too: nobody gets a second cold email.
  const chosen = candidates.filter((r) => selected.has(r.id) && !alreadyEmailed.has(r.email.toLowerCase()));
  const toggle = (r: Recipient) => {
    const next = new Set(selected);
    if (next.has(r.id)) next.delete(r.id);
    else if (next.size < MAX_RECIPIENTS) next.add(r.id);
    setSelected(next);
  };

  const addPerson = () => {
    setError(null);
    try {
      const r = manualRecipient(form.name, form.role, form.email);
      setExtra((x) => [r, ...x]);
      if (selected.size < MAX_RECIPIENTS) setSelected(new Set([...selected, r.id]));
      setForm({ name: '', role: '', email: '' });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const write = async () => {
    setError(null);
    setOpened(0);
    try {
      const result = await writeDrafts({ job, recipients: chosen, facts, voiceProfile, settings }, (done, total) =>
        setProgress(done < total ? `Writing ${done + 1} of ${total}: ${chosen[done]?.name || 'hiring inbox'}…` : null)
      );
      setDrafts(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  };

  const update = (i: number, patch: Partial<PersonDraft>) => setDrafts((d) => d && d.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const grounding = (d: PersonDraft) => checkGrounding(d.body, facts, { company: job.company, hasHook: false, jobText: job.description });

  const record = (d: PersonDraft, ids?: { draftId: string; threadId: string }) =>
    recordOutreach({
      jobId: job.id,
      companyName: job.company,
      jobTitle: job.title,
      recipientName: d.recipient.name || 'Hiring team',
      recipientEmail: d.recipient.email,
      contactType: d.recipient.contactType,
      channel: 'email',
      subject: d.subject,
      body: stripCitations(d.body),
      factsCited: grounding(d).citedFactIds,
      ...(ids ? { gmailDraftId: ids.draftId, gmailThreadId: ids.threadId } : {}),
    });

  const unsent = (drafts || []).filter((d) => !alreadyEmailed.has(d.recipient.email.toLowerCase()));
  const blocked = unsent.some((d) => grounding(d).unverifiedClaimsCount > 0);

  /** Gmail power mode: real drafts, resume attached, all at once. */
  const saveAllDrafts = async () => {
    setError(null);
    try {
      const { used, cap } = await dailyCapStatus();
      if (used + unsent.length > cap) throw new Error(`That's ${unsent.length} emails, and you have ${Math.max(0, cap - used)} left today (limit ${cap}). Untick some people or raise the limit in You → Profile.`);
      const file = attach ? await resumeAttachment() : undefined;
      for (const [i, d] of unsent.entries()) {
        setProgress(`Saving draft ${i + 1} of ${unsent.length} in Gmail…`);
        const saved = await createDraft({ to: d.recipient.email, subject: d.subject, body: stripCitations(d.body), attachment: file });
        await record(d, saved);
      }
      await openUrl(draftsFolderUrl(gmail!.email));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  };

  /** Without Gmail power mode: one prefilled compose window at a time. */
  const openNext = async () => {
    setError(null);
    const d = unsent[0];
    if (!d) return;
    try {
      await record(d);
      setOpened((n) => n + 1);
      await openUrl(gmailComposeUrl(d.recipient.email, d.subject, stripCitations(d.body)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!hasKey || facts.length === 0) return null;

  return (
    <section className="card stack">
      <div className="row between">
        <div className="h2">Write to up to {MAX_RECIPIENTS} people</div>
        <Pill tone={chosen.length ? 'ok' : 'neutral'}>{chosen.length} chosen</Pill>
      </div>

      {!drafts && (
        <>
          <p className="small muted">
            One email each, written for their role from your resume: the hiring manager, a recruiter, a founder, the hiring inbox. You read every one and press Send in Gmail.
          </p>
          {candidates.length === 0 && <p className="small muted">Press Look up above to find people, or add someone you know below.</p>}
          <div className="list">
            {candidates.map((r) => {
              const done = alreadyEmailed.has(r.email.toLowerCase());
              return (
                <label key={r.id} className="list-item reach-row" style={{ opacity: done ? 0.6 : 1 }}>
                  <input type="checkbox" checked={selected.has(r.id)} disabled={done || (!selected.has(r.id) && selected.size >= MAX_RECIPIENTS)} onChange={() => toggle(r)} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="h2 truncate" style={{ display: 'block' }}>
                      {r.name || 'Hiring team'} <span className="muted" style={{ fontWeight: 400 }}>· {AUDIENCE_LABEL[r.audience]}</span>
                    </span>
                    {r.role && <span className="small truncate" style={{ display: 'block' }}>{r.role}</span>}
                    <span className="small" style={{ display: 'block' }}>
                      <span className="mono">{r.email}</span>{' '}
                      <span className="muted">· {done ? 'already emailed for this job' : STATUS_LABEL[r.emailStatus || 'guessed']}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <details>
            <summary className="small">Add someone (a recruiter or HR person you know)</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="grid-2">
                <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Neha Kapoor" /></Field>
                <Field label="Role"><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Talent Partner" /></Field>
              </div>
              <Field label="Work email">
                <div className="row">
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={`neha@${job.companyDomain || 'company.com'}`} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
                  <button className="btn" onClick={addPerson} disabled={!form.email.trim()}>
                    <Plus size={14} /> Add
                  </button>
                </div>
              </Field>
            </div>
          </details>

          {chosen.some((r) => r.emailStatus === 'guessed') && (
            <p className="small muted">Guessed addresses follow the company's usual pattern but can bounce. Gmail will tell you if one does.</p>
          )}
          <button className="btn primary block" onClick={write} disabled={!chosen.length || !!progress}>
            {progress ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} {progress || `Write ${chosen.length} email${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {drafts && (
        <>
          {drafts.map((d, i) => {
            const g = grounding(d);
            const done = alreadyEmailed.has(d.recipient.email.toLowerCase());
            return (
              <div key={d.recipient.id} className="reach-draft stack" style={{ opacity: done ? 0.6 : 1 }}>
                <div className="row between">
                  <span className="small">
                    <b>{d.recipient.name || 'Hiring team'}</b> <span className="muted">· {AUDIENCE_LABEL[d.recipient.audience]} · {d.recipient.email}</span>
                  </span>
                  {done ? (
                    <Pill tone="ok">Sent</Pill>
                  ) : (
                    <button className="btn icon sm ghost" title="Don't send this one" onClick={() => setDrafts(drafts.filter((_, k) => k !== i))}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <input value={d.subject} onChange={(e) => update(i, { subject: e.target.value })} aria-label="Subject" disabled={done} />
                <textarea rows={7} value={d.body} onChange={(e) => update(i, { body: e.target.value })} aria-label="Email" disabled={done} />
                {d.removed.length > 0 && !done && (
                  <details className="small muted">
                    <summary>
                      Hirivo cut {d.removed.length} sentence{d.removed.length === 1 ? '' : 's'} your resume doesn't back
                    </summary>
                    <ul className="checklist" style={{ marginTop: 6 }}>
                      {d.removed.map((r) => (
                        <li key={r}>“{r}”</li>
                      ))}
                    </ul>
                  </details>
                )}
                {g.unverifiedClaimsCount > 0 && !done && (
                  <Callout tone="risk">
                    {g.groundedSentences.filter((s) => !s.isGrounded).map((s) => `“${s.sentence}”`).join(' ')} isn't backed by your resume.{' '}
                    <button className="btn sm" onClick={() => update(i, { body: removeUnsupported(d.body, facts, { company: job.company, hasHook: false, jobText: job.description }) })}>
                      Remove it
                    </button>
                  </Callout>
                )}
              </div>
            );
          })}

          {unsent.length > 0 &&
            (gmail ? (
              <>
                {hasFile && (
                  <label className="row small">
                    <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                    <Paperclip size={13} /> Attach my resume to each draft
                  </label>
                )}
                <button className="btn primary block" onClick={saveAllDrafts} disabled={blocked || !!progress}>
                  {progress ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />} {progress || `Save ${unsent.length} drafts in Gmail`}
                </button>
                <p className="small muted">Each one waits in your Drafts. Open it, read it, press Send. Replies stop the follow-ups automatically.</p>
              </>
            ) : (
              <>
                <button className="btn primary block" onClick={openNext} disabled={blocked}>
                  <Send size={14} /> Open in Gmail ({opened + 1} of {opened + unsent.length})
                </button>
                <p className="small muted">
                  Opens one email at a time; send it, then come back for the next. Gmail's compose link can't attach files, so attach your resume there, or{' '}
                  <button className="linklike" onClick={() => goTo('you')}>connect Gmail</button> to have it attached for you.
                </p>
              </>
            ))}
          {unsent.length === 0 && <Callout tone="ok">All sent. Follow-ups for each person are in Pipeline.</Callout>}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setDrafts(null)} disabled={!!progress}>
            Change people
          </button>
        </>
      )}
      {error && <Callout tone="caution">{error}</Callout>}
    </section>
  );
}
