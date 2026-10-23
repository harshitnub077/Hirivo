import React from 'react';
import confetti from 'canvas-confetti';
import { useLiveQuery } from 'dexie-react-hooks';
import { setJobStatus } from '../../services/discover';
import { Inbox, Mail, MessageSquare } from 'lucide-react';
import { db, OutreachRecord, UserSettings } from '../../db';
import { todayKey } from '../../db/settings';
import {
  FOLLOWUP_DAYS,
  dueFollowupStage,
  followupText,
  gmailComposeUrl,
  markFollowupSent,
  openUrl,
  setOutreachStatus,
} from '../../services/outreach';
import { Empty, Meter, Pill, timeAgo, useCopy } from '../ui';

export function PipelineView({ outreach, settings }: { outreach: OutreachRecord[]; settings: UserSettings }) {
  const [copied, copy] = useCopy();
  const applications = useLiveQuery(() => db.discovered.where('status').anyOf('applying', 'applied').toArray(), []) ?? [];
  const used = settings.lastSendDate === todayKey() ? settings.todaySendCount : 0;
  const cap = settings.dailySendCap || 15;
  const replied = outreach.filter((r) => r.status === 'REPLIED').length;
  const due = outreach.filter((r) => dueFollowupStage(r) > 0);
  const rest = outreach.filter((r) => dueFollowupStage(r) === 0);

  const sendFollowup = async (r: OutreachRecord) => {
    const stage = dueFollowupStage(r);
    if (stage === 0) return;
    const { subject, body } = followupText(r, stage, settings.userFullName);
    if (r.channel === 'linkedin' || !r.recipientEmail) copy(r.id, body.split('\n\n---\n')[0]);
    else await openUrl(gmailComposeUrl(r.recipientEmail, subject, body));
    await markFollowupSent(r, stage);
  };

  const gotReply = async (r: OutreachRecord) => {
    const first = (await db.outreach.where('status').equals('REPLIED').count()) === 0;
    await setOutreachStatus(r, 'REPLIED');
    if (first) confetti({ particleCount: 70, spread: 70, origin: { y: 0.7 }, colors: ['#0F7A55', '#3FD69B', '#FAFAF7'] });
  };

  const row = (r: OutreachRecord) => {
    const stage = dueFollowupStage(r);
    const done = r.followupsDone ?? 0;
    const closed = r.status === 'REPLIED' || r.status === 'CLOSED';
    return (
      <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {r.channel === 'linkedin' ? <MessageSquare size={15} className="muted" /> : <Mail size={15} className="muted" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h2 truncate">
              {r.recipientName} <span className="muted" style={{ fontWeight: 400 }}>· {r.companyName}</span>
            </div>
            <div className="small muted truncate">
              {r.jobTitle} · sent {timeAgo(r.createdAt)}
            </div>
          </div>
          {r.status === 'REPLIED' ? <Pill tone="ok">Replied</Pill> : r.status === 'CLOSED' ? <Pill>Closed</Pill> : stage > 0 ? <Pill tone="caution">Follow up</Pill> : null}
        </div>
        {!closed && (
          <div className="timeline">
            <span className="done">Sent</span>
            <span className={done >= 1 ? 'done' : stage === 1 ? 'due' : ''}>Day {FOLLOWUP_DAYS[0]}</span>
            <span className={done >= 2 ? 'done' : stage === 2 ? 'due' : ''}>Day {FOLLOWUP_DAYS[1]}</span>
          </div>
        )}
        {!closed && (
          <div className="row" style={{ gap: 6 }}>
            {stage > 0 && (
              <button className="btn sm primary" onClick={() => sendFollowup(r)}>
                {copied === r.id ? 'Copied' : r.channel === 'linkedin' ? 'Copy follow-up' : 'Open follow-up'}
              </button>
            )}
            <button className="btn sm" onClick={() => gotReply(r)}>Got a reply</button>
            <button className="btn sm ghost" onClick={() => setOutreachStatus(r, 'CLOSED')}>Close</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="view">
      <section className="card">
        <div className="grid-2">
          <div>
            <div className="eyebrow">Today</div>
            <div className="score num" style={{ fontSize: 22, marginTop: 4 }}>
              {used}
              <span className="muted" style={{ fontSize: 14 }}>/{cap}</span>
            </div>
          </div>
          <div>
            <div className="eyebrow">Reply rate</div>
            <div className="score num" style={{ fontSize: 22, marginTop: 4 }}>
              {outreach.length ? Math.round((replied / outreach.length) * 100) : 0}%
              <span className="muted" style={{ fontSize: 14 }}> of {outreach.length}</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Meter value={(used / cap) * 100} tone={used >= cap ? 'risk' : 'ok'} label="Messages sent today" />
        </div>
      </section>

      {applications.length > 0 && (
        <section className="card">
          <div className="h2" style={{ marginBottom: 8 }}>Applications ({applications.length})</div>
          <div className="list">
            {applications
              .sort((a, b) => (b.appliedAt || b.firstSeenAt) - (a.appliedAt || a.firstSeenAt))
              .map((j) => (
                <div key={j.id} className="list-item">
                  <div className="grow">
                    <div className="h2 truncate">{j.title}</div>
                    <div className="small muted truncate">
                      {j.company} · {j.status === 'applied' ? `applied ${timeAgo(j.appliedAt || j.firstSeenAt)}` : 'opened, not submitted yet'}
                    </div>
                  </div>
                  {j.status === 'applied' ? (
                    <Pill tone="ok">Applied</Pill>
                  ) : (
                    <button className="btn sm" onClick={() => setJobStatus(j.id, 'applied')}>
                      Submitted
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      {outreach.length === 0 ? (
        <Empty icon={<Inbox size={30} />} title="Nothing sent yet">
          When you open an email in Gmail or log a LinkedIn note from Now → Write, it shows up here with day {FOLLOWUP_DAYS[0]} and day {FOLLOWUP_DAYS[1]} follow-ups.
        </Empty>
      ) : (
        <>
          {due.length > 0 && (
            <section className="card">
              <div className="h2" style={{ marginBottom: 8 }}>Follow up today ({due.length})</div>
              <div className="list">{due.map(row)}</div>
            </section>
          )}
          {rest.length > 0 && (
            <section className="card">
              <div className="h2" style={{ marginBottom: 8 }}>All outreach</div>
              <div className="list">{rest.map(row)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
