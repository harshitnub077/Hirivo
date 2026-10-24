import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RefreshCw, XCircle } from 'lucide-react';
import { db, JobSnapshot } from '../../db';
import { keywordMatch } from '../../services/keywordMatch';
import { Callout, Field, Pill } from '../ui';
import { EvidenceTable, ProofSprintCard } from './FitPanel';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  analyzed: boolean;
  checking: boolean;
  hasKey: boolean;
  hasResume: boolean;
  onRecheck: () => void;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  goTo: (v: ViewId) => void;
  onWrite: () => void;
}

type Line = { tone: 'ok' | 'caution' | 'risk' | 'neutral'; text: string };

const ICON = {
  ok: <CheckCircle2 size={14} />,
  caution: <AlertTriangle size={14} />,
  risk: <XCircle size={14} />,
  neutral: <CircleHelp size={14} />,
};

function Checklist({ lines }: { lines: Line[] }) {
  return (
    <ul className="checklist">
      {lines.map((l, i) => (
        <li key={i} className={l.tone}>
          {ICON[l.tone]}
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ghostLines(job: JobSnapshot): Line[] {
  return (job.ghostReasons || []).map((text) => ({
    text,
    tone: /right now|days? ago on the company/i.test(text)
      ? 'ok'
      : /not this one|reposted|evergreen|already filled/i.test(text)
        ? 'risk'
        : /not fresh|posted "|double-check/i.test(text)
          ? 'caution'
          : 'neutral',
  }));
}

function legitLines(job: JobSnapshot): Line[] {
  const d = job.legitDetails;
  if (!d) return [];
  const lines: Line[] = [];
  if (d.domainAgeDays !== undefined) {
    const years = Math.floor(d.domainAgeDays / 365);
    lines.push(
      d.domainAgeDays < 90
        ? { tone: 'risk', text: `${job.companyDomain} was registered only ${d.domainAgeDays} days ago. New domains are common in job scams.` }
        : d.domainAgeDays < 365
          ? { tone: 'caution', text: `${job.companyDomain} is under a year old. Fine for a startup; be careful if they ask for money.` }
          : { tone: 'ok', text: `${job.companyDomain} has been registered for ${years} year${years === 1 ? '' : 's'}.` }
    );
  } else {
    lines.push({ tone: 'neutral', text: 'Domain age could not be read (some country domains hide it).' });
  }
  lines.push(
    d.hasMx
      ? { tone: 'ok', text: `Receives email${d.mailProvider ? ` (${d.mailProvider})` : ''}.` }
      : { tone: 'risk', text: 'This domain has no mail server. Real companies almost always do.' }
  );
  return lines;
}

function scamLines(job: JobSnapshot): Line[] {
  if (!job.scamLevel) return [];
  const lines: Line[] = (job.scamFindings || []).map((f) => ({ tone: f.tone, text: f.text }));
  if (lines.length === 0) {
    lines.push({ tone: 'ok', text: 'No scam signs in the listing: no fees, personal emails, chat-app-only contact, task-job wording or recycled posts.' });
  }
  if (!lines.some((l) => /Asks you to pay/.test(l.text))) {
    lines.push({ tone: 'neutral', text: 'Never pay a "registration", "training" or "security" fee for a job. Real employers do not ask.' });
  }
  return lines;
}

function KeywordCard({ job }: { job: JobSnapshot }) {
  const resume = useLiveQuery(() => db.resumes.get('primary'), []);
  const facts = useLiveQuery(() => db.facts.toArray(), []) ?? [];
  const match = useMemo(
    () => (resume?.rawText || facts.length ? keywordMatch(`${job.title}\n${job.description}`, `${resume?.rawText || ''}\n${facts.map((f) => f.claim).join('\n')}`) : null),
    [job.title, job.description, resume?.rawText, facts]
  );
  if (!match || match.present.length + match.missing.length === 0) return null;
  return (
    <section className="card">
      <div className="card-head">
        <div className="h2">Resume keywords</div>
        <Pill tone={match.share >= 70 ? 'ok' : match.share >= 40 ? 'caution' : 'risk'}>{match.share}% match</Pill>
      </div>
      <p className="small muted" style={{ marginBottom: 8 }}>
        Recruiters search for exact words. Add a missing one to your resume only if it's true.
      </p>
      <div className="row wrap" style={{ gap: 5 }}>
        {match.present.map((k) => (
          <Pill key={k} tone="ok">✓ {k}</Pill>
        ))}
        {match.missing.map((k) => (
          <Pill key={k}>{k}</Pill>
        ))}
      </div>
    </section>
  );
}

export function EvidencePanel({ job, analyzed, checking, hasKey, hasResume, onRecheck, onUpdateJob, goTo, onWrite }: Props) {
  const [site, setSite] = useState(job.companyDomain || '');
  const doNotApply = job.fitVerdict === 'DO_NOT_APPLY';

  if (!analyzed) {
    return (
      <div className="card">
        <div className="h2">What Run checks looks at</div>
        <ul className="checklist" style={{ marginTop: 8 }}>
          <li className="neutral">{ICON.neutral}<span>Whether this exact role is still on the company's own hiring board, and for how long.</span></li>
          <li className="neutral">{ICON.neutral}<span>Scam signs: fees, personal emails, chat-app-only contact, task-job wording and recycled listings.</span></li>
          <li className="neutral">{ICON.neutral}<span>Domain age and mail records, to catch fake companies.</span></li>
          <li className="neutral">{ICON.neutral}<span>Each requirement against the resume fact that proves it. The score is counted from that table, not guessed.</span></li>
        </ul>
      </div>
    );
  }

  const saveSite = async () => {
    const clean = site.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    if (!clean.includes('.')) return;
    await onUpdateJob({ ...job, companyDomain: clean, analyzedAt: 0 });
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="h2">Is it still open?</div>
          <button className="btn sm ghost" onClick={onRecheck} disabled={checking}>
            <RefreshCw size={12} className={checking ? 'spin' : ''} /> Recheck
          </button>
        </div>
        <Checklist lines={ghostLines(job)} />
      </section>

      <section className="card">
        <div className="card-head">
          <div className="h2">Is it safe?</div>
        </div>
        {job.legitDetails ? (
          <Checklist lines={[...scamLines(job).filter((l) => l.tone !== 'neutral'), ...legitLines(job), ...scamLines(job).filter((l) => l.tone === 'neutral')]} />
        ) : (
          <div className="stack">
            {job.scamLevel && <Checklist lines={scamLines(job)} />}
            <p className="small muted">This job board doesn't say which website the company owns. Add it to check the domain.</p>
            <Field label="Company website">
              <div className="row">
                <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="razorpay.com" onKeyDown={(e) => e.key === 'Enter' && saveSite()} />
                <button className="btn" onClick={saveSite}>Save</button>
              </div>
            </Field>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="h2">Do you fit?</div>
          {job.fitScore !== undefined && <span className="small muted">Honest score, not flattery</span>}
        </div>
        {job.fitScore === undefined ? (
          <Callout>
            {!hasKey
              ? 'Add a free AI key to score your fit.'
              : !hasResume
                ? 'Add your resume so Hirivo can compare it with this job.'
                : 'The fit check did not finish. Press Recheck.'}{' '}
            {(!hasKey || !hasResume) && (
              <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => goTo('you')}>
                Open You
              </button>
            )}
          </Callout>
        ) : (
          <div className="stack">
            <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
              <span className="score num" style={{ color: doNotApply ? 'var(--risk)' : job.fitScore >= 80 ? 'var(--brand)' : 'var(--caution)' }}>
                {job.fitScore}%
              </span>
              <span className="small muted">
                {job.fitVerdict === 'STRONG_FIT' ? 'Strong fit' : job.fitVerdict === 'MODERATE_FIT' ? 'Partial fit' : 'Not a fit yet'}
              </span>
            </div>
            {job.honestAdvice && <p className="small">{job.honestAdvice}</p>}
            {job.fitEvidence?.length ? (
              <>
                <EvidenceTable job={job} />
                <ProofSprintCard job={job} hasKey={hasKey} onUpdateJob={onUpdateJob} onWrite={onWrite} />
              </>
            ) : (
              (job.matchingStrengths?.length || job.dealbreakers?.length) && (
                <Checklist
                  lines={[
                    ...(job.matchingStrengths || []).map((text): Line => ({ tone: 'ok', text })),
                    ...(job.dealbreakers || []).map((text): Line => ({ tone: 'risk', text })),
                  ]}
                />
              )
            )}
          </div>
        )}
      </section>

      <KeywordCard job={job} />

      {doNotApply ? (
        <Callout tone="risk">
          <b>Honest advice: skip this one for now.</b> You'd be spending one of today's messages on a long shot. Close a gap above first, then come back.
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={onWrite}>Write anyway</button>
          </div>
        </Callout>
      ) : (
        <button className="btn primary block" onClick={onWrite}>
          Write outreach <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
