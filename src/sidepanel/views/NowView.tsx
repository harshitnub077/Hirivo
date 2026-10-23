import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, MapPin, RefreshCw, ScanSearch, ShieldCheck } from 'lucide-react';
import { JobSnapshot, ResumeFact, ResumeRecord, UserSettings, VoiceProfile } from '../../db';
import { checkGhostJob } from '../../services/ghostJobShield';
import { checkLegitimacy, extractDomainFromUrl } from '../../services/legitimacyScorer';
import { analyzeJobFit } from '../../services/fitAdvisor';
import { findWarmPaths } from '../../services/warmPathMatcher';
import { daysSince } from '../../services/atsFeeds';
import { checkScam } from '../../services/scamShield';
import { recordFingerprint } from '../../services/repostFingerprint';
import { Callout, Empty, Pill, Segmented, Tone, toneForScore } from '../ui';
import type { ActivePage } from '../page';
import type { ViewId } from '../App';
import { EvidencePanel } from './EvidencePanel';
import { PeoplePanel } from './PeoplePanel';
import { WritePanel } from './WritePanel';
import { ResumeImport } from './ResumeImport';

type Panel = 'evidence' | 'people' | 'write';

const TONE_RANK: Record<Tone, number> = { neutral: 0, ok: 1, caution: 2, risk: 3 };
const worstTone = (a: Tone, b: Tone): Tone => (TONE_RANK[a] >= TONE_RANK[b] ? a : b);

export interface Recipient {
  name: string;
  role: string;
  email: string;
  contactType: 'WARM_CONNECTION' | 'ALUMNI' | 'COLD_HIRING_MGR';
}

interface Props {
  job: JobSnapshot | null;
  page: ActivePage | null;
  scanning: boolean;
  scanError: string | null;
  onAnalyze: () => void;
  onUpdateJob: (job: JobSnapshot) => Promise<void>;
  settings: UserSettings;
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  goTo: (v: ViewId) => void;
}

