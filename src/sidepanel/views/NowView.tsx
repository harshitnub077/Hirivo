import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Circle, Clock, MapPin, RefreshCw, ScanSearch, ShieldCheck } from 'lucide-react';
import { db, JobSnapshot, ResumeFact, ResumeRecord, UserSettings, VoiceProfile } from '../../db';
import { checkGhostJob } from '../../services/ghostJobShield';
import { checkLegitimacy } from '../../services/legitimacyScorer';
import { companyDomainOf } from '../../services/companyDomain';
import { analyzeJobFit } from '../../services/fitAdvisor';
import { findWarmPaths } from '../../services/warmPathMatcher';
import { daysSince } from '../../services/atsFeeds';
import { checkScam } from '../../services/scamShield';
import { realVerdict, safetyVerdict } from '../../services/verdicts';
import { recordFingerprint } from '../../services/repostFingerprint';
import { Callout, Empty, Meter, Pill, Segmented, toneForScore } from '../ui';
import type { ActivePage } from '../page';
import type { ViewId } from '../App';
import { EvidencePanel } from './EvidencePanel';
import { PeoplePanel } from './PeoplePanel';
import { WritePanel } from './WritePanel';
import { ResumeImport } from './ResumeImport';
import { AnswerPanel } from './AnswerPanel';
import { ResumePanel } from './ResumePanel';

type Panel = 'evidence' | 'people' | 'write' | 'resume' | 'answers';


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

/** First-run checklist. Disappears once the essentials are done. */
function GettingStarted({ hasResume, hasKey, settings, goTo }: { hasResume: boolean; hasKey: boolean; settings: UserSettings; goTo: (v: ViewId) => void }) {
  const connections = useLiveQuery(() => db.connections.count(), []) ?? 0;
  const steps = [
    { done: hasResume, label: 'Upload your resume', hint: 'Fills your profile and finds your achievements.', go: undefined as ViewId | undefined },
    { done: (settings.targetRoles?.length ?? 0) > 0, label: 'Pick the roles you want', hint: 'Discover finds jobs for them every 12 hours.', go: 'radar' as ViewId },
    { done: hasKey, label: 'Add a free AI key', hint: 'For fit scores, emails and answers. Groq takes a minute.', go: 'you' as ViewId },
    { done: connections > 0, label: 'Import your LinkedIn connections', hint: 'Shows people you already know at each company.', go: 'you' as ViewId },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section className="card stack">
      <div className="row between">
        <div className="h1">Get set up</div>
        <span className="small muted num">{done} of {steps.length}</span>
      </div>
      <Meter value={(done / steps.length) * 100} label="Setup progress" />
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'ok' : 'neutral'}>
            {s.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            <span className="grow">
              {s.go && !s.done ? (
                <button className="linklike" onClick={() => goTo(s.go!)}>
                  {s.label}
                </button>
              ) : (
                <b style={{ fontWeight: s.done ? 400 : 600 }}>{s.label}</b>
              )}
              {!s.done && <span className="muted"> · {s.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!hasResume && <ResumeImport compact onDone={() => goTo('radar')} />}
      <p className="small muted">Tip: press Alt+H on any page to open Hirivo.</p>
    </section>
  );
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
        <GettingStarted hasResume={facts.length > 0 || !!resume} hasKey={hasKey} settings={settings} goTo={props.goTo} />
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
      const domain = companyDomainOf(job.companyDomain) || companyDomainOf(job.url);
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
        fitWanted ? analyzeJobFit(job.title, job.company, job.description, resume, facts, { yearsExperience: settings.yearsExperience, skills: settings.skills }).catch((e: Error) => e) : null,
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
        companyDomain: domain,
        legitScore: domain && legit.checked ? legit.score : undefined,
        legitDetails: domain && legit.checked
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
              fitEvidence: fitResult.evidence,
              // Requirement ids change between runs; keep a sprint only once it's done (its fact stays).
              proofSprint: job.proofSprint?.completedAt ? job.proofSprint : undefined,
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
  const { tone: ghostTone, label: realLabel } = realVerdict(job);
  const fitTone = toneForScore(job.fitScore, { good: 80, ok: 55 });
  const { tone: safetyTone, label: safetyLabel } = safetyVerdict(job);
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

        <div className={`verdict-strip${analyzed ? ' ready' : ''}`} key={job.analyzedAt} style={{ marginTop: 12 }}>
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
          { value: 'resume', label: 'Resume' },
          { value: 'answers', label: 'Answers' },
        ]}
      />

      <div hidden={panel !== 'evidence'}>
        <EvidencePanel
          key={job.id}
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
          key={job.id}
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
      <div hidden={panel !== 'resume'}>
        <ResumePanel key={job.id} job={job} facts={facts} resume={resume} settings={settings} hasKey={hasKey} onUpdateJob={onUpdateJob} goTo={props.goTo} />
      </div>
      <div hidden={panel !== 'answers'}>
        <AnswerPanel key={job.id} job={job} facts={facts} voiceProfile={props.voiceProfile} settings={settings} hasKey={hasKey} goTo={props.goTo} />
      </div>
      <div hidden={panel !== 'write'}>
        <WritePanel
          key={job.id}
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
