import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Cpu, Download, FileText, KeyRound, Mic, Plus, ShieldCheck, Trash2, Upload, UserRound, Users } from 'lucide-react';
import { db, ResumeFact, ResumeRecord, UserSettings, VoiceProfile } from '../../db';
import { patchSettings } from '../../db/settings';
import { testGroqConnection } from '../../llm/providers/groq';
import { testGeminiConnection } from '../../llm/providers/gemini';
import { nanoAvailability, prepareNano } from '../../llm/providers/nano';
import { getUsageToday } from '../../llm/usage';
import { calibrateVoiceProfile } from '../../services/voiceFingerprint';
import { importConnectionsToDB, parseLinkedInConnectionsCSV } from '../../services/warmPathMatcher';
import { buildProfile, saveProfile as saveResumeProfile } from '../../services/resumeImport';
import { Callout, Field, Pill } from '../ui';
import { ResumeImport } from './ResumeImport';

interface Props {
  settings: UserSettings;
  resume: ResumeRecord | null;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
}

function Section({ icon, title, meta, children, open }: { icon: React.ReactNode; title: string; meta?: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="card section" open={open}>
      <summary>
        {icon}
        <span className="h2">{title}</span>
        <span className="spacer" />
        {meta}
      </summary>
      <div className="stack section-body">{children}</div>
    </details>
  );
}

