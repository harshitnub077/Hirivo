import React, { useState } from 'react';
import {
  Inbox,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  PartyPopper,
  ShieldCheck,
  Send,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { OutreachRecord, UserSettings } from '../../db';
import { checkThreadReplies } from '../../services/gmailService';

interface TrackerTabProps {
  outreachList: OutreachRecord[];
  settings: UserSettings | null;
  onUpdateOutreach: (record: OutreachRecord) => void;
}

export const TrackerTab: React.FC<TrackerTabProps> = ({
  outreachList,
  settings,
  onUpdateOutreach,
}) => {
  const [checkingReplies, setCheckingReplies] = useState(false);

  const todayCount = settings?.todaySendCount || 0;
  const dailyCap = settings?.dailySendCap || 15;
  const capPercent = Math.min(100, Math.round((todayCount / dailyCap) * 100));

  const handleCheckReplies = async () => {
    setCheckingReplies(true);
    let repliesFound = 0;

    for (const item of outreachList) {
      if (item.gmailThreadId && item.status !== 'REPLIED' && item.recipientEmail) {
        try {
          const replied = await checkThreadReplies(item.gmailThreadId, item.recipientEmail);
          if (replied) {
            repliesFound++;
            const updated: OutreachRecord = {
              ...item,
              status: 'REPLIED',
              repliedAt: Date.now(),
            };
            onUpdateOutreach(updated);
          }
        } catch (err) {
          console.warn('Reply check error for thread:', item.gmailThreadId, err);
        }
      }
    }

    if (repliesFound > 0) {
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.6 },
      });
      alert(`🎉 Congratulations! ${repliesFound} new reply detected! Follow-ups have been automatically halted.`);
    }

    setCheckingReplies(false);
  };

  return (
    <div>
      {/* Daily Send Cap & Email Deliverability Guard */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            DAILY SEND CAP & REPUTATION SHIELD
          </span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: todayCount >= dailyCap ? 'var(--accent-rose)' : 'var(--accent-cyan)' }}>
            {todayCount} / {dailyCap} Drafted
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%', height: '6px', background: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
          <div
            style={{
              width: `${capPercent}%`,
              height: '100%',
              background: todayCount >= dailyCap ? 'var(--accent-rose)' : 'linear-gradient(90deg, #38bdf8, #10b981)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Capped at {dailyCap}/day to preserve your email domain reputation and prevent spam filters.
        </div>
      </div>

      {/* Pipeline Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Outreach Pipeline ({outreachList.length})
        </h3>
        <button
          className="btn-secondary"
          style={{ fontSize: '11px', padding: '5px 8px' }}
          onClick={handleCheckReplies}
          disabled={checkingReplies}
        >
          <RefreshCw size={11} className={checkingReplies ? 'spin' : ''} />
          {checkingReplies ? 'Checking Replies...' : 'Check Gmail Replies'}
        </button>
      </div>

      {/* Outreach List */}
      {outreachList.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {outreachList.map((item) => {
            const daysSince = Math.floor((Date.now() - item.createdAt) / (1000 * 60 * 60 * 24));
            const isReplied = item.status === 'REPLIED';

            return (
              <div
                key={item.id}
                className="card"
                style={{
                  margin: 0,
                  borderLeft: isReplied ? '3px solid var(--accent-emerald)' : '3px solid var(--accent-cyan)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
                      {item.recipientName} ({item.companyName})
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {item.jobTitle} • {item.recipientEmail}
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      isReplied ? 'badge-emerald' : item.status === 'SENT' ? 'badge-cyan' : 'badge-amber'
                    }`}
                  >
                    {isReplied ? '🎉 REPLIED' : item.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Cadence Timeline */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '10.5px',
                    color: 'var(--text-muted)',
                    marginTop: '8px',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)' }}>Day 0: Draft Created</span>
                  <span>→</span>
                  <span style={{ color: daysSince >= 4 && !isReplied ? 'var(--accent-amber)' : 'inherit' }}>
                    Day 4 Follow-up {daysSince >= 4 ? '(Due)' : ''}
                  </span>
                  <span>→</span>
                  <span style={{ color: daysSince >= 9 && !isReplied ? 'var(--accent-rose)' : 'inherit' }}>
                    Day 9 Final {daysSince >= 9 ? '(Due)' : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-secondary)' }}>
          <Inbox size={28} color="var(--text-muted)" style={{ margin: '0 auto 8px' }} />
          <div style={{ fontSize: '12.5px', fontWeight: 600, marginBottom: '4px' }}>No Outreach Sent Yet</div>
          <p style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            When you create drafts in the Proof Writer tab, they will appear here with automated Day 4 and Day 9 follow-up tracking.
          </p>
        </div>
      )}
    </div>
  );
};
