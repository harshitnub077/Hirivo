import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, BookmarkCheck, Check, Download, ExternalLink, Send, Sparkles, X } from 'lucide-react';
import { db, DiscoveredJob, UserSettings } from '../../db';
import { patchSettings } from '../../db/settings';
import { runDiscover, setJobStatus, SOURCES } from '../../services/discover';
import { openUrl } from '../../services/outreach';
import { Callout, Empty, Pill, Segmented, timeAgo, toneForScore } from '../ui';
import { getActivePage, saveJobsFromActivePage } from '../page';
import { ResumeImport } from './ResumeImport';
import { AutopilotButton } from './AutopilotViews';
import { Daily5Card } from './Daily5Card';
import { SearchCard } from './SearchCard';
import { browserSearchHost } from '../../services/discover/host';

type Filter = 'new' | 'saved' | 'applying' | 'companies';
const SEARCH_SITES = /linkedin\.com|naukri\.com|indeed\.|wellfound\.com|instahyre\.com|cutshort\.io|foundit\.in/;

export function DiscoverPanel({ settings, hasResume }: { settings: UserSettings; hasResume: boolean }) {
  const [filter, setFilter] = useState<Filter>('new');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'caution'; text: string } | null>(null);
  const [pageHost, setPageHost] = useState<string | null>(null);

  const jobs = useLiveQuery(() => db.discovered.orderBy('score').reverse().toArray(), []) ?? [];
  const fetchRows = useLiveQuery(() => db.sourceFetches.toArray(), []);
  const fetches = fetchRows ?? [];
  const lastRun = Math.max(0, ...fetches.map((f) => f.fetchedAt));

  const refresh = async (force: boolean) => {
    setRunning(true);
    setMessage(null);
    try {
      const r = await runDiscover({ force, host: browserSearchHost() });
      setMessage({ tone: 'ok', text: `${r.total} matching jobs, ${r.added} new.` });
    } catch (err: any) {
      setMessage({ tone: 'caution', text: err.message });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    getActivePage().then((p) => setPageHost(p && SEARCH_SITES.test(p.host) ? p.host : null));
  }, []);

  // Refresh automatically when the feed is older than 6 hours.
  // Waits for the fetch log to load: before that, lastRun reads as "never" and every open re-searched.
  useEffect(() => {
    if (fetchRows === undefined) return;
    if (hasResume && ((settings.targetRoles?.length ?? 0) > 0 || (settings.chosenRoles?.length ?? 0) > 0) && Date.now() - lastRun > 2 * 3_600_000 && !running) refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRows === undefined, hasResume, settings.targetRoles?.join(','), JSON.stringify(settings.search), settings.smallTeamsOnly]);

  const savePage = async () => {
    setMessage(null);
    try {
      const { host, count } = await saveJobsFromActivePage();
      setMessage({ tone: 'ok', text: `Saved ${count} jobs from ${host}. Find them under Saved.` });
      setFilter('saved');
    } catch (err: any) {
      setMessage({ tone: 'caution', text: err.message });
    }
  };

  const apply = async (job: DiscoveredJob) => {
    await setJobStatus(job.id, 'applying');
    await openUrl(job.url);
    setMessage({
      tone: 'ok',
      text: `Opened ${job.company}. On Greenhouse, Lever, Ashby and Workable forms Hirivo fills your details and attaches your resume. Check everything, then press Submit yourself.`,
    });
  };

  if (!hasResume) {
    return (
      <div className="stack">
        <Callout>Upload your resume and Hirivo will find internships and jobs that fit you on LinkedIn, Naukri, Internshala, Indeed, Unstop and company career sites.</Callout>
        <ResumeImport />
      </div>
    );
  }

  const shown = jobs.filter((j) =>
    filter === 'companies' ? j.kind === 'company' && j.status !== 'dismissed' : j.kind !== 'company' && (filter === 'applying' ? j.status === 'applying' || j.status === 'applied' : j.status === filter)
  );
  const counts = {
    new: jobs.filter((j) => j.kind !== 'company' && j.status === 'new').length,
    saved: jobs.filter((j) => j.status === 'saved').length,
    applying: jobs.filter((j) => j.status === 'applying' || j.status === 'applied').length,
    companies: jobs.filter((j) => j.kind === 'company' && j.status !== 'dismissed').length,
  };
  const nextSaved = jobs.find((j) => j.status === 'saved');

  return (
    <div className="stack">
      <Daily5Card />
      <SearchCard settings={settings} running={running} onSearch={() => refresh(true)} />
      <section className="card stack">
        <label className="row small">
          <input type="checkbox" checked={Boolean(settings.smallTeamsOnly)} onChange={(e) => patchSettings({ smallTeamsOnly: e.target.checked })} />
          Only small teams (under 100 people). Fewer applicants, more impact.
        </label>
        {pageHost && (
          <button className="btn block" onClick={savePage}>
            <Download size={14} /> Save jobs listed on {pageHost}
          </button>
        )}
        {message && <Callout tone={message.tone}>{message.text}</Callout>}
      </section>

      <Segmented<Filter>
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'new', label: `For you ${counts.new || ''}`.trim() },
          { value: 'saved', label: `Saved ${counts.saved || ''}`.trim() },
          { value: 'applying', label: `Applied ${counts.applying || ''}`.trim() },
          { value: 'companies', label: `Startups ${counts.companies || ''}`.trim() },
        ]}
      />

      {filter === 'saved' && counts.saved > 1 && (
        <AutopilotButton
          jobs={jobs.filter((j) => j.status === 'saved' && j.kind !== 'company').map((j) => ({ url: j.url, title: j.title, company: j.company }))}
          settings={settings}
          label={`Autopilot all ${counts.saved} saved jobs`}
          className="btn block"
        />
      )}
      {filter === 'saved' && nextSaved && (
        <button className="btn primary block" onClick={() => apply(nextSaved)}>
          <Send size={14} /> Apply to next saved: {nextSaved.company}
        </button>
      )}

      {shown.length === 0 ? (
        <Empty icon={<Sparkles size={28} className={running ? 'spin' : undefined} />} title={running ? 'Searching every source…' : 'Nothing here yet'}>
          {running
            ? 'Searching LinkedIn, Naukri, Internshala, Indeed, Unstop and company boards. This takes about a minute.'
            : filter === 'new'
            ? 'Press Refresh. If nothing shows up, widen your roles or choose Anywhere.'
            : filter === 'saved'
              ? 'Save jobs with the bookmark button, or from a LinkedIn or Naukri search page.'
              : filter === 'applying'
                ? 'Jobs you open with Apply show up here.'
                : 'Small YC teams that are hiring but have no public job board appear here.'}
        </Empty>
      ) : (
        <section className="card">
          <div className="list">
            {shown.slice(0, 60).map((j) => (
              <JobRow key={j.id} job={j} settings={settings} onApply={() => apply(j)} />
            ))}
          </div>
        </section>
      )}

      <p className="small muted">
        Sources:{' '}
        {SOURCES.filter((s) => s.site).map((s, i, arr) => {
          const f = fetches.find((x) => x.id === s.id);
          return (
            <span key={s.id}>
              <a href={s.site} onClick={(e) => (e.preventDefault(), openUrl(s.site))} title={f?.error || `${f?.count ?? 0} jobs`}>
                {s.label}
              </a>
              {f?.error ? ' (unavailable)' : ''}
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          );
        })}
        {lastRun > 0 && ` · updated ${timeAgo(lastRun)}`}
      </p>
    </div>
  );
}

