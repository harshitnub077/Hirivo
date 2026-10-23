import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Compass, Radar, Send, UserRound } from 'lucide-react';
import { db, JobSnapshot } from '../db';
import { getSettings } from '../db/settings';
import { dueFollowupStage } from '../services/outreach';
import { Mark } from './ui';
import { NowView } from './views/NowView';
import { RadarView } from './views/RadarView';
import { PipelineView } from './views/PipelineView';
import { YouView } from './views/YouView';
import { ActivePage, analyzeActivePage, getActivePage, jobIdFor } from './page';
import './styles/globals.css';

export type ViewId = 'now' | 'radar' | 'pipeline' | 'you';

const TABS: { id: ViewId; label: string; icon: typeof Compass }[] = [
  { id: 'now', label: 'Now', icon: Compass },
  { id: 'radar', label: 'Radar', icon: Radar },
  { id: 'pipeline', label: 'Pipeline', icon: Send },
  { id: 'you', label: 'You', icon: UserRound },
];

export const App: React.FC = () => {
  const [view, setView] = useState<ViewId>('now');
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [page, setPage] = useState<ActivePage | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const settings = useLiveQuery(() => getSettings(), []);
  const facts = useLiveQuery(() => db.facts.toArray(), []) ?? [];
  const resume = useLiveQuery(() => db.resumes.get('primary'), []);
  const voiceProfile = useLiveQuery(() => db.voiceProfiles.get('default'), []);
  const outreach = useLiveQuery(() => db.outreach.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const watchlist = useLiveQuery(() => db.watchlist.toArray(), []) ?? [];

  const followupsDue = outreach.filter((r) => dueFollowupStage(r) > 0).length;
  const newRoles = watchlist.reduce((n, c) => n + c.newRoleIds.length, 0);

  // Track which page is open so "Now" can show the saved analysis for it, without reading the page.
  useEffect(() => {
    const sync = async () => {
      const p = await getActivePage();
      setPage(p);
      setScanError(null);
      const saved = p ? await db.jobs.get(jobIdFor(p.url)) : undefined;
      setJob(saved ?? null);
    };
    sync();
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    const onActivated = () => sync();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => info.url && sync();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const analyze = async () => {
    setScanning(true);
    setScanError(null);
    try {
      setJob(await analyzeActivePage());
      setView('now');
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const updateJob = async (next: JobSnapshot) => {
    setJob(next);
    await db.jobs.put(next);
  };

  if (!settings) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Mark size={22} />
          <span>hirivo</span>
        </div>
        <div className="spacer" />
        {page && <span className="small muted truncate">{page.host}</span>}
      </header>

      <main className="content">
        {view === 'now' && (
          <NowView
            job={job}
            page={page}
            scanning={scanning}
            scanError={scanError}
            onAnalyze={analyze}
            onUpdateJob={updateJob}
            settings={settings}
            resume={resume ?? null}
            facts={facts}
            voiceProfile={voiceProfile}
            goTo={setView}
          />
        )}
        {view === 'radar' && <RadarView watchlist={watchlist} settings={settings} />}
        {view === 'pipeline' && <PipelineView outreach={outreach} settings={settings} />}
        {view === 'you' && <YouView settings={settings} resume={resume ?? null} facts={facts} voiceProfile={voiceProfile} />}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
            <Icon size={18} strokeWidth={view === id ? 2.2 : 1.8} />
            {label}
            {id === 'pipeline' && followupsDue > 0 && <span className="dot" aria-label={`${followupsDue} follow-ups due`} />}
            {id === 'radar' && newRoles > 0 && <span className="dot" aria-label={`${newRoles} new roles`} />}
          </button>
        ))}
      </nav>
    </div>
  );
};
