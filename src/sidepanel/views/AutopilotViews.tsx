import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, CheckCircle2, Circle, ExternalLink, Play, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { db, type AutopilotJob, type UserSettings } from '../../db';
import { patchSettings } from '../../db/settings';
import { allowAnySite, canReadAnySite, handToAutopilot, startAutopilot } from '../../services/autopilot/client';
import { AUTO_DEFAULTS, pickAutoMatches } from '../../services/autopilot/auto';
import { gmailConnected } from '../../services/gmail';
import { openUrl } from '../../services/outreach';
import { Callout, Pill, timeAgo } from '../ui';

const DEFAULTS = { enabled: false, sendEmails: true, submitForms: true, peoplePerCompany: 3, linkedinNotes: true, autoApply: false, minScore: AUTO_DEFAULTS.minScore };

/** You → Autopilot: what it does, what it needs, and its switches. */
export function AutopilotSettings({ settings }: { settings: UserSettings }) {
  const ap = { ...DEFAULTS, ...settings.autopilot };
  const [anySite, setAnySite] = useState(false);
  const gmail = useLiveQuery(() => gmailConnected(), [settings.gmail?.email, settings.gmail?.needsReconnect]);
  const facts = useLiveQuery(() => db.facts.count(), []) ?? 0;
  useEffect(() => {
    canReadAnySite().then(setAnySite);
  }, []);
  const set = (patch: Partial<typeof ap>) => patchSettings({ autopilot: { ...ap, ...patch } });
  const hasKey = Boolean(settings.groqApiKey || settings.geminiApiKey || settings.openrouterApiKey);
  const answers = Boolean(settings.noticePeriod || settings.authorizedCountries);
  const steps = [
    { done: facts > 0, label: 'Resume uploaded' },
    { done: hasKey, label: 'AI key added' },
    { done: anySite, label: 'Allowed to read company websites (to find the people there)', optional: true, action: !anySite && (
      <button className="btn sm" onClick={async () => setAnySite(await allowAnySite())}>Allow</button>
    ) },
    { done: Boolean(gmail), label: 'Gmail connected (for sending emails)', optional: true },
    { done: answers, label: 'Application answers saved (notice period, countries…)', optional: true },
  ];
  const ready = steps.filter((s) => !s.optional).every((s) => s.done);

  return (
    <div className="stack">
      <p className="small muted">
        Hand Autopilot any jobs you choose. For each one it reads the posting, checks the job is real and safe, finds the company's website and the people there, emails
        each person with a verified address from your Gmail, then fills the application and submits it. It stops and tells you only when a form needs your consent tick or a
        CAPTCHA. LinkedIn is never automated.
      </p>
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'ok' : 'neutral'}>
            {s.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            <span className="grow">
              {s.label}
              {s.optional && !s.done ? <span className="muted"> · recommended</span> : null}
            </span>
            {s.action}
          </li>
        ))}
      </ul>
      <label className="row small">
        <input type="checkbox" checked={ap.enabled} disabled={!ready && !ap.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <b>Autopilot on</b>
      </label>
      <label className="row small">
        <input type="checkbox" checked={ap.sendEmails} onChange={(e) => set({ sendEmails: e.target.checked })} />
        Send emails automatically (verified addresses only: listed on their site, your LinkedIn export, their hiring inbox, or the company's email format proven by real addresses; your resume attached)
      </label>
      <label className="row small">
        <input type="checkbox" checked={ap.linkedinNotes} onChange={(e) => set({ linkedinNotes: e.target.checked })} />
        Prepare LinkedIn notes for founders, HR and the hiring manager (you press Send on LinkedIn)
      </label>
      <label className="row small">
        <input type="checkbox" checked={ap.submitForms} onChange={(e) => set({ submitForms: e.target.checked })} />
        Submit applications when every required question is answered
      </label>
      <label className="row small">
        People to email per company
        <select value={ap.peoplePerCompany} onChange={(e) => set({ peoplePerCompany: Number(e.target.value) })} style={{ width: 70 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <AutoApply settings={settings} ap={ap} set={set} />
      <p className="small muted">
        Emails count against your daily limit in You → Profile (Gmail's own limit for personal accounts is about 500 a day). Follow-ups on day 4 and day 9 go out in the same
        thread and stop when someone replies.
      </p>
    </div>
  );
}

/** "Apply automatically to new matches": each search hands its best new jobs to Autopilot. */
function AutoApply({ settings, ap, set }: { settings: UserSettings; ap: typeof DEFAULTS & UserSettings['autopilot']; set: (p: Partial<typeof DEFAULTS>) => void }) {
  const matches = useLiveQuery(async () => pickAutoMatches(await db.discovered.where('status').equals('new').toArray(), await db.autopilot.toArray(), { autopilot: { ...ap, enabled: true, autoApply: true } }), [ap.minScore, ap.dailyLimit]) ?? [];
  const [handed, setHanded] = useState<number | null>(null);
  const handOverNow = async () => {
    setHanded(await handToAutopilot(matches.map((j) => ({ url: j.url, title: j.title, company: j.company }))));
    await startAutopilot();
  };
  return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <label className="row small">
        <input type="checkbox" checked={!!ap.autoApply} disabled={!ap.enabled} onChange={(e) => set({ autoApply: e.target.checked })} />
        <b>Apply automatically to new matches</b>
      </label>
      <p className="small muted">
        After each search (every 2 hours), new jobs at or above the score go to Autopilot by themselves, best first, at most {AUTO_DEFAULTS.perCompanyPerWeek} roles per company a week. On LinkedIn,
        Naukri, Indeed and Internshala jobs, Hirivo applies on the company's own board when the same job is there; otherwise it emails and prepares notes, and leaves the portal's Apply button to you.
      </p>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="row small">
          Lowest match score
          <select value={ap.minScore ?? AUTO_DEFAULTS.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} style={{ width: 70 }}>
            {[40, 50, 60, 70, 80, 90].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="row small">
          Most per day
          <input
            type="number"
            min={1}
            max={200}
            style={{ width: 70 }}
            placeholder="No limit"
            defaultValue={settings.autopilot?.dailyLimit || ''}
            onBlur={(e) => set({ dailyLimit: Number(e.target.value) || undefined } as Partial<typeof DEFAULTS>)}
          />
        </label>
      </div>
      {ap.enabled && matches.length > 0 && (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={handOverNow}>
          <Play size={12} /> Hand over {matches.length} current {matches.length === 1 ? 'match' : 'matches'} now
        </button>
      )}
      {handed !== null && <span className="small muted">{handed ? `Autopilot took ${handed}. Follow it in Pipeline.` : 'Those jobs are already with Autopilot.'}</span>}
    </div>
  );
}

const TONE = { queued: 'neutral', working: 'neutral', 'needs-you': 'caution', done: 'ok', skipped: 'neutral', failed: 'risk' } as const;
const LABEL = { queued: 'Queued', working: 'Working', 'needs-you': 'Needs you', done: 'Done', skipped: 'Skipped', failed: 'Failed' } as const;

/** Pipeline → Autopilot: every handed-over job, what it's doing, and its full log. */
export function AutopilotQueue() {
  const jobs = useLiveQuery(() => db.autopilot.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!jobs.length) return null;
  const count = (s: AutopilotJob['status']) => jobs.filter((j) => j.status === s).length;

  const show = async (j: AutopilotJob) => {
    if (j.tabId !== undefined) {
      const tab = await chrome.tabs.update(j.tabId, { active: true }).catch(() => undefined);
      if (tab) return;
    }
    await openUrl(j.url);
  };

  return (
    <section className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="h2 row" style={{ gap: 6 }}>
          <Bot size={15} /> Autopilot
        </div>
        <span className="small muted">
          {[count('working') + count('queued') ? `${count('working') + count('queued')} in progress` : '', count('needs-you') ? `${count('needs-you')} need you` : '', count('done') ? `${count('done')} done` : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="list">
        {jobs.map((j) => (
          <div key={j.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="h2 truncate">
                  {j.company || 'Company'} <span className="muted" style={{ fontWeight: 400 }}>· {j.title}</span>
                </div>
                <div className="small muted">
                  {j.status === 'working' && j.stage ? `${j.stage}…` : j.needs || j.steps[j.steps.length - 1]?.text}
                  {j.emailed.length ? ` · emailed ${j.emailed.length}` : ''} · {timeAgo(j.updatedAt)}
                </div>
              </div>
              <Pill tone={TONE[j.status]}>
                {j.status === 'working' && <RefreshCw size={11} className="spin" />} {LABEL[j.status]}
              </Pill>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {j.status === 'needs-you' && (
                <button className="btn sm primary" onClick={() => show(j)}>
                  <ExternalLink size={12} /> Open the form
                </button>
              )}
              {(j.status === 'skipped' || j.status === 'failed') && (
                <button className="btn sm" onClick={() => handToAutopilot([{ url: j.url, title: j.title, company: j.company }], { force: j.status === 'skipped' })}>
                  {j.status === 'skipped' ? <Play size={12} /> : <RotateCcw size={12} />} {j.status === 'skipped' ? 'Run anyway' : 'Try again'}
                </button>
              )}
              <button className="btn sm ghost" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                {open === j.id ? 'Hide log' : 'Log'}
              </button>
              {j.status !== 'working' && (
                <button className="btn sm icon ghost" title="Remove from Autopilot" onClick={() => db.autopilot.delete(j.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {open === j.id && (
              <ul className="checklist fade-in">
                {j.steps.map((s, i) => (
                  <li key={i} className={s.tone}>
                    <span className="grow">{s.text}</span>
                    <span className="small muted">{new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Hand to Autopilot", with a short confirmation and a hint when Autopilot is off. */
export function AutopilotButton({
  jobs,
  settings,
  label = 'Autopilot',
  className = 'btn sm',
  compact = false,
}: {
  jobs: { url: string; title: string; company: string }[];
  settings: UserSettings;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<string | null>(null);
  const on = Boolean(settings.autopilot?.enabled);
  return (
    <>
      <button
        className={className}
        disabled={!jobs.length}
        title={on ? 'Research, email the right people and apply, automatically' : 'Turn Autopilot on in You → Autopilot'}
        onClick={async () => {
          if (!on) return setState('Turn Autopilot on in You → Autopilot first.');
          const n = await handToAutopilot(jobs);
          setState(n ? `Autopilot has ${n === 1 ? 'it' : `${n} jobs`}. Follow along in Pipeline.` : 'Already with Autopilot.');
        }}
      >
        <Bot size={12} /> {compact && state ? (on ? 'With Autopilot' : 'Turn on in You') : label}
      </button>
      {state && !compact && <Callout tone={on ? 'ok' : 'caution'}>{state}</Callout>}
    </>
  );
}