function JobRow({ job, settings, onApply }: { job: DiscoveredJob; settings: UserSettings; onApply: () => void }) {
  const posted = job.postedAt ? `posted ${timeAgo(job.postedAt)}` : '';
  const saved = job.status === 'saved';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      {job.kind === 'company' ? (
        <div>
          <div className="row between">
            <div className="h2 truncate">{job.company}</div>
            {job.smallTeamReason && <Pill tone="ok">{job.smallTeamReason}</Pill>}
          </div>
          <div className="small">{job.title.replace(/^Hiring:\s*/, '')}</div>
          <div className="small muted truncate">{job.location}</div>
        </div>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h2">{job.title}</div>
              <div className="small muted truncate">
                {[job.company, job.location, job.distanceKm ? `${job.distanceKm} km` : '', posted].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Pill tone={toneForScore(job.score, { good: 70, ok: 45 })} title="Match with your roles and skills">
              {job.score}
            </Pill>
          </div>
          <div className="row wrap" style={{ gap: 5 }}>
            {job.internship && <Pill tone="ok">Internship</Pill>}
            {job.smallTeamReason && <Pill tone="ok">{job.smallTeamReason}</Pill>}
            {job.salary && <Pill>{job.salary}</Pill>}
            <a className="small muted" href={job.sourceUrl || job.url} onClick={(e) => (e.preventDefault(), openUrl(job.sourceUrl || job.url))}>
              via {job.sourceLabel}
            </a>
          </div>
          {job.matchReasons.length > 0 && <div className="small muted">{job.matchReasons.join(' · ')}</div>}
        </>
      )}
      <div className="row" style={{ gap: 6 }}>
        {job.status === 'applying' ? (
          <>
            <button className="btn sm primary" onClick={() => setJobStatus(job.id, 'applied')}>
              <Check size={12} /> I submitted it
            </button>
            <button className="btn sm" onClick={onApply}>
              Reopen
            </button>
          </>
        ) : job.status === 'applied' ? (
          <Pill tone="ok">Applied {job.appliedAt ? timeAgo(job.appliedAt) : ''}</Pill>
        ) : (
          <button className="btn sm primary" onClick={onApply}>
            {job.kind === 'company' ? <ExternalLink size={12} /> : <Send size={12} />} {job.kind === 'company' ? 'See roles' : 'Apply'}
          </button>
        )}
        {job.kind !== 'company' && job.status !== 'applied' && <AutopilotButton jobs={[{ url: job.url, title: job.title, company: job.company }]} settings={settings} compact />}
        {job.status !== 'applied' && job.status !== 'applying' && (
          <button className="btn sm icon ghost" title={saved ? 'Unsave' : 'Save'} onClick={() => setJobStatus(job.id, saved ? 'new' : 'saved')}>
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </button>
        )}
        {job.status !== 'applied' && (
          <button className="btn sm icon ghost" title="Not interested" onClick={() => setJobStatus(job.id, 'dismissed')}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
