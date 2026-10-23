import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Building2,
  MapPin,
  Clock,
  MailCheck,
  Globe2,
} from 'lucide-react';
import { JobSnapshot, ResumeRecord, ResumeFact } from '../../db';
import { checkGhostJob } from '../../services/ghostJobShield';
import { checkLegitimacy, extractDomainFromUrl } from '../../services/legitimacyScorer';
import { analyzeJobFit } from '../../services/fitAdvisor';

interface JobOverviewTabProps {
  job: JobSnapshot | null;
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  onUpdateJob: (updated: JobSnapshot) => void;
  onRefreshActiveTab: () => void;
  onNavigateToWriter: () => void;
  hasApiKeys: boolean;
}

export const JobOverviewTab: React.FC<JobOverviewTabProps> = ({
  job,
  resume,
  facts,
  onUpdateJob,
  onRefreshActiveTab,
  onNavigateToWriter,
  hasApiKeys,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!job) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
        <Building2 size={36} color="var(--accent-cyan)" style={{ margin: '0 auto 12px' }} />
        <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>No Job Page Detected</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '16px' }}>
          Open any job listing on LinkedIn, Naukri, or company career boards, then click scan.
        </p>
        <button className="btn-primary" onClick={onRefreshActiveTab}>
          <RefreshCw size={14} /> Scan Active Tab
        </button>
      </div>
    );
  }

  const runFullAnalysis = async () => {
    setAnalyzing(true);
    setError(null);

    try {
      // 1. Ghost Job Shield
      const ghost = await checkGhostJob({
        jobTitle: job.title,
        companyName: job.company,
        jobPostedDate: job.postedDate,
        sourceUrl: job.url,
      });

      // 2. Company Legitimacy
      const domain = job.companyDomain || extractDomainFromUrl(job.url) || undefined;
      const legit = await checkLegitimacy({
        domain,
        companyName: job.company,
      });

      // 3. Honest Fit Advisor (if API keys configured and resume present)
      let fitScore = job.fitScore;
      let fitVerdict = job.fitVerdict;
      let honestAdvice = job.honestAdvice;
      let dealbreakers = job.dealbreakers;
      let matchingStrengths = job.matchingStrengths;
      let skillGaps = job.skillGaps;

      if (hasApiKeys && (resume || facts.length > 0)) {
        try {
          const fitResult = await analyzeJobFit(job.title, job.company, job.description, resume, facts);
          fitScore = fitResult.matchScore;
          fitVerdict = fitResult.verdict;
          honestAdvice = fitResult.honestAdvice;
          dealbreakers = fitResult.dealbreakers;
          matchingStrengths = fitResult.matchingStrengths;
          skillGaps = fitResult.skillGaps;
        } catch (fitErr: any) {
          console.warn('Fit analysis failed:', fitErr);
        }
      }

      const updatedJob: JobSnapshot = {
        ...job,
        ghostScore: ghost.ghostScore,
        ghostReasons: ghost.reasons,
        atsType: ghost.atsType,
        legitScore: legit.score,
        legitDetails: {
          domainAgeDays: legit.domainAgeDays,
          hasMx: legit.hasMx,
          mailProvider: legit.mailProvider,
          isFreeEmail: legit.isFreeEmail,
        },
        fitScore,
        fitVerdict,
        honestAdvice,
        dealbreakers,
        matchingStrengths,
        skillGaps,
        analyzedAt: Date.now(),
      };

      onUpdateJob(updatedJob);
    } catch (err: any) {
      setError(err.message || 'Verification scan failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const isGhost = (job.ghostScore ?? 0) >= 60;
  const isDoNotApply = job.fitVerdict === 'DO_NOT_APPLY' || (job.fitScore !== undefined && job.fitScore < 55);

  return (
    <div>
      {/* Target Job Header Card */}
      <div className="card" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.25 }}>
              {job.title}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', color: 'var(--text-secondary)', fontSize: '12px' }}>
              <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{job.company}</span>
              {job.location && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <MapPin size={11} /> {job.location}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onRefreshActiveTab}
            title="Re-scan page"
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              padding: '4px',
              borderRadius: '4px',
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {job.postedDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '11px', marginTop: '6px' }}>
            <Clock size={11} /> {job.postedDate}
          </div>
        )}

        <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
          <button
            className="btn-primary"
            style={{ flex: 1, fontSize: '12px', padding: '6px 12px' }}
            onClick={runFullAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <RefreshCw size={12} className="spin" /> Analyzing Signals...
              </>
            ) : (
              <>
                <Sparkles size={12} /> Verify Job & Fit
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ background: 'var(--accent-rose-glow)', border: '1px solid var(--accent-rose)', color: '#fb7185', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {/* Grid: Ghost Shield & Legitimacy */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
        {/* Ghost Shield Card */}
        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>GHOST ROLE CHECK</span>
            {job.ghostScore !== undefined ? (
              job.ghostScore < 35 ? (
                <span className="badge badge-emerald"><ShieldCheck size={11} /> Live</span>
              ) : job.ghostScore < 60 ? (
                <span className="badge badge-amber"><AlertTriangle size={11} /> Aging</span>
              ) : (
                <span className="badge badge-rose"><ShieldAlert size={11} /> Ghost Risk</span>
              )
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Not scanned</span>
            )}
          </div>

          <div style={{ fontSize: '18px', fontWeight: 800, color: job.ghostScore && job.ghostScore >= 60 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
            {job.ghostScore !== undefined ? `${100 - job.ghostScore}% Fresh` : '--'}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {job.atsType && job.atsType !== 'unknown' ? (
              <span>Synced with {job.atsType.toUpperCase()} ATS</span>
            ) : (
              <span>Public board scan</span>
            )}
          </div>
        </div>

        {/* Legitimacy Score Card */}
        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>COMPANY TRUST</span>
            {job.legitScore !== undefined ? (
              job.legitScore >= 75 ? (
                <span className="badge badge-emerald">Verified</span>
              ) : job.legitScore >= 50 ? (
                <span className="badge badge-amber">Moderate</span>
              ) : (
                <span className="badge badge-rose">Scam Risk</span>
              )
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Not scanned</span>
            )}
          </div>

          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
            {job.legitScore !== undefined ? `${job.legitScore}/100` : '--'}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {job.legitDetails?.hasMx ? (
              <span style={{ color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <MailCheck size={11} /> MX Verified
              </span>
            ) : (
              <span>DNS checked</span>
            )}
          </div>
        </div>
      </div>

      {/* Honest Fit Advisor Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Sparkles size={14} color="var(--accent-cyan)" /> Honest Fit Advisor
          </div>
          {job.fitVerdict && (
            <span
              className={`badge ${
                job.fitVerdict === 'STRONG_FIT'
                  ? 'badge-emerald'
                  : job.fitVerdict === 'MODERATE_FIT'
                  ? 'badge-amber'
                  : 'badge-rose'
              }`}
            >
              {job.fitVerdict.replace('_', ' ')}
            </span>
          )}
        </div>

        {job.fitScore !== undefined ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '28px', fontWeight: 800, color: isDoNotApply ? 'var(--accent-rose)' : 'var(--accent-emerald)', letterSpacing: '-0.02em' }}>
                {job.fitScore}%
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Skill & Experience Match</span>
            </div>

            {/* Advice paragraph */}
            {job.honestAdvice && (
              <div
                style={{
                  background: isDoNotApply ? 'var(--accent-rose-glow)' : 'var(--bg-surface)',
                  border: isDoNotApply ? '1px solid rgba(244,63,94,0.3)' : '1px solid var(--border-subtle)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  marginBottom: '10px',
                  color: isDoNotApply ? '#fda4af' : 'var(--text-primary)',
                }}
              >
                {job.honestAdvice}
              </div>
            )}

            {/* Dealbreakers Alert */}
            {job.dealbreakers && job.dealbreakers.length > 0 && (
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-rose)', marginBottom: '4px' }}>
                  HARD DEALBREAKERS (WILL CAUSE ATS REJECTION):
                </div>
                {job.dealbreakers.map((d, i) => (
                  <div key={i} style={{ fontSize: '11.5px', color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '3px' }}>
                    <span>•</span> <span>{d}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Matching Strengths */}
            {job.matchingStrengths && job.matchingStrengths.length > 0 && (
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: '4px' }}>
                  PROVEN MATCHING STRENGTHS:
                </div>
                {job.matchingStrengths.map((s, i) => (
                  <div key={i} style={{ fontSize: '11.5px', color: '#6ee7b7', display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '3px' }}>
                    <CheckCircle2 size={12} style={{ flexShrink: 0, marginTop: '2px' }} /> <span>{s}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Skill Gaps Bridge */}
            {job.skillGaps && job.skillGaps.length > 0 && (
              <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  BRIDGE-THE-GAP RECOMMENDATIONS:
                </div>
                {job.skillGaps.map((g, i) => (
                  <div key={i} style={{ background: 'var(--bg-surface-elevated)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', marginBottom: '4px', fontSize: '11px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>{g.skill} ({g.timeToAcquire})</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{g.studyRecommendation}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Click &ldquo;Verify Job & Fit&rdquo; above to calculate your match score using llama-3.1-8b-instant.
          </p>
        )}
      </div>

      {/* Action Footer */}
      <div style={{ marginTop: '16px' }}>
        {isDoNotApply ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-rose-glow)',
              border: '1px solid var(--accent-rose)',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#fb7185', fontWeight: 700, fontSize: '12px', marginBottom: '4px' }}>
              ⚠️ Honest Advice: Do Not Apply
            </div>
            <p style={{ color: '#fda4af', fontSize: '11px', marginBottom: '8px' }}>
              Your profile does not meet hard requirements. Save your daily outreach quota for high-match opportunities.
            </p>
            <button
              className="btn-secondary"
              style={{ width: '100%', fontSize: '11.5px', color: '#fda4af' }}
              onClick={onNavigateToWriter}
            >
              Draft Anyway (Override Warning)
            </button>
          </div>
        ) : (
          <button
            className="btn-primary"
            style={{ width: '100%', padding: '10px', fontSize: '13px' }}
            onClick={onNavigateToWriter}
          >
            Proceed to Proof-Linked Outreach <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
