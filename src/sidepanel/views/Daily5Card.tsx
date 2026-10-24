import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, RefreshCw, Sun, Users } from 'lucide-react';
import { db } from '../../db';
import { buildDaily5, localDayKey } from '../../services/daily5';
import { openUrl } from '../../services/outreach';

/** Today's five: the best open roles that passed the Real and Safety checks. */
export function Daily5Card() {
  const today = useLiveQuery(() => db.daily.get(localDayKey()), []);
  const [busy, setBusy] = useState(false);

  const build = async () => {
    setBusy(true);
    try {
      await buildDaily5();
    } finally {
      setBusy(false);
    }
  };

  const time = today ? new Date(today.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <section className="card stack">
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <Sun size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <div className="h2">{today && today.picks.length > 0 && today.picks.length < 5 ? `Your ${today.picks.length} for today` : 'Your 5 for today'}</div>
        </div>
        {today && (
          <button className="btn sm ghost" onClick={build} disabled={busy} title="Pick again">
            <RefreshCw size={12} className={busy ? 'spin' : ''} /> {time}
          </button>
        )}
      </div>

      {!today ? (
        <div className="row between">
          <p className="small muted">Every morning at 8: the best, freshest, safe roles.</p>
          <button className="btn sm" onClick={build} disabled={busy}>
            {busy ? <RefreshCw className="spin" /> : <Sun />} Pick now
          </button>
        </div>
      ) : today.picks.length === 0 ? (
        <p className="small muted">Nothing passed the checks today. Analyze a few jobs, refresh Discover, or widen your roles.</p>
      ) : (
        <ol className="daily-list">
          {today.picks.map((p) => (
            <li key={p.id}>
              <div className="grow">
                <div className="h2">{p.title}</div>
                <div className="small muted truncate">{[p.company, p.location].filter(Boolean).join(' · ')}</div>
                {p.reasons.length > 0 && (
                  <div className="small" style={{ color: 'var(--ink-2)', marginTop: 2 }}>
                    {p.warm && <Users size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                    {p.reasons.join(' · ')}
                  </div>
                )}
              </div>
              <button className="btn sm" onClick={() => openUrl(p.url)} title="Open the posting">
                <ExternalLink size={12} /> Open
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
