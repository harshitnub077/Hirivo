import React, { useState, useEffect } from 'react';
import {
  Key,
  FileText,
  Mic,
  Users,
  Save,
  Check,
  Plus,
  Trash2,
  Upload,
  User,
  Zap,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { db, UserSettings, ResumeRecord, ResumeFact, VoiceProfile } from '../../db';
import { calibrateVoiceProfile } from '../../services/voiceFingerprint';
import { parseLinkedInConnectionsCSV, importConnectionsToDB } from '../../services/warmPathMatcher';
import { testGroqConnection } from '../../llm/providers/groq';
import { testGeminiConnection } from '../../llm/providers/gemini';

interface SettingsTabProps {
  settings: UserSettings | null;
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  connectionsCount: number;
  onRefreshData: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  resume,
  facts,
  voiceProfile,
  connectionsCount,
  onRefreshData,
}) => {
  // Profile & Autofill Info
  const [userFullName, setUserFullName] = useState(settings?.userFullName || '');
  const [userEmail, setUserEmail] = useState(settings?.userEmail || '');
  const [userPhone, setUserPhone] = useState(settings?.userPhone || '');
  const [preferredLocation, setPreferredLocation] = useState(settings?.preferredLocation || 'San Francisco, CA');
  const [workMode, setWorkMode] = useState<UserSettings['workMode']>(settings?.workMode || 'all');
  const [linkedinUrl, setLinkedinUrl] = useState(settings?.linkedinUrl || '');
  const [githubUrl, setGithubUrl] = useState(settings?.githubUrl || '');
  const [portfolioUrl, setPortfolioUrl] = useState(settings?.portfolioUrl || '');
  const [dailyCap, setDailyCap] = useState(settings?.dailySendCap || 15);

  // API Keys
  const [groqKey, setGroqKey] = useState(settings?.groqApiKey || '');
  const [geminiKey, setGeminiKey] = useState(settings?.geminiApiKey || '');
  const [openRouterKey, setOpenRouterKey] = useState(settings?.openrouterApiKey || '');
  const [activeProvider, setActiveProvider] = useState<'groq' | 'gemini' | 'openrouter'>(
    settings?.activeProvider || 'groq'
  );

  // Resume Ingestion
  const [resumeText, setResumeText] = useState(resume?.rawText || '');
  const [newFactClaim, setNewFactClaim] = useState('');
  const [newFactCategory, setNewFactCategory] = useState<ResumeFact['category']>('METRIC');

  // Voice Fingerprint Samples
  const [voiceSampleText, setVoiceSampleText] = useState('');

  const [savedStatus, setSavedStatus] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);

  // Live API Key Test States
  const [testingGroq, setTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Sync state whenever settings prop arrives from DB
  useEffect(() => {
    if (settings) {
      if (settings.groqApiKey && !groqKey) setGroqKey(settings.groqApiKey);
      if (settings.geminiApiKey && !geminiKey) setGeminiKey(settings.geminiApiKey);
      if (settings.openrouterApiKey && !openRouterKey) setOpenRouterKey(settings.openrouterApiKey);
      if (settings.activeProvider) setActiveProvider(settings.activeProvider);
      if (settings.userFullName && !userFullName) setUserFullName(settings.userFullName);
      if (settings.userEmail && !userEmail) setUserEmail(settings.userEmail);
      if (settings.userPhone && !userPhone) setUserPhone(settings.userPhone);
      if (settings.preferredLocation && !preferredLocation) setPreferredLocation(settings.preferredLocation);
    }
  }, [settings]);

  const handleSaveSettings = async () => {
    const updated: UserSettings = {
      id: 'config',
      groqApiKey: groqKey.trim(),
      geminiApiKey: geminiKey.trim(),
      openrouterApiKey: openRouterKey.trim(),
      activeProvider,
      dailySendCap: Number(dailyCap) || 15,
      todaySendCount: settings?.todaySendCount || 0,
      lastSendDate: settings?.lastSendDate || new Date().toISOString().split('T')[0],
      userFullName: userFullName.trim(),
      userEmail: userEmail.trim(),
      userPhone: userPhone.trim(),
      preferredLocation: preferredLocation.trim(),
      workMode,
      linkedinUrl: linkedinUrl.trim(),
      githubUrl: githubUrl.trim(),
      portfolioUrl: portfolioUrl.trim(),
      userCollege: settings?.userCollege || '',
    };

    // Save to IndexedDB
    await db.settings.put(updated);

    // Also persist to chrome.storage.local for instantaneous availability across contexts
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ config: updated });
    }

    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
    onRefreshData();
  };

  const handleTestGroq = async () => {
    if (!groqKey.trim()) {
      setGroqTestResult({ success: false, message: 'Please paste your Groq API key first.' });
      return;
    }
    setTestingGroq(true);
    setGroqTestResult(null);

    // Save key first so router picks it up
    await handleSaveSettings();

    const res = await testGroqConnection(groqKey.trim());
    setGroqTestResult(res);
    setTestingGroq(false);
  };

  const handleTestGemini = async () => {
    if (!geminiKey.trim()) {
      setGeminiTestResult({ success: false, message: 'Please paste your Gemini API key first.' });
      return;
    }
    setTestingGemini(true);
    setGeminiTestResult(null);

    // Save key first
    await handleSaveSettings();

    const res = await testGeminiConnection(geminiKey.trim());
    setGeminiTestResult(res);
    setTestingGemini(false);
  };

  const handleSaveResumeText = async () => {
    if (!resumeText.trim()) return;

    await db.resumes.put({
      id: 'primary',
      fileName: 'Pasted Resume',
      rawText: resumeText,
      uploadedAt: Date.now(),
      wordCount: resumeText.split(/\s+/).length,
    });

    const bullets = resumeText
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 25 && /\b(built|led|designed|reduced|increased|developed|improved|managed|scaled|architected|implemented|created|engineered)\b/i.test(l));

    if (bullets.length > 0) {
      const generatedFacts: ResumeFact[] = bullets.slice(0, 15).map((bullet, idx) => ({
        id: `FACT-0${idx + 1}`,
        category: 'METRIC',
        claim: bullet,
        sourceSnippet: bullet,
        verified: true,
      }));
      await db.facts.bulkPut(generatedFacts);
    } else {
      // Fallback: chunk into sentences
      const sentences = resumeText.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 25);
      const generatedFacts: ResumeFact[] = sentences.slice(0, 10).map((s, idx) => ({
        id: `FACT-0${idx + 1}`,
        category: 'SKILL',
        claim: s,
        sourceSnippet: s,
        verified: true,
      }));
      await db.facts.bulkPut(generatedFacts);
    }

    onRefreshData();
    alert('Resume saved and decomposed into atomic facts for the Automator!');
  };

  const handleAddFact = async () => {
    if (!newFactClaim.trim()) return;
    const nextId = `FACT-${String(facts.length + 1).padStart(2, '0')}`;
    const newFact: ResumeFact = {
      id: nextId,
      category: newFactCategory,
      claim: newFactClaim.trim(),
      sourceSnippet: newFactClaim.trim(),
      verified: true,
    };
    await db.facts.put(newFact);
    setNewFactClaim('');
    onRefreshData();
  };

  const handleDeleteFact = async (id: string) => {
    await db.facts.delete(id);
    onRefreshData();
  };

  const handleCalibrateVoice = async () => {
    if (!voiceSampleText.trim()) return;
    const samples = voiceSampleText.split(/\n\s*---\s*\n/).filter(Boolean);
    const calibrated = calibrateVoiceProfile(samples.length > 0 ? samples : [voiceSampleText]);
    await db.voiceProfiles.put(calibrated);
    alert(`Voice calibrated! Average sentence length: ${calibrated.avgSentenceLength} words.`);
    onRefreshData();
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    try {
      const connections = parseLinkedInConnectionsCSV(text);
      const count = await importConnectionsToDB(connections);
      setCsvStatus(`✅ Successfully imported ${count} LinkedIn connections!`);
      onRefreshData();
    } catch (err: any) {
      setCsvStatus(`❌ ${err.message}`);
    }
  };

  return (
    <div>
      {/* BYOK API Keys Card */}
      <div className="card" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
        <div className="card-title">
          <Key size={14} color="var(--accent-cyan)" /> Bring Your Own Key (BYOK)
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Keys remain 100% on your device in secure local storage. Use the <strong>Test Key</strong> button below to verify your connection instantly.
        </p>

        {/* Active Provider Selector */}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Primary LLM Provider
          </label>
          <select
            value={activeProvider}
            onChange={(e) => setActiveProvider(e.target.value as any)}
          >
            <option value="groq">Groq (Recommended - Free Llama 3.1 8B)</option>
            <option value="gemini">Google Gemini Free Tier (gemini-1.5-flash)</option>
            <option value="openrouter">OpenRouter Free Tier</option>
          </select>
        </div>

        {/* Groq Key Input + Test Button */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Groq API Key (Starts with <code style={{ color: 'var(--accent-cyan)' }}>gsk_</code>)
            </label>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '10.5px', color: 'var(--accent-cyan)', textDecoration: 'none' }}
            >
              Get Free Key ↗
            </a>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="password"
              placeholder="gsk_..."
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn-secondary"
              style={{ fontSize: '11px', padding: '6px 10px', whiteSpace: 'nowrap' }}
              onClick={handleTestGroq}
              disabled={testingGroq}
            >
              <Zap size={11} color="var(--accent-cyan)" />
              {testingGroq ? 'Testing...' : 'Test Groq'}
            </button>
          </div>

          {groqTestResult && (
            <div
              style={{
                marginTop: '6px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                background: groqTestResult.success ? 'var(--accent-emerald-glow)' : 'var(--accent-rose-glow)',
                border: groqTestResult.success ? '1px solid var(--accent-emerald)' : '1px solid var(--accent-rose)',
                color: groqTestResult.success ? '#34d399' : '#fb7185',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {groqTestResult.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              <span>{groqTestResult.message}</span>
            </div>
          )}
        </div>

        {/* Gemini Key Input + Test Button */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Google Gemini API Key (Starts with <code style={{ color: 'var(--accent-cyan)' }}>AIzaSy</code>)
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '10.5px', color: 'var(--accent-cyan)', textDecoration: 'none' }}
            >
              Get Free Key ↗
            </a>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn-secondary"
              style={{ fontSize: '11px', padding: '6px 10px', whiteSpace: 'nowrap' }}
              onClick={handleTestGemini}
              disabled={testingGemini}
            >
              <Zap size={11} color="var(--accent-emerald)" />
              {testingGemini ? 'Testing...' : 'Test Gemini'}
            </button>
          </div>

          {geminiTestResult && (
            <div
              style={{
                marginTop: '6px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                background: geminiTestResult.success ? 'var(--accent-emerald-glow)' : 'var(--accent-rose-glow)',
                border: geminiTestResult.success ? '1px solid var(--accent-emerald)' : '1px solid var(--accent-rose)',
                color: geminiTestResult.success ? '#34d399' : '#fb7185',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {geminiTestResult.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              <span>{geminiTestResult.message}</span>
            </div>
          )}
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', fontSize: '12px' }}
          onClick={handleSaveSettings}
        >
          {savedStatus ? <Check size={12} color="var(--accent-emerald)" /> : <Save size={12} />}
          {savedStatus ? 'API Keys Saved!' : 'Save API Keys'}
        </button>
      </div>

      {/* 1-Click Automator & Profile Info */}
      <div className="card">
        <div className="card-title">
          <User size={14} color="var(--accent-cyan)" /> 1-Click Form Autofill Profile
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Powers the Hirivo 1-Click Form Automator across Greenhouse, Lever, Ashby, and LinkedIn application forms.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Full Name
            </label>
            <input
              type="text"
              placeholder="e.g. Alex Chen"
              value={userFullName}
              onChange={(e) => setUserFullName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Email Address
            </label>
            <input
              type="email"
              placeholder="e.g. alex@example.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Phone Number
            </label>
            <input
              type="tel"
              placeholder="+1 (555) 019-2834"
              value={userPhone}
              onChange={(e) => setUserPhone(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              Your Area / City
            </label>
            <input
              type="text"
              placeholder="e.g. San Francisco, CA or Bangalore"
              value={preferredLocation}
              onChange={(e) => setPreferredLocation(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              LinkedIn URL
            </label>
            <input
              type="url"
              placeholder="https://linkedin.com/in/alex"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
              GitHub URL
            </label>
            <input
              type="url"
              placeholder="https://github.com/alex"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn-secondary"
          style={{ width: '100%', fontSize: '12px' }}
          onClick={handleSaveSettings}
        >
          {savedStatus ? 'Profile Saved Locally!' : 'Save Autofill Profile'}
        </button>
      </div>

      {/* Resume Facts Ingestion Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div className="card-title" style={{ margin: 0 }}>
            <FileText size={14} color="var(--accent-cyan)" /> Resume & Atomic Facts ({facts.length})
          </div>
          <span className="badge badge-cyan">{facts.length} Verified</span>
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Paste your resume text once. Hirivo decomposes it into proof-linked facts to ground email outreach and answer custom application questions.
        </p>

        <textarea
          rows={4}
          placeholder="Paste resume text or experience bullet points here..."
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          style={{ fontSize: '11.5px', marginBottom: '8px' }}
        />

        <button
          className="btn-secondary"
          style={{ width: '100%', fontSize: '11.5px', marginBottom: '12px' }}
          onClick={handleSaveResumeText}
        >
          Save &amp; Auto-Extract Facts
        </button>

        {facts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginBottom: '10px' }}>
            {facts.map((f) => (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  background: 'var(--bg-surface-elevated)',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span className="fact-token" style={{ marginRight: '6px' }}>{f.id}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{f.claim}</span>
                </div>
                <button
                  onClick={() => handleDeleteFact(f.id)}
                  style={{ background: 'transparent', color: 'var(--text-muted)', padding: '2px' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            placeholder="Add custom fact (e.g. Scaled Redis cache to 15k rps)"
            value={newFactClaim}
            onChange={(e) => setNewFactClaim(e.target.value)}
            style={{ flex: 1, fontSize: '11px' }}
          />
          <button
            className="btn-secondary"
            style={{ fontSize: '11px', padding: '6px 10px' }}
            onClick={handleAddFact}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Voice Fingerprint Calibrator */}
      <div className="card">
        <div className="card-title">
          <Mic size={14} color="var(--accent-emerald)" /> Voice Fingerprint Calibrator
        </div>
        <textarea
          rows={3}
          placeholder="Paste sample sent emails separated by '---'..."
          value={voiceSampleText}
          onChange={(e) => setVoiceSampleText(e.target.value)}
          style={{ fontSize: '11.5px', marginBottom: '8px' }}
        />
        <button
          className="btn-secondary"
          style={{ width: '100%', fontSize: '11.5px', marginBottom: '6px' }}
          onClick={handleCalibrateVoice}
        >
          Calibrate Stylometric Voice
        </button>
        {voiceProfile && (
          <div style={{ fontSize: '11px', color: 'var(--accent-emerald)', marginTop: '4px' }}>
            ✓ {voiceProfile.toneSummary}
          </div>
        )}
      </div>

      {/* LinkedIn CSV Import */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Users size={14} color="var(--accent-cyan)" /> LinkedIn Connections Export
          </div>
          <span className="badge badge-emerald">{connectionsCount} Cached</span>
        </div>
        <label
          className="btn-secondary"
          style={{ width: '100%', fontSize: '11.5px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
        >
          <Upload size={12} /> Upload Connections.csv
          <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
        </label>
        {csvStatus && (
          <div style={{ fontSize: '11.5px', marginTop: '6px', color: 'var(--text-primary)' }}>
            {csvStatus}
          </div>
        )}
      </div>
    </div>
  );
};
