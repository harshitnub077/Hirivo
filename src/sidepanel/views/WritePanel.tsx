import React, { useMemo, useState } from 'react';
import { Check, Copy, Mail, Newspaper, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { findHooks, Hook, hookForWriter } from '../../services/hookFinder';
import { getCachedLookup } from '../../services/contacts/siteLookup';
import { hasSiteAccess } from '../../services/siteAccess';
import { JobSnapshot, ResumeFact, UserSettings, VoiceProfile } from '../../db';
import { checkGrounding, generateProofLinkedDraft } from '../../services/proofWriter';
import { autoPurgeRoboticPhrases, lintOutreachText } from '../../services/phraseLinter';
import { gmailComposeUrl, openUrl, recordOutreach, stripCitations } from '../../services/outreach';
import { Callout, Field, Pill, useCopy } from '../ui';
import type { Recipient } from './NowView';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  settings: UserSettings;
  hasKey: boolean;
  recipient: Recipient;
  onRecipientChange: (r: Recipient) => void;
  goTo: (v: ViewId) => void;
}

function HookFinder({ job, onUse }: { job: JobSnapshot; onUse: (hook: string) => void }) {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const find = async () => {
    setBusy(true);
    try {
      const lookup = job.companyDomain ? await getCachedLookup(job.companyDomain) : undefined;
      const siteAllowed = job.companyDomain ? await hasSiteAccess(job.companyDomain) : false;
      setHooks(await findHooks({ company: job.company, domain: job.companyDomain, githubOrg: lookup?.githubOrg, feedUrl: lookup?.feedUrl, siteAllowed }));
    } finally {
      setBusy(false);
    }
  };

  if (!hooks) {
    return (
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={find} disabled={busy || !job.company}>
        {busy ? <RefreshCw size={12} className="spin" /> : <Newspaper size={12} />} {busy ? 'Looking for recent news…' : `Find recent news about ${job.company}`}
      </button>
    );
  }
  if (hooks.length === 0) {
    return <p className="small muted">Nothing dated and linkable from the last 90 days. Leave the hook blank rather than invent one.</p>;
  }
  return (
    <div className="hooks">
      {hooks.slice(0, more ? 8 : 3).map((h) => (
        <div key={h.id} className="hook">
          <div className="grow">
            <a className="small" href={h.url} onClick={(e) => (e.preventDefault(), openUrl(h.url))}>
              {h.title}
            </a>
            <div className="small muted">
              {h.sourceLabel} · {new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          </div>
          <button className="btn sm" onClick={() => onUse(hookForWriter(h))}>
            Use
          </button>
        </div>
      ))}
      {!more && hooks.length > 3 && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)}>
          {hooks.length - 3} more
        </button>
      )}
    </div>
  );
}

