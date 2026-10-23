import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Sparkles,
  Copy,
  Check,
  Building2,
  Mail,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { JobSnapshot, LinkedInConnection, UserSettings } from '../../db';
import { findWarmPaths, WarmPathMatch, generateWarmReferralNote } from '../../services/warmPathMatcher';
import { generateEmailPermutations, EmailPermutation } from '../../services/contactInference';
import { extractDomainFromUrl } from '../../services/legitimacyScorer';

interface WarmPathTabProps {
  job: JobSnapshot | null;
  settings: UserSettings | null;
  onNavigateToSettings: () => void;
}

export const WarmPathTab: React.FC<WarmPathTabProps> = ({ job, settings, onNavigateToSettings }) => {
  const [warmMatches, setWarmMatches] = useState<WarmPathMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedReferralId, setCopiedReferralId] = useState<string | null>(null);

  // Email permutation tool
  const [inferName, setInferName] = useState('');
  const [inferDomain, setInferDomain] = useState('');
  const [permutations, setPermutations] = useState<EmailPermutation[]>([]);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  useEffect(() => {
    if (job?.company) {
      setLoading(true);
      findWarmPaths(job.company)
        .then((matches) => setWarmMatches(matches))
        .catch(console.error)
        .finally(() => setLoading(false));

      // Auto-populate domain if available
      const dom = job.companyDomain || extractDomainFromUrl(job.url);
      if (dom) {
        setInferDomain(dom);
      }
    }
  }, [job]);

  const handleCopyReferral = (conn: LinkedInConnection) => {
    if (!job) return;
    const note = generateWarmReferralNote(conn, job.title, settings?.userFullName || 'A Connection');
    navigator.clipboard.writeText(note);
    setCopiedReferralId(conn.id);
    setTimeout(() => setCopiedReferralId(null), 2000);
  };

  const handleInferEmails = () => {
    if (!inferName || !inferDomain) return;
    const res = generateEmailPermutations(inferName, inferDomain);
    setPermutations(res);
  };

  const handleCopyPermutation = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  return (
    <div>
      {/* Warm-Path Referrals Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Users size={14} color="var(--accent-emerald)" /> Warm-Path Connections
          </div>
          <span className="badge badge-cyan">{warmMatches.length} Matches</span>
        </div>

        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          1st-degree connections at <strong style={{ color: 'var(--accent-cyan)' }}>{job?.company || 'Target Company'}</strong> from your imported LinkedIn CSV. A referral converts 10x higher than a cold email.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Scanning local connection network...
          </div>
        ) : warmMatches.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {warmMatches.map((m) => (
              <div
                key={m.connection.id}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
                      {m.connection.fullName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '1px' }}>
                      {m.connection.position || 'Employee'} at {m.connection.company}
                    </div>
                    {m.connection.connectedOn && (
                      <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Connected {m.connection.connectedOn}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '11px', padding: '5px 8px' }}
                    onClick={() => handleCopyReferral(m.connection)}
                  >
                    {copiedReferralId === m.connection.id ? (
                      <>
                        <Check size={11} color="var(--accent-emerald)" /> Copied Note
                      </>
                    ) : (
                      <>
                        <Copy size={11} /> Copy Referral Ask
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px dashed var(--border-subtle)',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              No direct connections found at {job?.company || 'this company'}.
            </div>
            <button
              className="btn-secondary"
              style={{ fontSize: '11px' }}
              onClick={onNavigateToSettings}
            >
              Import LinkedIn Connections CSV
            </button>
          </div>
        )}
      </div>

      {/* Safe Contact & Email Inference Section */}
      <div className="card">
        <div className="card-title">
          <Mail size={14} color="var(--accent-cyan)" /> Email Pattern Finder (No Scraping)
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Infer enterprise business email formats outside LinkedIn using verified company patterns and DNS MX records.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Manager / Lead Full Name
            </label>
            <input
              type="text"
              placeholder="e.g. John Doe"
              value={inferName}
              onChange={(e) => setInferName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Company Domain
            </label>
            <input
              type="text"
              placeholder="e.g. stripe.com"
              value={inferDomain}
              onChange={(e) => setInferDomain(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', fontSize: '11.5px', marginBottom: '12px' }}
          onClick={handleInferEmails}
        >
          Generate Inferred Email Patterns
        </button>

        {permutations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              INFERRED ENTERPRISE PATTERNS:
            </div>
            {permutations.map((p) => (
              <div
                key={p.email}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--bg-surface-elevated)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11.5px',
                }}
              >
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                    {p.email}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                    ({p.confidence}% prob)
                  </span>
                </div>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '10.5px', padding: '3px 6px' }}
                  onClick={() => handleCopyPermutation(p.email)}
                >
                  {copiedEmail === p.email ? <Check size={11} color="var(--accent-emerald)" /> : <Copy size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
