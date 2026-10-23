import React, { useState, useEffect } from 'react';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertOctagon,
  Copy,
  Mail,
  Send,
  Wand2,
  ExternalLink,
  ShieldCheck,
  Check,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { JobSnapshot, ResumeRecord, ResumeFact, VoiceProfile } from '../../db';
import { generateProofLinkedDraft, ProofWriterResult } from '../../services/proofWriter';
import { lintOutreachText, autoPurgeRoboticPhrases, LinterResult } from '../../services/phraseLinter';
import { createGmailDraft } from '../../services/gmailService';

interface ProofWriterTabProps {
  job: JobSnapshot | null;
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  hasApiKeys: boolean;
  onNavigateToSettings: () => void;
}

export const ProofWriterTab: React.FC<ProofWriterTabProps> = ({
  job,
  resume,
  facts,
  voiceProfile,
  hasApiKeys,
  onNavigateToSettings,
}) => {
  const [recipientName, setRecipientName] = useState('');
  const [recipientRole, setRecipientRole] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [realSignalHook, setRealSignalHook] = useState('');

  const [generating, setGenerating] = useState(false);
  const [draftResult, setDraftResult] = useState<ProofWriterResult | null>(null);

  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [linkedInNote, setLinkedInNote] = useState('');

  const [linter, setLinter] = useState<LinterResult>({ humanScore: 100, issues: [], cleanText: '' });
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);

  // Lint email body on every change
  useEffect(() => {
    if (emailBody) {
      const lint = lintOutreachText(emailBody);
      setLinter(lint);
    }
  }, [emailBody]);

  if (!hasApiKeys) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <Sparkles size={32} color="var(--accent-amber)" style={{ margin: '0 auto 10px' }} />
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>Configure API Key</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '14px' }}>
          Bring your own free Groq or Gemini API key to generate grounded outreach drafts.
        </p>
        <button className="btn-primary" onClick={onNavigateToSettings}>
          Go to Settings
        </button>
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <FileText size={32} color="var(--accent-cyan)" style={{ margin: '0 auto 10px' }} />
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>No Resume Facts Ingested</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '14px' }}>
          Hirivo requires your resume facts to ground every sentence and block AI hallucinations.
        </p>
        <button className="btn-primary" onClick={onNavigateToSettings}>
          Upload Resume in Settings
        </button>
      </div>
    );
  }

  const handleGenerate = async () => {
    if (!job) return;
    setGenerating(true);
    setDraftStatus(null);

    try {
      const res = await generateProofLinkedDraft({
        jobTitle: job.title,
        companyName: job.company,
        recipientName: recipientName.trim() || undefined,
        recipientRole: recipientRole.trim() || undefined,
        facts,
        voiceProfile,
        realSignalHook: realSignalHook.trim() || undefined,
      });

      setDraftResult(res);
      setEmailSubject(res.emailSubject);
      setEmailBody(res.emailBody);
      setLinkedInNote(res.linkedInNote);

      // Trigger celebratory micro-confetti for a high-grounding draft
      if (res.unverifiedClaimsCount === 0) {
        confetti({
          particleCount: 30,
          spread: 60,
          origin: { y: 0.8 },
        });
      }
    } catch (err: any) {
      alert(err.message || 'Draft generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handlePurgeRoboticClichés = () => {
    const cleaned = autoPurgeRoboticPhrases(emailBody);
    setEmailBody(cleaned);
  };

  const handleCreateGmailDraft = async () => {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      alert('Please provide a valid recipient email address.');
      return;
    }
    if (!job) return;

    setCreatingDraft(true);
    setDraftStatus(null);

    try {
      const result = await createGmailDraft({
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || 'Hiring Manager',
        subject: emailSubject,
        body: emailBody,
        jobId: job.id,
        companyName: job.company,
        jobTitle: job.title,
        contactType: 'COLD_HIRING_MGR',
        factsCited: draftResult?.citedFactIds || [],
      });

      if (result.success) {
        setDraftStatus(`✅ Draft created in Gmail! (${result.dailyCount}/${result.dailyCap} daily cap used)`);
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.7 },
        });
      } else {
        setDraftStatus(`⚠️ ${result.error}`);
      }
    } catch (err: any) {
      setDraftStatus(`❌ ${err.message}`);
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleCopyNote = () => {
    navigator.clipboard.writeText(linkedInNote);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 2000);
  };

  return (
    <div>
      {/* Target & Real Signal Inputs */}
      <div className="card">
        <div className="card-title">
          <Wand2 size={14} color="var(--accent-cyan)" /> Outreach Personalization
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
              Recipient Name
            </label>
            <input
              type="text"
              placeholder="e.g. Sarah Connor"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
              Role / Title
            </label>
            <input
              type="text"
              placeholder="e.g. VP Engineering"
              value={recipientRole}
              onChange={(e) => setRecipientRole(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
            Real-Signal Hook (Recent blog, GitHub release, or funding news)
          </label>
          <input
            type="text"
            placeholder="e.g. Read your blog post on zero-copy serialization"
            value={realSignalHook}
            onChange={(e) => setRealSignalHook(e.target.value)}
          />
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', fontSize: '12.5px' }}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Grounding Claims & Drafting...' : 'Generate Proof-Linked Draft'}
        </button>
      </div>

      {/* Grounded Draft Editor */}
      {emailBody && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Proof-Linked Email Draft
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Linter Human Score Badge */}
              <span
                className={`badge ${linter.humanScore === 100 ? 'badge-emerald' : linter.humanScore >= 70 ? 'badge-amber' : 'badge-rose'}`}
                title="Human Tone Score"
              >
                {linter.humanScore}% Human Tone
              </span>
            </div>
          </div>

          {/* Subject Line */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Subject Line
            </label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
            />
          </div>

          {/* Email Body */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Email Body (Facts cited in brackets)
            </label>
            <textarea
              rows={8}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              style={{ lineHeight: 1.5, fontSize: '12px' }}
            />
          </div>

          {/* Linter Alerts & 1-Click Purge */}
          {linter.issues.length > 0 && (
            <div
              style={{
                background: 'var(--accent-amber-glow)',
                border: '1px solid rgba(245,158,11,0.3)',
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '10px',
                fontSize: '11.5px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, color: '#fbbf24' }}>
                  {linter.issues.length} Robotic Clichés Detected:
                </span>
                <button
                  onClick={handlePurgeRoboticClichés}
                  style={{
                    background: '#fbbf24',
                    color: '#090d16',
                    fontWeight: 700,
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  Purge Clichés
                </button>
              </div>
              {linter.issues.slice(0, 3).map((iss, i) => (
                <div key={i} style={{ color: '#fde68a', fontSize: '11px' }}>
                  • &ldquo;{iss.phrase}&rdquo;: {iss.explanation}
                </div>
              ))}
            </div>
          )}

          {/* Proof Link Inspector */}
          {draftResult && draftResult.unverifiedClaimsCount > 0 && (
            <div
              style={{
                background: 'var(--accent-rose-glow)',
                border: '1px solid rgba(244,63,94,0.3)',
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '10px',
                color: '#fb7185',
                fontSize: '11.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AlertOctagon size={14} style={{ flexShrink: 0 }} />
              <span>
                {draftResult.unverifiedClaimsCount} claim(s) lack proof tags. Please link a resume fact before sending.
              </span>
            </div>
          )}

          {/* Facts Cited Chips */}
          {draftResult && draftResult.citedFactIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <ShieldCheck size={12} color="var(--accent-emerald)" /> Grounded Facts:
              </span>
              {draftResult.citedFactIds.map((id) => (
                <span key={id} className="fact-token" title={facts.find((f) => f.id === id)?.claim}>
                  {id}
                </span>
              ))}
            </div>
          )}

          {/* Recipient Email & Actions */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Hiring Manager / Recipient Email Address
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="email"
                placeholder="e.g. sarah.connor@acme.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn-primary"
                onClick={handleCreateGmailDraft}
                disabled={creatingDraft}
                title="Create draft in Gmail web app"
              >
                <Mail size={13} /> {creatingDraft ? 'Creating...' : 'Create Gmail Draft'}
              </button>
            </div>

            {draftStatus && (
              <div style={{ fontSize: '11.5px', marginTop: '6px', color: 'var(--text-primary)' }}>
                {draftStatus}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                className="btn-secondary"
                style={{ flex: 1, fontSize: '11.5px' }}
                onClick={handleCopyEmail}
              >
                {copiedEmail ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
                {copiedEmail ? 'Copied Email!' : 'Copy Email Text'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Short LinkedIn Connection Note */}
      {linkedInNote && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
              LinkedIn Connection Note (&lt; 300 chars)
            </span>
            <span style={{ fontSize: '11px', color: linkedInNote.length > 300 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
              {linkedInNote.length}/300
            </span>
          </div>
          <textarea
            rows={3}
            value={linkedInNote}
            onChange={(e) => setLinkedInNote(e.target.value)}
            style={{ fontSize: '11.5px', lineHeight: 1.4, marginBottom: '8px' }}
          />
          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '11.5px' }}
            onClick={handleCopyNote}
          >
            {copiedNote ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
            {copiedNote ? 'Copied Note to Clipboard!' : 'Copy LinkedIn Note (Safe: You Paste & Send)'}
          </button>
        </div>
      )}
    </div>
  );
};