export function WritePanel({ job, facts, voiceProfile, settings, hasKey, recipient, onRecipientChange, goTo }: Props) {
  const [hook, setHook] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [claimsReviewed, setClaimsReviewed] = useState(false);
  const [logged, setLogged] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  const lint = useMemo(() => lintOutreachText(body), [body]);
  const grounding = useMemo(() => checkGrounding(body, facts), [body, facts]);
  const wordCount = stripCitations(body).split(/\s+/).filter(Boolean).length;
  const set = (patch: Partial<Recipient>) => onRecipientChange({ ...recipient, ...patch });

  if (!hasKey || facts.length === 0) {
    return (
      <Callout>
        {!hasKey
          ? 'Writing needs a free AI key (Groq takes about a minute to set up).'
          : 'Add your resume first. Hirivo only writes claims your resume can back up.'}
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => goTo('you')}>Open You</button>
        </div>
      </Callout>
    );
  }

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setLogged(null);
    try {
      const draft = await generateProofLinkedDraft({
        jobTitle: job.title,
        companyName: job.company,
        recipientName: recipient.name || undefined,
        recipientRole: recipient.role || undefined,
        facts,
        voiceProfile,
        realSignalHook: hook.trim() || undefined,
      });
      setSubject(draft.emailSubject);
      setBody(draft.emailBody);
      setNote(draft.linkedInNote);
      setClaimsReviewed(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const blocked = grounding.unverifiedClaimsCount > 0 && !claimsReviewed;

  const sendEmail = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      setError('Add the recipient email above first.');
      return;
    }
    try {
      const clean = stripCitations(body);
      await recordOutreach({
        jobId: job.id,
        companyName: job.company,
        jobTitle: job.title,
        recipientName: recipient.name || 'Hiring team',
        recipientEmail: recipient.email,
        contactType: recipient.contactType,
        channel: 'email',
        subject,
        body: clean,
        linkedInNote: stripCitations(note),
        factsCited: grounding.citedFactIds,
      });
      await openUrl(gmailComposeUrl(recipient.email, subject, clean));
      setLogged('Opened in Gmail. Press Send there. Hirivo will remind you to follow up on day 4 and day 9.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const logLinkedIn = async () => {
    setError(null);
    try {
      await recordOutreach({
        jobId: job.id,
        companyName: job.company,
        jobTitle: job.title,
        recipientName: recipient.name || 'LinkedIn contact',
        recipientEmail: recipient.email,
        contactType: recipient.contactType,
        channel: 'linkedin',
        subject: `LinkedIn note: ${job.title}`,
        body: stripCitations(note),
        factsCited: grounding.citedFactIds,
      });
      setLogged('Logged your LinkedIn message. Follow-up reminders are set.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="stack">
      <section className="card stack">
        <div className="grid-2">
          <Field label="To (name)">
            <input value={recipient.name} onChange={(e) => set({ name: e.target.value })} placeholder="Priya Sharma" />
          </Field>
          <Field label="Their role">
            <input value={recipient.role} onChange={(e) => set({ role: e.target.value })} placeholder="Engineering Manager" />
          </Field>
        </div>
        <Field label="Their work email">
          <input type="email" value={recipient.email} onChange={(e) => set({ email: e.target.value.trim() })} placeholder="priya@company.com" />
        </Field>
        <Field label="Opening hook (optional)" hint="Something real and recent: a blog post, release or news. Leave it blank rather than invent one.">
          <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Your post on moving payouts to Kafka" />
        </Field>
        <HookFinder job={job} onUse={setHook} />
        <button className="btn primary block" onClick={generate} disabled={generating}>
          {generating ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
          {generating ? 'Writing from your resume facts…' : body ? 'Write a new version' : 'Write my email'}
        </button>
        {error && <Callout tone="caution">{error}</Callout>}
      </section>

      {body && (
        <section className="card stack fade-in">
          <div className="row between">
            <div className="h2">Email</div>
            <div className="row" style={{ gap: 6 }}>
              <Pill tone={wordCount <= 130 ? 'ok' : 'caution'}>{wordCount} words</Pill>
              <Pill tone={lint.issues.length === 0 ? 'ok' : 'caution'}>{lint.issues.length === 0 ? 'Sounds human' : `${lint.issues.length} cliché${lint.issues.length > 1 ? 's' : ''}`}</Pill>
            </div>
          </div>
          <Field label="Subject">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Body" hint="The [FACT-xx] tags show which resume line backs each claim. They are removed before sending.">
            <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>

          {lint.issues.length > 0 && (
            <Callout tone="caution">
              <div className="row between">
                <b>Sounds templated</b>
                <button className="btn sm" onClick={() => setBody(autoPurgeRoboticPhrases(body))}>
                  <Wand2 size={12} /> Fix all
                </button>
              </div>
              <ul className="checklist" style={{ marginTop: 6 }}>
                {lint.issues.slice(0, 4).map((i, n) => (
                  <li key={n}>
                    “{i.phrase}”: {i.explanation}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          {grounding.unverifiedClaimsCount > 0 ? (
            <Callout tone="risk">
              <b>
                {grounding.unverifiedClaimsCount} claim{grounding.unverifiedClaimsCount > 1 ? 's have' : ' has'} no resume fact behind it.
              </b>
              <ul className="checklist" style={{ marginTop: 6 }}>
                {grounding.groundedSentences
                  .filter((s) => !s.isGrounded)
                  .map((s, n) => (
                    <li key={n}>“{s.sentence}”</li>
                  ))}
              </ul>
              <label className="row small" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={claimsReviewed} onChange={(e) => setClaimsReviewed(e.target.checked)} />
                These are true; send anyway
              </label>
            </Callout>
          ) : (
            grounding.citedFactIds.length > 0 && (
              <div className="row wrap" style={{ gap: 5 }}>
                <span className="small muted">Backed by</span>
                {grounding.citedFactIds.map((id) => (
                  <span key={id} className="fact" title={facts.find((f) => f.id === id)?.claim}>
                    {id}
                  </span>
                ))}
              </div>
            )
          )}

          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={sendEmail} disabled={blocked}>
              <Mail size={14} /> Open in Gmail
            </button>
            <button className="btn icon" title="Copy email" onClick={() => copy('email', `Subject: ${subject}\n\n${stripCitations(body)}`)}>
              {copied === 'email' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </section>
      )}

      {note && (
        <section className="card stack fade-in">
          <div className="row between">
            <div className="h2">LinkedIn note</div>
            <span className={`small num ${stripCitations(note).length > 300 ? '' : 'muted'}`} style={stripCitations(note).length > 300 ? { color: 'var(--risk)' } : undefined}>
              {stripCitations(note).length}/300
            </span>
          </div>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="small muted">Copy it, paste it into LinkedIn yourself, and press send there. Hirivo never touches LinkedIn for you.</p>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={() => copy('note', stripCitations(note))}>
              {copied === 'note' ? <Check size={14} /> : <Copy size={14} />} Copy note
            </button>
            <button className="btn" style={{ flex: 1 }} onClick={logLinkedIn} disabled={blocked}>
              I sent it
            </button>
          </div>
        </section>
      )}

      {logged && (
        <Callout tone="ok">
          {logged}{' '}
          <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => goTo('pipeline')}>
            View pipeline
          </button>
        </Callout>
      )}
      {settings.dailySendCap && <p className="small muted">Daily limit: {settings.dailySendCap} messages. Fewer, better messages get more replies.</p>}
    </div>
  );
}