export function NowView(props: Props) {
  const { job, page, scanning, scanError, onAnalyze, onUpdateJob, settings, resume, facts } = props;
  const [panel, setPanel] = useState<Panel>('evidence');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<Recipient>({ name: '', role: '', email: '', contactType: 'COLD_HIRING_MGR' });

  const warmCount = useLiveQuery(async () => (job?.company ? (await findWarmPaths(job.company)).length : 0), [job?.company]) ?? 0;

  useEffect(() => {
    setPanel('evidence');
    setCheckError(null);
    setRecipient({ name: '', role: '', email: '', contactType: 'COLD_HIRING_MGR' });
  }, [job?.id]);

  const hasKey = Boolean(settings.groqApiKey || settings.geminiApiKey || settings.openrouterApiKey);

  if (!job) {
    return (
      <div className="view">
        {facts.length === 0 && !resume && (
          <section className="stack">
            <div>
              <div className="h1">Start with your resume</div>
              <p className="small muted">Hirivo fills your profile, picks roles that fit, and starts finding jobs for you.</p>
            </div>
            <ResumeImport onDone={() => props.goTo('radar')} />
          </section>
        )}
        <Empty
          icon={<ScanSearch size={30} />}
          title={page ? 'Analyze this job' : 'Open a job posting'}
          action={
            <button className="btn primary" onClick={onAnalyze} disabled={scanning || !page}>
              {scanning ? <RefreshCw size={14} className="spin" /> : <ScanSearch size={14} />}
              {scanning ? 'Reading the page…' : 'Analyze this page'}
            </button>
          }
        >
          {page
            ? 'Hirivo checks if the job is real, if you fit, and who to message. It reads the page only when you press Analyze.'
            : 'Open a job on LinkedIn, Naukri, Wellfound, Indeed or a company careers page, then come back here.'}
        </Empty>
        {scanError && <Callout tone="caution">{scanError}</Callout>}
        <Callout>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <ShieldCheck size={16} color="var(--brand)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <b>Ban-safe by design.</b> Hirivo never clicks, connects or sends anything on LinkedIn. It prepares the words; you press send.
            </span>
          </div>
        </Callout>
      </div>
    );
  }

  const runChecks = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const domain = job.companyDomain || extractDomainFromUrl(job.url) || undefined;
      const fitWanted = hasKey && (facts.length > 0 || !!resume);
      const [ghost, legit, fit] = await Promise.all([
        checkGhostJob({
          jobTitle: job.title,
          companyName: job.company,
          sourceUrl: job.url,
          atsUrl: job.atsUrl,
          jobPostedDate: job.postedDate,
          isReposted: job.isReposted,
        }),
        checkLegitimacy({ domain, companyName: job.company }),
        fitWanted ? analyzeJobFit(job.title, job.company, job.description, resume, facts).catch((e: Error) => e) : null,
      ]);
      if (fit instanceof Error) setCheckError(`Fit check failed: ${fit.message}`);
      const fitResult = fit instanceof Error ? null : fit;
      // Domain age and mail records are shown from legit itself, so Scam Shield only reads the listing here.
      const scam = checkScam({ title: job.title, description: job.description, companyDomain: domain });
      const repost = await recordFingerprint(job).catch(() => null);
      const scamFindings = [...scam.findings, ...(repost?.finding ? [repost.finding] : [])];
      const scamLevel = scamFindings.some((f) => f.tone === 'risk') ? 'risk' : scamFindings.length ? 'caution' : 'clear';
      await onUpdateJob({
        ...job,
        ghostScore: ghost.ghostScore,
        ghostReasons: ghost.reasons,
        atsType: ghost.atsType,
        atsSlug: ghost.atsSlug,
        atsPublishedAt: ghost.atsPublishedAt,
        scamLevel,
        scamFindings,
        legitScore: domain ? legit.score : undefined,
        legitDetails: domain
          ? { domainAgeDays: legit.domainAgeDays, hasMx: legit.hasMx, mailProvider: legit.mailProvider, isFreeEmail: legit.isFreeEmail }
          : undefined,
        ...(fitResult
          ? {
              fitScore: fitResult.matchScore,
              fitVerdict: fitResult.verdict,
              honestAdvice: fitResult.honestAdvice,
              dealbreakers: fitResult.dealbreakers,
              matchingStrengths: fitResult.matchingStrengths,
              skillGaps: fitResult.skillGaps,
            }
          : {}),
        analyzedAt: Date.now(),
      });
      setPanel('evidence');
    } catch (err: any) {
      setCheckError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const analyzed = job.analyzedAt > 0;
  const ghostTone: Tone = !analyzed ? 'neutral' : job.atsType === 'unknown' && (job.ghostScore ?? 0) < 60 ? 'neutral' : toneForScore(100 - (job.ghostScore ?? 0), { good: 65, ok: 40 });
  const realLabel = !analyzed ? '—' : ghostTone === 'ok' ? 'Live' : ghostTone === 'caution' ? 'Aging' : ghostTone === 'risk' ? 'Doubtful' : 'Unconfirmed';
  const fitTone = toneForScore(job.fitScore, { good: 80, ok: 55 });
  const legitTone: Tone = job.legitScore === undefined ? 'neutral' : toneForScore(job.legitScore, { good: 70, ok: 45 });
  const scamTone: Tone = job.scamLevel === 'risk' ? 'risk' : job.scamLevel === 'caution' ? 'caution' : job.scamLevel === 'clear' ? 'ok' : 'neutral';
  const safetyTone = worstTone(legitTone, scamTone);
  const safetyLabel =
    safetyTone === 'risk'
      ? 'Risky'
      : safetyTone === 'caution'
        ? 'Check'
        : safetyTone === 'ok'
          ? job.legitScore === undefined
            ? 'No flags'
            : 'Clear'
          : analyzed
            ? 'Add site'
            : '—';
  const atsAge = daysSince(job.atsPublishedAt);

  return (
    <div className="view">
      <section className="card fade-in">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="h1">{job.title}</h1>
            <div className="row wrap small muted" style={{ marginTop: 3, gap: 10 }}>
              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{job.company || 'Unknown company'}</span>
              {job.location && (
                <span className="row" style={{ gap: 3 }}>
                  <MapPin size={12} /> {job.location}
                </span>
              )}
              {(job.postedDate || atsAge !== undefined) && (
                <span className="row" style={{ gap: 3 }}>
                  <Clock size={12} /> {atsAge !== undefined ? `${atsAge} d on company board` : job.postedDate}
                </span>
              )}
            </div>
          </div>
          <button className="btn icon sm ghost" title="Read the page again" onClick={onAnalyze} disabled={scanning}>
            <RefreshCw size={14} className={scanning ? 'spin' : ''} />
          </button>
        </div>

        <div className="verdict-strip" style={{ marginTop: 12 }}>
          <Pill tone={ghostTone} onClick={() => setPanel('evidence')} title="Is the job real and still open?">
            <small>Real</small>
            <b>{realLabel}</b>
          </Pill>
          <Pill tone={fitTone} onClick={() => setPanel('evidence')} title="How well your resume matches">
            <small>Fit</small>
            <b className="num">{job.fitScore !== undefined ? `${job.fitScore}%` : '—'}</b>
          </Pill>
          <Pill tone={warmCount > 0 ? 'ok' : 'neutral'} onClick={() => setPanel('people')} title="People you know there">
            <small>People</small>
            <b>{warmCount > 0 ? `${warmCount} warm` : 'Find'}</b>
          </Pill>
          <Pill tone={safetyTone} onClick={() => setPanel('evidence')} title="Company and scam checks">
            <small>Safety</small>
            <b>{safetyLabel}</b>
          </Pill>
        </div>

        {!analyzed && (
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={runChecks} disabled={checking}>
            {checking ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}
            {checking ? 'Checking the board, domain and fit…' : 'Run checks'}
          </button>
        )}
        {scanError && <div style={{ marginTop: 10 }}><Callout tone="caution">{scanError}</Callout></div>}
        {checkError && <div style={{ marginTop: 10 }}><Callout tone="caution">{checkError}</Callout></div>}
      </section>

      <Segmented<Panel>
        label="Job sections"
        value={panel}
        onChange={setPanel}
        options={[
          { value: 'evidence', label: 'Evidence' },
          { value: 'people', label: 'People' },
          { value: 'write', label: 'Write' },
        ]}
      />

      <div hidden={panel !== 'evidence'}>
        <EvidencePanel
          job={job}
          analyzed={analyzed}
          checking={checking}
          hasKey={hasKey}
          hasResume={facts.length > 0 || !!resume}
          onRecheck={runChecks}
          onUpdateJob={onUpdateJob}
          goTo={props.goTo}
          onWrite={() => setPanel('write')}
        />
      </div>
      <div hidden={panel !== 'people'}>
        <PeoplePanel
          job={job}
          settings={settings}
          onUpdateJob={onUpdateJob}
          goTo={props.goTo}
          onPick={(r) => {
            setRecipient(r);
            setPanel('write');
          }}
        />
      </div>
      <div hidden={panel !== 'write'}>
        <WritePanel
          job={job}
          facts={facts}
          voiceProfile={props.voiceProfile}
          settings={settings}
          hasKey={hasKey}
          recipient={recipient}
          onRecipientChange={setRecipient}
          goTo={props.goTo}
        />
      </div>
    </div>
  );
}
