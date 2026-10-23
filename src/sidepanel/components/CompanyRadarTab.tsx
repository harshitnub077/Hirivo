import React, { useState, useEffect } from 'react';
import {
  Radar,
  Building2,
  MapPin,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Mail,
  Zap,
  Filter,
  Globe2,
  Flame,
  CheckSquare,
  Square,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { DiscoveredOpportunity, ResumeRecord, ResumeFact, UserSettings } from '../../db';
import { scanRadarOpportunities, RadarFilterOptions } from '../../services/companyRadar';
import { createGmailDraft } from '../../services/gmailService';
import { generateProofLinkedDraft } from '../../services/proofWriter';
import { buildAutofillProfile } from '../../services/formAutofill';

interface CompanyRadarTabProps {
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  settings: UserSettings | null;
  onNavigateToSettings: () => void;
}

export const CompanyRadarTab: React.FC<CompanyRadarTabProps> = ({
  resume,
  facts,
  settings,
  onNavigateToSettings,
}) => {
  const [locationInput, setLocationInput] = useState(settings?.preferredLocation || 'Remote');
  const [workMode, setWorkMode] = useState<RadarFilterOptions['workMode']>('all');
  const [companyTier, setCompanyTier] = useState<RadarFilterOptions['companyTier']>('all');

  const [opportunities, setOpportunities] = useState<DiscoveredOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [batchActionStatus, setBatchActionStatus] = useState<string | null>(null);

  // Auto-scan on mount or when filters change
  useEffect(() => {
    handleScan();
  }, [workMode, companyTier]);

  const handleScan = async () => {
    setLoading(true);
    setBatchActionStatus(null);
    try {
      const results = await scanRadarOpportunities(
        {
          location: locationInput,
          workMode,
          companyTier,
        },
        resume,
        facts
      );
      setOpportunities(results);
    } catch (err: any) {
      console.warn('Radar scan error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    setOpportunities((prev) =>
      prev.map((op) => (op.id === id ? { ...op, selected: !op.selected } : op))
    );
  };

  const handleSelectAll = (select: boolean) => {
    setOpportunities((prev) => prev.map((op) => ({ ...op, selected: select })));
  };

  const selectedCount = opportunities.filter((op) => op.selected).length;

  // 1-Click Form Autofill Launcher for a specific opportunity
  const handleLaunchAutofill = async (op: DiscoveredOpportunity) => {
    const profile = buildAutofillProfile(settings);

    // Open target application page in a new active tab
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const tab = await chrome.tabs.create({ url: op.applyUrl, active: true });
      // Tell content script to execute autofill once loaded
      setTimeout(() => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE_AUTOFILL', profile });
        }
      }, 2500);
    } else {
      window.open(op.applyUrl, '_blank');
    }
  };

  // Batch Outreach Automator: Creates proof-linked Gmail drafts for selected opportunities
  const handleBatchDraftEmails = async () => {
    const selected = opportunities.filter((op) => op.selected);
    if (selected.length === 0) return;

    setBatchActionStatus(`Drafting proof-linked outreach for ${selected.length} companies...`);

    let draftedCount = 0;
    for (const op of selected) {
      try {
        if (op.hiringLeadEmail) {
          // Generate proof-linked draft
          const draft = await generateProofLinkedDraft({
            jobTitle: op.jobTitle,
            companyName: op.companyName,
            recipientName: op.hiringLead?.split(' (')[0] || 'Hiring Team',
            facts,
          });

          // Create draft in Gmail
          await createGmailDraft({
            recipientEmail: op.hiringLeadEmail,
            recipientName: op.hiringLead || 'Hiring Lead',
            subject: draft.emailSubject,
            body: draft.emailBody,
            jobId: op.id,
            companyName: op.companyName,
            jobTitle: op.jobTitle,
            contactType: 'COLD_HIRING_MGR',
            factsCited: draft.citedFactIds,
          });
          draftedCount++;
        }
      } catch (err: any) {
        console.warn(`Draft creation failed for ${op.companyName}:`, err);
      }
    }

    setBatchActionStatus(`✅ Created ${draftedCount} personalized drafts in your Gmail! Review & click send.`);
    confetti({
      particleCount: 70,
      spread: 80,
      origin: { y: 0.7 },
    });
  };

  return (
    <div>
      {/* Radar Discovery Filter Header */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Radar size={15} color="var(--accent-cyan)" /> Live Company Radar
          </div>
          <span className="badge badge-emerald">
            {opportunities.length} Active Targets Found
          </span>
        </div>

        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Scrapes hiring companies around your area and remote feeds. Choose where you want to apply, then launch the automator.
        </p>

        {/* Work Mode Toggle Pills */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
          {[
            { id: 'all', label: 'All Modes' },
            { id: 'remote', label: '🌐 Remote' },
            { id: 'onsite', label: '📍 On-Site (Area)' },
            { id: 'hybrid', label: '🔄 Hybrid' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setWorkMode(mode.id as any)}
              style={{
                flex: 1,
                padding: '5px 2px',
                fontSize: '10.5px',
                fontWeight: 600,
                borderRadius: '6px',
                background: workMode === mode.id ? 'var(--accent-cyan-glow)' : 'var(--bg-surface)',
                color: workMode === mode.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                border: workMode === mode.id ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Company Tier Selector */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
          {[
            { id: 'all', label: 'All Tiers' },
            { id: 'underrated', label: '💎 Underrated Gems' },
            { id: 'top_tech', label: '🏢 Top Tech Unicorns' },
          ].map((tier) => (
            <button
              key={tier.id}
              onClick={() => setCompanyTier(tier.id as any)}
              style={{
                flex: 1,
                padding: '5px 2px',
                fontSize: '10.5px',
                fontWeight: 600,
                borderRadius: '6px',
                background: companyTier === tier.id ? 'var(--accent-emerald-glow)' : 'var(--bg-surface)',
                color: companyTier === tier.id ? '#34d399' : 'var(--text-secondary)',
                border: companyTier === tier.id ? '1px solid #10b981' : '1px solid var(--border-subtle)',
              }}
            >
              {tier.label}
            </button>
          ))}
        </div>

        {/* Location Input & Scan Button */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <MapPin size={12} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Your Area (e.g. San Francisco, Bangalore, London)"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              style={{ paddingLeft: '28px', fontSize: '11.5px' }}
            />
          </div>
          <button
            className="btn-primary"
            style={{ fontSize: '11.5px', padding: '6px 12px' }}
            onClick={handleScan}
            disabled={loading}
          >
            {loading ? 'Scanning...' : 'Scan Radar'}
          </button>
        </div>
      </div>

      {/* Automator Batch Control Bar */}
      {opportunities.length > 0 && (
        <div
          style={{
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            marginBottom: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
            <button
              onClick={() => handleSelectAll(selectedCount !== opportunities.length)}
              style={{ background: 'transparent', color: 'var(--accent-cyan)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {selectedCount === opportunities.length ? <CheckSquare size={13} /> : <Square size={13} />}
              <span>{selectedCount} Selected</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="btn-primary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={handleBatchDraftEmails}
              disabled={selectedCount === 0}
            >
              <Mail size={11} /> Batch Draft Outreach ({selectedCount})
            </button>
          </div>
        </div>
      )}

      {batchActionStatus && (
        <div
          className="card"
          style={{
            background: 'var(--accent-emerald-glow)',
            border: '1px solid var(--accent-emerald)',
            color: '#34d399',
            fontSize: '11.5px',
            marginBottom: '10px',
          }}
        >
          {batchActionStatus}
        </div>
      )}

      {/* Discovered Opportunities List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {opportunities.map((op) => {
          const isSelected = op.selected;

          return (
            <div
              key={op.id}
              className="card"
              style={{
                margin: 0,
                borderLeft: isSelected ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                background: isSelected ? 'rgba(26, 34, 52, 0.9)' : 'var(--bg-card)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(op.id)}
                    style={{ width: '15px', height: '15px', marginTop: '2px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text-primary)' }}>
                        {op.companyName}
                      </span>
                      {op.companyTier === 'UNDERRATED_GEM' && (
                        <span className="badge badge-amber" style={{ fontSize: '9.5px', padding: '1px 6px' }}>
                          💎 Hidden Gem
                        </span>
                      )}
                      {op.companyTier === 'TOP_TECH' && (
                        <span className="badge badge-cyan" style={{ fontSize: '9.5px', padding: '1px 6px' }}>
                          🏢 Top Tech
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--accent-cyan)', fontWeight: 600, marginTop: '2px' }}>
                      {op.jobTitle}
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>📍 {op.location}</span>
                      <span>•</span>
                      <span>{op.fundingStage}</span>
                    </div>
                  </div>
                </div>

                {/* Match Score Badge */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--accent-emerald)' }}>
                    {op.matchScore}%
                  </div>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>Match</div>
                </div>
              </div>

              {/* Tech Stack Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {op.techStack.map((tech) => (
                  <span
                    key={tech}
                    style={{
                      fontSize: '10px',
                      background: 'rgba(255,255,255,0.06)',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {tech}
                  </span>
                ))}
              </div>

              {/* Hiring Lead Signal & Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '10px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  Lead: <strong style={{ color: 'var(--text-primary)' }}>{op.hiringLead}</strong>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '10.5px', padding: '4px 8px' }}
                    onClick={() => handleLaunchAutofill(op)}
                    title="Open career page with 1-Click Form Autofill primed"
                  >
                    <Zap size={11} color="var(--accent-cyan)" /> Autofill Form
                  </button>
                  <a
                    href={op.applyUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-muted)',
                      textDecoration: 'none',
                    }}
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
