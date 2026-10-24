import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { useLiveQuery } from 'dexie-react-hooks';
import { setJobStatus } from '../../services/discover';
import { Check, Copy, GraduationCap, Inbox, Mail, MessageSquare, RefreshCw } from 'lucide-react';
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
import { Callout, Empty, Meter, Pill, timeAgo, useCopy } from '../ui';
import { packAsText, prepareInterviewPack } from '../../services/interviewPack';
import { hasSiteAccess } from '../../services/siteAccess';
import { draftFollowupInThread, draftOpenUrl, pollGmailReplies } from '../../services/gmail';
import { AutopilotQueue } from './AutopilotViews';

export function PipelineView({ outreach, settings }: { outreach: OutreachRecord[]; settings: UserSettings }) {
  const [copied, copy] = useCopy();
  const [preparing, setPreparing] = useState<Set<string>>(new Set());
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const facts = useLiveQuery(() => db.facts.toArray(), []) ?? [];
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
    const note = body.split('\n\n---\n')[0];
    if (r.channel === 'linkedin' || !r.recipientEmail) copy(r.id, note);
    else if (settings.gmail && !settings.gmail.needsReconnect && r.gmailThreadId) {
      try {
        // In the same thread, so the recipient sees it under the original email.
        const d = await draftFollowupInThread(r, note);
        await openUrl(draftOpenUrl(settings.gmail.email, d.messageId));
      } catch {
        await openUrl(gmailComposeUrl(r.recipientEmail, subject, body));
      }
    } else await openUrl(gmailComposeUrl(r.recipientEmail, subject, body));
    await markFollowupSent(r, stage);
  };

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const checkNow = async () => {
    setChecking(true);
    try {
      const found = await pollGmailReplies();
      setCheckMsg(found.length ? `${found.length} new repl${found.length > 1 ? 'ies' : 'y'}` : 'No new replies');
    } catch {
      setCheckMsg('Check failed');
    } finally {
      setChecking(false);
    }
  };

  const preparePack = async (r: OutreachRecord) => {
    setPreparing((p) => new Set(p).add(r.id));
    setPackError(null);
    try {
      const job = await db.jobs.get(r.jobId);
      const siteAllowed = job?.companyDomain ? await hasSiteAccess(job.companyDomain) : false;
      await prepareInterviewPack(r, { siteAllowed });
      setOpenPack(r.id);
    } catch (err: any) {
      setPackError(err.message);
    } finally {
      setPreparing((p) => {
        const next = new Set(p);
        next.delete(r.id);
        return next;
      });
    }
  };

  const gotReply = async (r: OutreachRecord) => {
    const first = (await db.outreach.where('status').equals('REPLIED').count()) === 0;
    await setOutreachStatus(r, 'REPLIED');
    if (first) confetti({ particleCount: 70, spread: 70, origin: { y: 0.7 }, colors: ['#3FD69B', '#4BC994', '#E6ECE8'] });
    await preparePack({ ...r, status: 'REPLIED' });
  };

  const packView = (r: OutreachRecord) => {
    const pack = r.interviewPack;
    const busy = preparing.has(r.id);
    if (!pack) {
      return (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => preparePack(r)} disabled={busy}>
          {busy ? <RefreshCw size={12} className="spin" /> : <GraduationCap size={12} />} {busy ? 'Preparing your interview pack…' : 'Prepare interview pack'}
        </button>
      );
    }
    const isOpen = openPack === r.id;
    const claim = (id: string) => facts.find((f) => f.id === id)?.claim;
    return (
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setOpenPack(isOpen ? null : r.id)} aria-expanded={isOpen}>
            <GraduationCap size={12} /> {isOpen ? 'Hide interview pack' : 'Interview pack'}
          </button>
          {isOpen && (
            <>
              <button className="btn sm ghost" onClick={() => copy(`pack:${r.id}`, packAsText(pack, facts, r.companyName, r.jobTitle))}>
                {copied === `pack:${r.id}` ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
              <button className="btn sm ghost" onClick={() => preparePack(r)} disabled={busy} title="Prepare again">
                <RefreshCw size={12} className={busy ? 'spin' : ''} />
              </button>
            </>
          )}
        </div>
        {isOpen && (
          <div className="pack fade-in">
            <div>
              <div className="section-title">What they do</div>
              <p className="small">{pack.companyBrief || 'No description found on their homepage. Read it before the call.'}</p>
              {pack.sources.length > 0 && (
                <p className="small muted" style={{ marginTop: 4 }}>
                  Sources:{' '}
                  {pack.sources.map((src, i) => (
                    <span key={src.url}>
                      <a href={src.url} onClick={(e) => (e.preventDefault(), openUrl(src.url))}>
                        {src.title}
                      </a>
                      {i < pack.sources.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div>
              <div className="section-title">Likely questions</div>
              <ol>
                {pack.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className="section-title">Your strongest proof</div>
              <ul>
                {pack.strongestFacts.map((id) => (
                  <li key={id}>
                    {claim(id) || 'This fact is no longer in your resume.'} <span className="fact">{id}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="section-title">Ask them</div>
              <ul>
                {pack.askThem.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
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
        {r.status === 'REPLIED' && packView(r)}
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
      <section className="card stack">
        <div className="row between">
          <div className="h1">Pipeline</div>
          <span className="small muted num">
            {outreach.length ? `${Math.round((replied / outreach.length) * 100)}% replied (${replied} of ${outreach.length})` : 'No messages yet'}
          </span>
        </div>
        <div>
          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Sent today</span>
            <span className="num">
              {used} of {cap}
            </span>
          </div>
          <Meter value={(used / cap) * 100} tone={used >= cap ? 'risk' : 'ok'} label="Messages sent today" />
        </div>
      </section>

      <AutopilotQueue />

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

      {settings.gmail && (
        <div className="row between small" style={{ padding: '0 2px' }}>
          <span className={settings.gmail.needsReconnect ? '' : 'muted'} style={settings.gmail.needsReconnect ? { color: 'var(--caution)' } : undefined}>
            {settings.gmail.needsReconnect ? 'Gmail needs reconnecting (You → Gmail)' : `Watching replies in ${settings.gmail.email}`}
          </span>
          {!settings.gmail.needsReconnect && (
            <button className="btn sm ghost" onClick={checkNow} disabled={checking}>
              <RefreshCw size={12} className={checking ? 'spin' : ''} /> {checking ? 'Checking…' : checkMsg || 'Check now'}
            </button>
          )}
        </div>
      )}

      {packError && <Callout tone="caution">Couldn't prepare the interview pack: {packError}</Callout>}

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