export function YouView({ settings, resume, facts, voiceProfile }: Props) {
  const [keys, setKeys] = useState({ groq: settings.groqApiKey, gemini: settings.geminiApiKey, openrouter: settings.openrouterApiKey });
  const [test, setTest] = useState<Record<string, { success: boolean; message: string } | 'running'>>({});
  const [nano, setNano] = useState<string>('checking');
  const [profile, setProfile] = useState(settings);
  const [resumeText, setResumeText] = useState(resume?.rawText || '');
  const [newFact, setNewFact] = useState('');
  const [samples, setSamples] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const usage = useLiveQuery(() => getUsageToday(), []);
  const connectionCount = useLiveQuery(() => db.connections.count(), []) ?? 0;
  const resumeFile = useLiveQuery(() => db.resumeFiles.get('primary'), []);

  useEffect(() => {
    nanoAvailability().then(setNano);
  }, []);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? null : n)), 2500);
  };

  const saveKeys = () =>
    patchSettings({ groqApiKey: keys.groq.trim(), geminiApiKey: keys.gemini.trim(), openrouterApiKey: keys.openrouter.trim() });

  const runTest = async (provider: 'groq' | 'gemini') => {
    await saveKeys();
    setTest((t) => ({ ...t, [provider]: 'running' }));
    const result = provider === 'groq' ? await testGroqConnection(keys.groq) : await testGeminiConnection(keys.gemini);
    setTest((t) => ({ ...t, [provider]: result }));
  };

  const saveResume = async () => {
    if (!resumeText.trim()) return;
    const profile = await buildProfile(resumeText);
    await saveResumeProfile(null, resumeText, profile);
    flash(`Saved. ${profile.facts.length} facts found. Delete any that aren't true or useful.`);
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    const next = Math.max(0, ...facts.map((f) => Number(f.id.replace(/\D/g, '')) || 0)) + 1;
    await db.facts.put({ id: `FACT-${String(next).padStart(2, '0')}`, category: /\d/.test(newFact) ? 'METRIC' : 'PROJECT', claim: newFact.trim(), sourceSnippet: newFact.trim(), verified: true });
    setNewFact('');
  };

  const calibrate = async () => {
    const parts = samples.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    await db.voiceProfiles.put(calibrateVoiceProfile(parts));
    setSamples('');
    flash('Voice saved. Drafts will follow it.');
  };

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const count = await importConnectionsToDB(parseLinkedInConnectionsCSV(await file.text()));
      flash(`Imported ${count} connections. They stay on this computer.`);
    } catch (err: any) {
      flash(err.message);
    }
    e.target.value = '';
  };

  const saveProfile = async () => {
    await patchSettings({
      userFullName: profile.userFullName.trim(),
      userEmail: profile.userEmail.trim(),
      userPhone: profile.userPhone?.trim(),
      preferredLocation: profile.preferredLocation?.trim(),
      userCollege: profile.userCollege.trim(),
      linkedinUrl: profile.linkedinUrl?.trim(),
      githubUrl: profile.githubUrl?.trim(),
      portfolioUrl: profile.portfolioUrl?.trim(),
      dailySendCap: Math.max(1, Math.min(50, Number(profile.dailySendCap) || 15)),
    });
    flash('Profile saved.');
  };

  const exportAll = async () => {
    const dump: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: 'hirivo' };
    for (const table of db.tables) if (table.name !== 'llmCache') dump[table.name] = await table.toArray();
    const settingsRows = dump.settings as UserSettings[];
    dump.settings = settingsRows.map((s) => ({ ...s, groqApiKey: '', geminiApiKey: '', openrouterApiKey: '' }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `hirivo-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteAll = async () => {
    if (!confirm('Delete your resume, connections, outreach history, watchlist and keys from this computer? This cannot be undone.')) return;
    await Promise.all(db.tables.map((t) => t.clear()));
    if (typeof chrome !== 'undefined' && chrome.storage?.local) await chrome.storage.local.clear();
    location.reload();
  };

  const p = (k: keyof UserSettings) => ({
    value: (profile[k] as string | number | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setProfile({ ...profile, [k]: e.target.value }),
  });

  const testLine = (provider: 'groq' | 'gemini') => {
    const t = test[provider];
    if (!t) return null;
    if (t === 'running') return <span className="small muted">Testing…</span>;
    return <Callout tone={t.success ? 'ok' : 'risk'}>{t.message}</Callout>;
  };

  const tokensToday = usage ? Object.values(usage.tokens).reduce((a, b) => a + (b || 0), 0) : 0;

  return (
    <div className="view">
      {note && <Callout tone="ok">{note}</Callout>}

      <Section
        icon={<KeyRound size={16} />}
        title="AI keys"
        open={!settings.groqApiKey && !settings.geminiApiKey}
        meta={settings.groqApiKey || settings.geminiApiKey ? <Pill tone="ok">Connected</Pill> : <Pill tone="caution">Needed</Pill>}
      >
        <p className="small muted">
          Free keys, stored only on this computer. Groq is fastest: sign in at console.groq.com, open API Keys, create one, paste it here.
        </p>
        <Field label="Groq key" hint={<a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free Groq key</a>}>
          <div className="row">
            <input type="password" value={keys.groq} onChange={(e) => setKeys({ ...keys, groq: e.target.value })} placeholder="gsk_…" onBlur={saveKeys} />
            <button className="btn" onClick={() => runTest('groq')} disabled={!keys.groq}>Test</button>
          </div>
        </Field>
        {testLine('groq')}
        <Field label="Gemini key (backup)" hint={<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a free Gemini key</a>}>
          <div className="row">
            <input type="password" value={keys.gemini} onChange={(e) => setKeys({ ...keys, gemini: e.target.value })} placeholder="AIza…" onBlur={saveKeys} />
            <button className="btn" onClick={() => runTest('gemini')} disabled={!keys.gemini}>Test</button>
          </div>
        </Field>
        {testLine('gemini')}
        <Field label="OpenRouter key (optional backup)">
          <input type="password" value={keys.openrouter} onChange={(e) => setKeys({ ...keys, openrouter: e.target.value })} placeholder="sk-or-…" onBlur={saveKeys} />
        </Field>
        <Field label="Try first">
          <select value={settings.activeProvider} onChange={(e) => patchSettings({ activeProvider: e.target.value as UserSettings['activeProvider'] })}>
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </Field>
        <div className="divider" />
        <div className="row between small">
          <span className="row muted"><Cpu size={14} /> On-device AI (Chrome)</span>
          {nano === 'available' ? (
            <Pill tone="ok">Ready</Pill>
          ) : nano === 'downloadable' || nano === 'downloading' ? (
            <button className="btn sm" onClick={async () => setNano(await prepareNano())}>{nano === 'downloading' ? 'Downloading…' : 'Enable'}</button>
          ) : (
            <span className="muted">Not supported here</span>
          )}
        </div>
        {usage && (
          <p className="small muted num">
            Today: {usage.calls.groq ?? 0} Groq calls, {usage.calls.gemini ?? 0} Gemini, {tokensToday.toLocaleString()} tokens, {usage.cacheHits} answered from cache.
          </p>
        )}
      </Section>

      <Section icon={<FileText size={16} />} title="Resume" open={facts.length === 0 && !!(settings.groqApiKey || settings.geminiApiKey)} meta={<Pill tone={facts.length ? 'ok' : 'caution'}>{facts.length} facts</Pill>}>
        <p className="small muted">Each achievement becomes a fact; the writer may only claim what these facts say.</p>
        {resumeFile && <p className="small">Saved file: <b>{resumeFile.name}</b> (attached automatically on application forms)</p>}
        <ResumeImport compact />
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Or paste resume text</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <textarea rows={6} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume text here…" />
            <button className="btn" onClick={saveResume} disabled={!resumeText.trim()}>Save and find facts</button>
          </div>
        </details>
        {facts.length > 0 && (
          <div className="list">
            {facts.map((f) => (
              <div key={f.id} className="list-item">
                <span className="fact">{f.id}</span>
                <span className="grow small">{f.claim}</span>
                <button className="btn icon sm ghost" title="Delete fact" onClick={() => db.facts.delete(f.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Add a fact: Cut API latency 40% with Redis" onKeyDown={(e) => e.key === 'Enter' && addFact()} />
          <button className="btn icon" title="Add fact" onClick={addFact}>
            <Plus size={14} />
          </button>
        </div>
      </Section>

      <Section icon={<Mic size={16} />} title="Your voice" meta={voiceProfile ? <Pill tone="ok">Learned</Pill> : <Pill>Optional</Pill>}>
        <p className="small muted">Paste 2–5 emails you wrote yourself, separated by a line with ---. Drafts copy your sentence length, greeting and sign-off.</p>
        {voiceProfile && <Callout tone="ok">{voiceProfile.toneSummary}</Callout>}
        <textarea rows={4} value={samples} onChange={(e) => setSamples(e.target.value)} placeholder={'Hi Rahul,\n…\n---\nHey team,\n…'} />
        <button className="btn" onClick={calibrate} disabled={!samples.trim()}>Learn my voice</button>
      </Section>

      <Section icon={<UserRound size={16} />} title="Profile" meta={settings.userFullName ? <Pill tone="ok">Saved</Pill> : <Pill>For autofill</Pill>}>
        <p className="small muted">Used to sign emails and to fill Greenhouse, Lever and Ashby forms. Hirivo never presses Submit for you.</p>
        <div className="grid-2">
          <Field label="Full name"><input {...p('userFullName')} /></Field>
          <Field label="Email"><input type="email" {...p('userEmail')} /></Field>
          <Field label="Phone"><input type="tel" {...p('userPhone')} /></Field>
          <Field label="City"><input {...p('preferredLocation')} placeholder="Bengaluru" /></Field>
          <Field label="College"><input {...p('userCollege')} /></Field>
          <Field label="Messages per day"><input type="number" min={1} max={50} {...p('dailySendCap')} /></Field>
          <Field label="LinkedIn URL"><input type="url" {...p('linkedinUrl')} /></Field>
          <Field label="GitHub URL"><input type="url" {...p('githubUrl')} /></Field>
        </div>
        <Field label="Portfolio URL"><input type="url" {...p('portfolioUrl')} /></Field>
        <button className="btn primary" onClick={saveProfile}>Save profile</button>
      </Section>

      <Section icon={<Users size={16} />} title="LinkedIn connections" meta={<Pill tone={connectionCount ? 'ok' : 'neutral'}>{connectionCount}</Pill>}>
        <p className="small muted">
          On LinkedIn: Settings → Data privacy → Get a copy of your data → Connections. LinkedIn emails you a file; upload Connections.csv here. No scraping, and it never leaves this computer.
        </p>
        <label className="btn">
          <Upload size={14} /> Upload Connections.csv
          <input type="file" accept=".csv" onChange={importCsv} hidden />
        </label>
      </Section>

      <Section icon={<ShieldCheck size={16} />} title="Privacy and safety">
        <ul className="checklist">
          <li className="ok"><CheckCircle2 size={14} /><span>Everything is stored in this browser. There is no Hirivo server.</span></li>
          <li className="ok"><CheckCircle2 size={14} /><span>AI requests go straight from your browser to the provider you chose, with your key.</span></li>
          <li className="ok"><CheckCircle2 size={14} /><span>On LinkedIn, Hirivo only reads the job you are viewing, and only when you press Analyze. It never clicks, connects or sends.</span></li>
        </ul>
        <div className="row">
          <button className="btn" onClick={exportAll}><Download size={14} /> Export my data</button>
          <button className="btn danger" onClick={deleteAll}><Trash2 size={14} /> Delete everything</button>
        </div>
      </Section>
    </div>
  );
}
