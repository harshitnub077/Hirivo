import React, { useState, useEffect } from 'react';
import {
  Radar,
  Sparkles,
  FileEdit,
  Users,
  Clock,
  Settings as SettingsIcon,
  Building2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { db, JobSnapshot, ResumeRecord, ResumeFact, VoiceProfile, OutreachRecord, UserSettings } from '../db';
import { CompanyRadarTab } from './components/CompanyRadarTab';
import { JobOverviewTab } from './components/JobOverviewTab';
import { ProofWriterTab } from './components/ProofWriterTab';
import { WarmPathTab } from './components/WarmPathTab';
import { TrackerTab } from './components/TrackerTab';
import { SettingsTab } from './components/SettingsTab';
import './styles/globals.css';

type TabType = 'radar' | 'overview' | 'writer' | 'warmpath' | 'tracker' | 'settings';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('radar');
  const [currentJob, setCurrentJob] = useState<JobSnapshot | null>(null);
  const [resume, setResume] = useState<ResumeRecord | null>(null);
  const [facts, setFacts] = useState<ResumeFact[]>([]);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | undefined>();
  const [outreachList, setOutreachList] = useState<OutreachRecord[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [connectionsCount, setConnectionsCount] = useState(0);

  const [loadingJob, setLoadingJob] = useState(false);

  const loadDatabaseData = async () => {
    try {
      const savedSettings = await db.settings.get('config');
      setSettings(savedSettings || null);

      const savedResume = await db.resumes.get('primary');
      setResume(savedResume || null);

      const savedFacts = await db.facts.toArray();
      setFacts(savedFacts);

      const savedVoice = await db.voiceProfiles.get('default');
      setVoiceProfile(savedVoice || undefined);

      const savedOutreach = await db.outreach.orderBy('createdAt').reverse().toArray();
      setOutreachList(savedOutreach);

      const connCount = await db.connections.count();
      setConnectionsCount(connCount);
    } catch (err) {
      console.warn('Database load error:', err);
    }
  };

  useEffect(() => {
    loadDatabaseData();
    scanActiveTab();
  }, []);

  const scanActiveTab = async () => {
    setLoadingJob(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_JOB_DATA' });
            if (response && response.data) {
              const d = response.data;
              const snapshot: JobSnapshot = {
                id: d.sourceUrl || tab.url || 'current_job',
                url: d.sourceUrl || tab.url || '',
                title: d.title || 'Software Engineer',
                company: d.company || 'Company',
                location: d.location || '',
                description: d.description || '',
                postedDate: d.postedDate,
                analyzedAt: Date.now(),
              };
              setCurrentJob(snapshot);
              await db.jobs.put(snapshot);
            }
          } catch (tabErr) {
            console.log('Active tab message failed; using fallback or cached job.', tabErr);
          }
        }
      }
    } catch (err) {
      console.warn('Tab query error:', err);
    } finally {
      setLoadingJob(false);
    }
  };

  const handleUpdateJob = async (updated: JobSnapshot) => {
    setCurrentJob(updated);
    await db.jobs.put(updated);
  };

  const handleUpdateOutreach = async (updated: OutreachRecord) => {
    await db.outreach.put(updated);
    const refreshed = await db.outreach.orderBy('createdAt').reverse().toArray();
    setOutreachList(refreshed);
  };

  const hasApiKeys = Boolean(
    settings?.groqApiKey || settings?.geminiApiKey || settings?.openrouterApiKey
  );

  return (
    <div style={{ padding: '14px', maxWidth: '440px', margin: '0 auto' }}>
      {/* Top Header with Authentic Company Logo */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          paddingBottom: '10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/logo.png"
            alt="Hirivo Logo"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '7px',
              objectFit: 'contain',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Hirivo
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1 }}>
              Radar &amp; Automator
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {currentJob?.company && (
            <span
              className="badge badge-cyan"
              style={{ maxWidth: '110px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
              title={currentJob.company}
            >
              <Building2 size={10} /> {currentJob.company}
            </span>
          )}
          <button
            onClick={scanActiveTab}
            title="Scan active page"
            style={{
              background: 'var(--bg-surface-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              padding: '5px 8px',
              borderRadius: '6px',
            }}
          >
            <RefreshCw size={12} className={loadingJob ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <nav
        style={{
          display: 'flex',
          gap: '3px',
          background: 'var(--bg-surface)',
          padding: '3px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '12px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <button
          onClick={() => setActiveTab('radar')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'radar' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'radar' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Radar size={12} />
          <span>Radar</span>
        </button>

        <button
          onClick={() => setActiveTab('overview')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'overview' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'overview' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Sparkles size={12} />
          <span>Job Intel</span>
        </button>

        <button
          onClick={() => setActiveTab('writer')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'writer' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'writer' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <FileEdit size={12} />
          <span>Writer</span>
        </button>

        <button
          onClick={() => setActiveTab('warmpath')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'warmpath' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'warmpath' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Users size={12} />
          <span>Warm Path</span>
        </button>

        <button
          onClick={() => setActiveTab('tracker')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'tracker' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'tracker' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Clock size={12} />
          <span>Tracker</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          style={{
            flex: 1,
            padding: '5px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            borderRadius: '6px',
            background: activeTab === 'settings' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'settings' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <SettingsIcon size={12} />
          <span>Settings</span>
        </button>
      </nav>

      {/* Main Tab Content */}
      <main>
        {activeTab === 'radar' && (
          <CompanyRadarTab
            resume={resume}
            facts={facts}
            settings={settings}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'overview' && (
          <JobOverviewTab
            job={currentJob}
            resume={resume}
            facts={facts}
            onUpdateJob={handleUpdateJob}
            onRefreshActiveTab={scanActiveTab}
            onNavigateToWriter={() => setActiveTab('writer')}
            hasApiKeys={hasApiKeys}
          />
        )}

        {activeTab === 'writer' && (
          <ProofWriterTab
            job={currentJob}
            resume={resume}
            facts={facts}
            voiceProfile={voiceProfile}
            hasApiKeys={hasApiKeys}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'warmpath' && (
          <WarmPathTab
            job={currentJob}
            settings={settings}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'tracker' && (
          <TrackerTab
            outreachList={outreachList}
            settings={settings}
            onUpdateOutreach={handleUpdateOutreach}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            resume={resume}
            facts={facts}
            voiceProfile={voiceProfile}
            connectionsCount={connectionsCount}
            onRefreshData={loadDatabaseData}
          />
        )}
      </main>
    </div>
  );
};
