import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, ExternalLink, UserPlus } from 'lucide-react';
import { db, type LinkedInTask } from '../../db';
import { FREE_NOTES_PER_MONTH, notesSentThisMonth } from '../../services/people';
import { NOTE_LIMIT } from '../../services/people/linkedinNote';
import { openUrl } from '../../services/outreach';
import { Callout, Pill, timeAgo } from '../ui';

/** Pipeline → LinkedIn: notes Hirivo wrote. Copy, open the profile, press Connect → Add a note → Send. */
export function LinkedInTasks() {
  const tasks = useLiveQuery(() => db.linkedinTasks.where('status').equals('todo').reverse().sortBy('createdAt'), []) ?? [];
  const sent = useLiveQuery(() => notesSentThisMonth(), [tasks.length]) ?? 0;
  const [copied, setCopied] = useState<string | null>(null);
  if (!tasks.length) return null;

  const openAndCopy = async (t: LinkedInTask) => {
    await navigator.clipboard.writeText(t.note).catch(() => undefined);
    setCopied(t.id);
    await openUrl(t.profileUrl);
  };
  const done = (t: LinkedInTask, status: LinkedInTask['status']) => db.linkedinTasks.update(t.id, { status, doneAt: Date.now() });

  return (
    <section className="card stack">
      <div className="row between">
        <div className="h2 row" style={{ gap: 6 }}>
          <UserPlus size={15} /> LinkedIn notes to send ({tasks.length})
        </div>
        <span className="small muted num">{sent} sent this month</span>
      </div>
      <p className="small muted">Hirivo never acts on LinkedIn. Press Copy &amp; open, then Connect → Add a note → paste → Send, and mark it sent here.</p>
      {sent >= FREE_NOTES_PER_MONTH && (
        <Callout tone="caution">LinkedIn's free plan allows about {FREE_NOTES_PER_MONTH} personal notes a month. If it stops you, connect without a note and send the message once they accept.</Callout>
      )}
      <div className="list">
        {tasks.map((t) => (
          <div key={t.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="h2 truncate">
                  {t.name} <span className="muted" style={{ fontWeight: 400 }}>· {t.company}</span>
                </div>
                <div className="small muted truncate">
                  {t.role || t.audience} · for {t.jobTitle} · {timeAgo(t.createdAt)}
                </div>
              </div>
              {t.autopilot && <Pill>Autopilot</Pill>}
            </div>
            <textarea
              rows={3}
              defaultValue={t.note}
              maxLength={NOTE_LIMIT}
              aria-label={`Note to ${t.name}`}
              onBlur={(e) => e.target.value !== t.note && db.linkedinTasks.update(t.id, { note: e.target.value })}
            />
            <div className="row between">
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => openAndCopy(t)}>
                  {copied === t.id ? <Check size={12} /> : <Copy size={12} />} {copied === t.id ? 'Copied, opened' : 'Copy & open'}
                </button>
                <button className="btn sm" onClick={() => done(t, 'sent')}>
                  Sent
                </button>
                <button className="btn sm ghost" onClick={() => done(t, 'skipped')}>
                  Skip
                </button>
              </div>
              <button className="btn icon sm ghost" title="Open profile" onClick={() => openUrl(t.profileUrl)}>
                <ExternalLink size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
