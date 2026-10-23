import React, { useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, ExternalLink, Plus, Radar, RefreshCw, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { UserSettings, WatchlistCompany } from '../../db';
import { patchSettings } from '../../db/settings';
import { daysSince } from '../../services/atsFeeds';
import {
  SEED_COMPANIES,
  SEEDS_VERIFIED_AT,
  addCompany,
  companyId,
  hiringPulse,
  markSeen,
  matchesTargets,
  refreshAll,
  removeCompany,
} from '../../services/watchlist';
import { openUrl } from '../../services/outreach';
import { Callout, Empty, Field, Pill, Segmented, timeAgo } from '../ui';

type Region = 'India' | 'Remote' | 'Global';

const regionOf = (r: string): Region => (r.startsWith('India') ? 'India' : r === 'Remote' ? 'Remote' : 'Global');

export function RadarView({ watchlist, settings }: { watchlist: WatchlistCompany[]; settings: UserSettings }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>('India');
  const [targets, setTargets] = useState((settings.targetRoles || []).join(', '));

  const watched = new Set(watchlist.map((c) => c.id));
  const suggestions = SEED_COMPANIES.filter((s) => regionOf(s.region) === region && !watched.has(companyId(s)));
  const sorted = useMemo(
    () => [...watchlist].sort((a, b) => b.newRoleIds.length - a.newRoleIds.length || a.name.localeCompare(b.name)),
    [watchlist]
  );
  const lastChecked = Math.max(0, ...watchlist.map((c) => c.lastCheckedAt || 0));

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveTargets = () =>
    patchSettings({
      targetRoles: targets
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });

  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="h1">Radar</div>
            <div className="small muted">
              {watchlist.length ? `${watchlist.length} companies · checked ${lastChecked ? timeAgo(lastChecked) : 'never'}` : 'Follow companies; hear about new roles first.'}
            </div>
          </div>
          {watchlist.length > 0 && (
            <button className="btn sm" onClick={() => run('all', refreshAll)} disabled={busy !== null}>
              <RefreshCw size={12} className={busy === 'all' ? 'spin' : ''} /> Check now
            </button>
          )}
        </div>
        <div className="stack">
          <Field label="Roles you want" hint="Comma separated. Alerts and highlights only match these words in the job title.">
            <input value={targets} onChange={(e) => setTargets(e.target.value)} onBlur={saveTargets} placeholder="frontend, backend, sde, data analyst" />
          </Field>
          <label className="row small">
            <input type="checkbox" checked={settings.earlyBirdAlerts !== false} onChange={(e) => patchSettings({ earlyBirdAlerts: e.target.checked })} />
            <Bell size={13} /> Notify me when a matching role is posted (checks every 6 hours)
          </label>
        </div>
      </section>

      <section className="card">
        <div className="h2" style={{ marginBottom: 8 }}>Add a company</div>
        <div className="row">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="jobs.lever.co/cred or a Greenhouse/Ashby link" onKeyDown={(e) => e.key === 'Enter' && link && run('add', async () => (await addCompany(link), setLink('')))} />
          <button className="btn" onClick={() => run('add', async () => (await addCompany(link), setLink('')))} disabled={!link || busy !== null}>
            {busy === 'add' ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
          </button>
        </div>
        {error && <div style={{ marginTop: 8 }}><Callout tone="caution">{error}</Callout></div>}

        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="small muted">Suggestions, boards checked live on {SEEDS_VERIFIED_AT}</span>
        </div>
        <Segmented<Region>
          label="Region"
          value={region}
          onChange={setRegion}
          options={[
            { value: 'India', label: 'India' },
            { value: 'Remote', label: 'Remote' },
            { value: 'Global', label: 'Global' },
          ]}
        />
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {suggestions.length === 0 && <span className="small muted">You're following all of these.</span>}
          {suggestions.map((s) => (
            <button key={companyId(s)} className="btn sm" onClick={() => run(companyId(s), () => addCompany(s))} disabled={busy !== null}>
              {busy === companyId(s) ? <RefreshCw size={12} className="spin" /> : <Plus size={12} />} {s.name}
            </button>
          ))}
        </div>
      </section>

      {watchlist.length === 0 ? (
        <Empty icon={<Radar size={30} />} title="No companies yet">
          Add companies you'd love to work at. Hirivo reads their own hiring boards, so every role you see here is real and open.
        </Empty>
      ) : (
        <section className="card">
          <div className="list">
            {sorted.map((c) => {
              const relevant = c.roles.filter((r) => matchesTargets(r.title, settings.targetRoles));
              const isOpen = open === c.id;
              const pulse = hiringPulse(c);
              return (
                <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div className="row">
                    <button
                      className="btn ghost sm"
                      style={{ flex: 1, justifyContent: 'flex-start', padding: 0, height: 'auto' }}
                      onClick={() => {
                        setOpen(isOpen ? null : c.id);
                        if (!isOpen && c.newRoleIds.length) markSeen(c.id);
                      }}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="h2">{c.name}</span>
                    </button>
                    {c.newRoleIds.length > 0 && <Pill tone="ok">{c.newRoleIds.length} new</Pill>}
                    {pulse?.trend === 'growing' && <TrendingUp size={14} color="var(--brand)" aria-label="Hiring more this month" />}
                    {pulse?.trend === 'shrinking' && <TrendingDown size={14} color="var(--caution)" aria-label="Fewer open roles this month" />}
                    <span className="small muted num">
                      {c.status === 'ok' ? `${relevant.length}${settings.targetRoles?.length ? `/${c.roles.length}` : ''} roles` : c.status === 'not_found' ? 'board not found' : c.status === 'error' ? 'check failed' : '…'}
                    </span>
                  </div>
                  {isOpen && (
                    <div className="stack fade-in" style={{ marginTop: 8, paddingLeft: 20 }}>
                      {pulse && (
                        <span className="small muted">
                          {pulse.trend === 'growing' ? 'Hiring more' : pulse.trend === 'shrinking' ? 'Fewer open roles' : 'Steady'} over the last month ({pulse.delta >= 0 ? '+' : ''}
                          {pulse.delta} roles)
                        </span>
                      )}
                      {relevant.length === 0 && <span className="small muted">No open roles match your keywords.</span>}
                      {relevant.slice(0, 25).map((r) => {
                        const age = daysSince(r.publishedAt);
                        return (
                          <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="small" style={{ fontWeight: 500 }}>
                                {c.newRoleIds.includes(r.id) && <span className="fact" style={{ marginRight: 6 }}>NEW</span>}
                                {r.title}
                              </div>
                              <div className="small muted truncate">
                                {[r.location, age !== undefined ? `${age} d old` : ''].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                            <button className="btn sm icon ghost" title="Open posting" onClick={() => openUrl(r.url)}>
                              <ExternalLink size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {relevant.length > 25 && <span className="small muted">+{relevant.length - 25} more on their board</span>}
                      <button className="btn sm ghost danger" style={{ alignSelf: 'flex-start' }} onClick={() => removeCompany(c.id)}>
                        <Trash2 size={12} /> Stop following
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
