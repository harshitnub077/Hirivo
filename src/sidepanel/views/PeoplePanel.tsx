import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, ExternalLink, GraduationCap, RefreshCw, ScanSearch, Search, UserPlus, Users } from 'lucide-react';
import { db, JobSnapshot, ResumeFact, UserSettings, VoiceProfile } from '../../db';
import { ReachOutCard } from './ReachOutCard';
import { alumniSearchUrl, buildLadder, LadderContact, TIER_LABELS } from '../../services/contactLadder';
import { addRenderedPage, getCachedLookup, saveLookup, SiteLookup } from '../../services/contacts/siteLookup';
import { linkedInPeopleSearchUrl, parseLinkedInPeople } from '../../services/contacts/linkedinPeople';
import { addLinkedInTasks, pickLinkedInPeople, researchPeople } from '../../services/people';
import { patternProof, type LearnedPattern } from '../../services/people/emailPattern';
import { ycFounders, type Founder } from '../../services/people/yc';
import { ensureSiteAccess } from '../../services/siteAccess';
import { generateEmailPermutations } from '../../services/contactInference';
import { generateWarmReferralNote } from '../../services/warmPathMatcher';
import { openUrl } from '../../services/outreach';
import { Callout, Field, Pill, useCopy } from '../ui';
import { grabActivePageHtml } from '../page';
import type { Recipient } from './NowView';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  settings: UserSettings;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  hasKey: boolean;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  onPick: (r: Recipient) => void;
  goTo: (v: ViewId) => void;
}

const EMAIL_LABEL = { listed: 'listed on their site', 'from-export': 'from your export', 'pattern-confirmed': 'company format, confirmed', guessed: 'guessed' } as const;

