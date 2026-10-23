import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, ExternalLink, Search, Users } from 'lucide-react';
import { db, JobSnapshot, UserSettings } from '../../db';
import { findWarmPaths, generateWarmReferralNote } from '../../services/warmPathMatcher';
import { generateEmailPermutations } from '../../services/contactInference';
import { openUrl } from '../../services/outreach';
import { Callout, Field, Pill, useCopy } from '../ui';
import type { Recipient } from './NowView';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  settings: UserSettings;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  onPick: (r: Recipient) => void;
  goTo: (v: ViewId) => void;
}

export function PeoplePanel({ job, settings, onUpdateJob, onPick, goTo }: Props) {
  const [copied, copy] = useCopy();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [domain, setDomain] = useState(job.companyDomain || '');
  useEffect(() => setDomain(job.companyDomain || ''), [job.companyDomain]);

  const connectionCount = useLiveQuery(() => db.connections.count(), []) ?? 0;
  const warm = useLiveQuery(() => (job.company ? findWarmPaths(job.company) : Promise.resolve([])), [job.company]) ?? [];
  const guesses = name.trim().split(/\s+/).length >= 2 && domain.includes('.') ? generateEmailPermutations(name, domain) : [];

  const searchPeople = (title: string) =>
    openUrl(`https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${job.company}" "${title}"`)}`);

  const saveDomain = async () => {
    if (domain && domain !== job.companyDomain) await onUpdateJob({ ...job, companyDomain: domain });
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="h2">People you already know</div>
          <Pill tone={warm.length ? 'ok' : 'neutral'}>{warm.length} at {job.company || 'this company'}</Pill>
        </div>
        {connectionCount === 0 ? (
          <Callout>
            A referral beats a cold email. Import your LinkedIn connections once (LinkedIn → Settings → Data privacy → Get a copy of your data → Connections).
            It stays on this computer.{' '}
            <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => goTo('you')}>
              Import
            </button>
          </Callout>
        ) : warm.length === 0 ? (
          <p className="small muted">None of your {connectionCount} connections list {job.company} as their company. Try the people search below.</p>
        ) : (
          <div className="list">
            {warm.map(({ connection: c }) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="h2 truncate">{c.fullName}</div>
                  <div className="small muted truncate">{c.position || 'Works there'}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button
                    className="btn sm icon ghost"
                    title="Copy a referral ask"
                    onClick={() => copy(c.id, generateWarmReferralNote(c, job.title, settings.userFullName))}
                  >
                    {copied === c.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => onPick({ name: c.fullName, role: c.position, email: c.email, contactType: 'WARM_CONNECTION' })}
                  >
                    Write
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="h2">Find the hiring manager</div>
        </div>
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {['Engineering Manager', 'Head of Engineering', 'Recruiter', 'Founder'].map((t) => (
            <button key={t} className="btn sm" onClick={() => searchPeople(t)}>
              <Search size={12} /> {t}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <Field label="Their full name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
          </Field>
          <Field label="Their role">
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Engineering Manager" />
          </Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <Field label="Company email domain" hint="Work emails only. Hirivo never looks up personal emails or phone numbers.">
            <input value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} onBlur={saveDomain} placeholder="razorpay.com" />
          </Field>
        </div>

        {guesses.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {guesses.map((g) => (
              <div key={g.email} className="list-item">
                <div className="grow">
                  <div className="mono truncate">{g.email}</div>
                  <div className="small muted">
                    Guessed pattern{job.legitDetails ? (job.legitDetails.hasMx ? ' · domain accepts mail' : ' · domain has no mail server') : ''}
                  </div>
                </div>
                <button
                  className="btn sm"
                  onClick={() => onPick({ name: name.trim(), role: role.trim(), email: g.email, contactType: 'COLD_HIRING_MGR' })}
                >
                  Use
                </button>
              </div>
            ))}
          </div>
        )}
        {guesses.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            These are educated guesses, not confirmed addresses. If the company lists emails on its site, use that pattern.{' '}
            {domain && (
              <a href={`https://${domain}`} onClick={(e) => (e.preventDefault(), openUrl(`https://${domain}`))}>
                Open {domain} <ExternalLink size={11} />
              </a>
            )}
          </p>
        )}
      </section>

      <Callout>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Users size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Best order to try: someone you know, then an alum from your college, then the hiring manager, then a recruiter.</span>
        </div>
      </Callout>
    </div>
  );
}