export function PeoplePanel({ job, settings, facts, voiceProfile, hasKey, onUpdateJob, onPick, goTo }: Props) {
  const [copied, copy] = useCopy();
  const [domain, setDomain] = useState(job.companyDomain || '');
  const [lookup, setLookup] = useState<SiteLookup | undefined>();
  const [busy, setBusy] = useState<'lookup' | 'page' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'caution'; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState('');
  const [founders, setFounders] = useState<Founder[]>([]);
  const [pattern, setPattern] = useState<LearnedPattern | undefined>();

  useEffect(() => {
    setDomain(job.companyDomain || '');
    setLookup(undefined);
    setFounders([]);
    setPattern(undefined);
    setMessage(null);
    if (job.companyDomain) getCachedLookup(job.companyDomain).then(setLookup);
    ycFounders(job.company, job.companyDomain).then(setFounders).catch(() => undefined);
  }, [job.id, job.companyDomain]);

  const connections = useLiveQuery(() => db.connections.toArray(), []) ?? [];
  const ladder = useMemo(
    () =>
      buildLadder({
        jobTitle: job.title,
        company: job.company,
        domain: job.companyDomain,
        college: settings.userCollege,
        connections,
        lookup,
        domainHasMx: job.legitDetails?.hasMx,
        founders,
        pattern,
      }),
    [job.title, job.company, job.companyDomain, job.legitDetails?.hasMx, settings.userCollege, connections, lookup, founders, pattern]
  );

  const cleanDomain = (d: string) => d.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

  const runLookup = async () => {
    const d = cleanDomain(domain);
    if (!d.includes('.')) return setMessage({ tone: 'caution', text: 'Add the company website first, like razorpay.com.' });
    // Ask for access first: Chrome only shows the prompt during the click.
    const allowed = await ensureSiteAccess(d);
    if (!allowed) return setMessage({ tone: 'caution', text: `Hirivo needs your OK to read ${d}. Press the button again and choose Allow.` });
    setBusy('lookup');
    setMessage(null);
    try {
      if (d !== job.companyDomain) await onUpdateJob({ ...job, companyDomain: d });
      const research = await researchPeople({ company: job.company, jobTitle: job.title, domain: d, college: settings.userCollege, connections, hasMx: job.legitDetails?.hasMx, canRead: true, force: true });
      const result = research.lookup || { domain: d, people: [], inboxes: [], githubMembers: [], pagesChecked: [], checkedAt: Date.now() };
      setLookup(result);
      setFounders(research.founders);
      setPattern(research.pattern);
      setMessage({
        tone: result.people.length ? 'ok' : 'caution',
        text: result.people.length
          ? `Found ${result.people.length} people on ${d}${result.githubOrg ? ` and the GitHub org ${result.githubOrg}` : ''}.`
          : `No names in ${d}'s page code (checked ${result.pagesChecked.join(', ') || 'nothing'}). If their team page loads with JavaScript, open it and press “Read people on this page”.`,
      });
    } catch (err: any) {
      setMessage({ tone: 'caution', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const readThisPage = async () => {
    setBusy('page');
    setMessage(null);
    try {
      const page = await grabActivePageHtml();
      const d = cleanDomain(domain) || page.host;
      const base: SiteLookup = lookup || { domain: d, people: [], inboxes: [], githubMembers: [], pagesChecked: [], checkedAt: Date.now() };
      let next: SiteLookup;
      if (/(^|\.)linkedin\.com$/.test(page.host)) {
        const found = parseLinkedInPeople(new DOMParser().parseFromString(page.html, 'text/html'), job.company, page.url);
        const known = new Set(base.people.map((p) => p.name.toLowerCase()));
        next = { ...base, people: [...base.people, ...found.filter((p) => !known.has(p.name.toLowerCase()))] };
      } else next = addRenderedPage(base, page.html, job.company, page.url);
      await saveLookup(next);
      setLookup(next);
      setMessage({ tone: 'ok', text: `Read ${page.host}: ${next.people.length - base.people.length} new people.` });
    } catch (err: any) {
      setMessage({ tone: 'caution', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const noteFor = async (c: LadderContact) => {
    const [task] = await addLinkedInTasks([c], { id: job.id, company: job.company, title: job.title, description: job.description }, facts);
    const note = task?.note || (await db.linkedinTasks.get(`${job.id}|${c.profileUrl}`))?.note;
    if (note) copy(`li:${c.id}`, note);
    openUrl(c.profileUrl!);
    setMessage({ tone: 'ok', text: task ? `Note copied and saved in Pipeline. On LinkedIn: Connect → Add a note → paste → Send.` : `You already have a note for ${c.name} in Pipeline (copied).` });
  };
  const notesForTop = async () => {
    const tasks = await addLinkedInTasks(pickLinkedInPeople(ladder), { id: job.id, company: job.company, title: job.title, description: job.description }, facts);
    setMessage({ tone: tasks.length ? 'ok' : 'caution', text: tasks.length ? `Added ${tasks.length} LinkedIn ${tasks.length === 1 ? 'note' : 'notes'} to Pipeline: ${tasks.map((t) => t.name).join(', ')}.` : 'No one new with a LinkedIn profile here. Open LinkedIn people search below, then press Read people on this page.' });
  };
  const linkedInCount = pickLinkedInPeople(ladder).length;

  const pick = (c: LadderContact) => onPick({ name: c.tier === 5 ? '' : c.name, role: c.role || '', email: c.email || '', contactType: c.contactType });

  const tiers = ([1, 3, 4, 5] as const).map((tier) => ({ tier, contacts: ladder.filter((c) => c.tier === tier) })).filter((t) => t.contacts.length);
  const visible = showAll ? tiers : tiers.map((t) => ({ ...t, contacts: t.contacts.slice(0, t.tier === 3 ? 5 : 3) }));
  const hidden = ladder.length - visible.reduce((n, t) => n + t.contacts.length, 0);
  const guesses = name.trim().split(/\s+/).length >= 2 && cleanDomain(domain).includes('.') ? generateEmailPermutations(name, cleanDomain(domain)) : [];

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row between">
          <div className="h2">Who to contact</div>
          <Pill tone={ladder.length ? 'ok' : 'neutral'}>{ladder.length} found</Pill>
        </div>
        <p className="small muted">Best first: someone you know, then the person closest to the hiring decision, then the inbox.</p>
        <Field label="Company website">
          <div className="row">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="razorpay.com" onKeyDown={(e) => e.key === 'Enter' && runLookup()} />
            <button className="btn primary" onClick={runLookup} disabled={busy !== null}>
              {busy === 'lookup' ? <RefreshCw size={14} className="spin" /> : <Search size={14} />} Look up
            </button>
          </div>
        </Field>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={readThisPage} disabled={busy !== null}>
            {busy === 'page' ? <RefreshCw size={12} className="spin" /> : <ScanSearch size={12} />} Read people on this page
          </button>
          <button className="btn sm ghost" onClick={() => openUrl(linkedInPeopleSearchUrl(job.company))} title="Opens LinkedIn's people search for HR, founders and managers here. Then press Read people on this page.">
            <ExternalLink size={12} /> Find them on LinkedIn
          </button>
          {linkedInCount > 0 && (
            <button className="btn sm ghost" onClick={notesForTop}>
              <UserPlus size={12} /> LinkedIn notes for top {linkedInCount}
            </button>
          )}
        </div>
        {pattern && <p className="small muted">Email format: {patternProof(pattern)}. Addresses in this format are marked confirmed.</p>}
        {message && <Callout tone={message.tone}>{message.text}</Callout>}
      </section>

      <ReachOutCard job={job} ladder={ladder} facts={facts} voiceProfile={voiceProfile} settings={settings} hasKey={hasKey} goTo={goTo} />

      {connections.length === 0 && (
        <Callout>
          Import your LinkedIn connections to see people you already know there (LinkedIn → Settings → Data privacy → Get a copy of your data → Connections).{' '}
          <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => goTo('you')}>
            Import
          </button>
        </Callout>
      )}

      {visible.map(({ tier, contacts }) => (
        <section key={tier} className="card">
          <h3 className="section-title">{TIER_LABELS[tier]}</h3>
          <div className="list">
            {contacts.map((c) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <span className="h2 truncate">{c.name}</span>
                    {c.profileUrl && (
                      <button className="btn icon sm ghost" title="Open profile" onClick={() => openUrl(c.profileUrl!)}>
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </div>
                  {c.role && <div className="small truncate">{c.role}</div>}
                  <div className="small muted">{c.why}</div>
                  {c.email && (
                    <div className="small" style={{ marginTop: 2 }}>
                      <span className="mono">{c.email}</span> <span className="muted">· {EMAIL_LABEL[c.emailStatus!]}</span>
                    </div>
                  )}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {c.tier !== 4 && (
                      <button className="btn sm primary" onClick={() => pick(c)}>
                        Write
                      </button>
                    )}
                    {c.profileUrl && /linkedin\.com\/(?:in|pub)\//.test(c.profileUrl) && (
                      <button className="btn sm" onClick={() => noteFor(c)}>
                        {copied === `li:${c.id}` ? <Check size={12} /> : <UserPlus size={12} />} LinkedIn note
                      </button>
                    )}
                    {c.tier === 1 && (
                      <button
                        className="btn sm"
                        onClick={() => {
                          const conn = connections.find((x) => `conn:${x.id}` === c.id);
                          if (conn) copy(c.id, generateWarmReferralNote(conn, job.title, settings.userFullName));
                        }}
                      >
                        {copied === c.id ? <Check size={12} /> : <Copy size={12} />} Referral ask
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {hidden > 0 && (
        <button className="btn sm ghost" onClick={() => setShowAll(true)}>
          Show {hidden} more
        </button>
      )}

      {settings.userCollege ? (
        <Callout>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <GraduationCap size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <b>Alumni.</b> LinkedIn's export doesn't include schools, so Hirivo can't see alumni itself.{' '}
              <a href={alumniSearchUrl(job.company, settings.userCollege)} onClick={(e) => (e.preventDefault(), openUrl(alumniSearchUrl(job.company, settings.userCollege)))}>
                Search {settings.userCollege} alumni at {job.company}
              </a>
              .
            </span>
          </div>
        </Callout>
      ) : (
        <p className="small muted">Add your college in You → Profile to search for alumni at {job.company}.</p>
      )}

      <details className="card section">
        <summary>
          <Users size={16} />
          <span className="h2">Know a name? Guess their email</span>
        </summary>
        <div className="stack section-body">
          <Field label="Their full name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
          </Field>
          {guesses.map((g) => (
            <div key={g.email} className="row between">
              <span className="mono small">{g.email}</span>
              <button className="btn sm" onClick={() => onPick({ name: name.trim(), role: '', email: g.email, contactType: 'COLD_HIRING_MGR' })}>
                Use
              </button>
            </div>
          ))}
          {guesses.length > 0 && <p className="small muted">Educated guesses only. Business emails only; Hirivo never looks up personal emails or phone numbers.</p>}
        </div>
      </details>
    </div>
  );
}
