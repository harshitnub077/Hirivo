import type React from 'react';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { db, type SearchProfile, type UserSettings } from '../../db';
import { patchSettings } from '../../db/settings';
import { searchDefaults, searchQueries, SOURCES } from '../../services/discover';
import { CITIES } from '../../services/discover/geo';
import { openUrl } from '../../services/outreach';
import { Field, Segmented, timeAgo } from '../ui';

/** One place to say what you want; every search, alert and Autopilot run uses it. */
export function SearchCard({ settings, running, onSearch, children }: { settings: UserSettings; running: boolean; onSearch: () => void; children?: React.ReactNode }) {
  const s = searchDefaults(settings);
  const [city, setCity] = useState(s.city);
  // Once there are roles to search for, the search folds to one line so Radar leads with the
  // jobs; a new user with no roles sees the whole form.
  const [editing, setEditing] = useState(() => searchQueries(settings, s).length === 0);
  const set = (patch: Partial<SearchProfile>) => patchSettings({ search: { ...s, ...patch } });
  const queries = searchQueries(settings, s);
  const toggleMode = (m: SearchProfile['workModes'][number]) => {
    const next = s.workModes.includes(m) ? s.workModes.filter((x) => x !== m) : [...s.workModes, m];
    if (next.length) set({ workModes: next });
  };
  const where = s.scope === 'radius' ? String(s.radiusKm) : s.scope;
  const summary = [
    s.jobType === 'internship' ? 'Internships' : s.jobType === 'fulltime' ? 'Jobs' : 'Internships and jobs',
    s.scope === 'remote' ? 'remote' : s.scope === 'india' || !s.city ? 'anywhere in India' : `${s.city}, ${s.radiusKm} km`,
    s.postedWithinDays === 1 ? 'last 24 h' : `last ${s.postedWithinDays} days`,
  ].join(' · ');

  return (
    <section className="card stack">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="h2">{queries.join(' · ') || 'Search'}</div>
          <div className="small muted">{summary}</div>
        </div>
        <div className="row" style={{ gap: 4, flexShrink: 0 }}>
          <button
            className="btn sm icon ghost"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
            aria-label={editing ? 'Hide the search settings' : 'Edit the search'}
            title={editing ? 'Hide the search settings' : 'Edit the search'}
          >
            <ChevronDown style={{ transform: editing ? 'rotate(180deg)' : undefined, transition: 'transform var(--t) var(--ease)' }} />
          </button>
          <button className="btn sm primary" onClick={onSearch} disabled={running}>
            <RefreshCw className={running ? 'spin' : ''} /> {running ? 'Searching…' : 'Search now'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="stack fade-in">

      <Segmented<SearchProfile['jobType']>
        label="Looking for"
        value={s.jobType}
        onChange={(v) => set({ jobType: v })}
        options={[
          { value: 'internship', label: 'Internships' },
          { value: 'fulltime', label: 'Jobs' },
          { value: 'both', label: 'Both' },
        ]}
      />

      <div className="grid-2">
        <Field label="City">
          <input
            list="hirivo-cities"
            value={city}
            placeholder="Bengaluru"
            onChange={(e) => setCity(e.target.value)}
            onBlur={() => city !== s.city && set({ city: city.trim(), scope: city.trim() ? (s.scope === 'india' ? 'radius' : s.scope) : 'india' })}
          />
          <datalist id="hirivo-cities">
            {CITIES.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Where">
          <select
            value={where}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'india' || v === 'remote') set({ scope: v });
              else set({ scope: 'radius', radiusKm: Number(v) as SearchProfile['radiusKm'] });
            }}
          >
            {[10, 25, 50, 100].map((km) => (
              <option key={km} value={km} disabled={!s.city}>
                Within {km} km
              </option>
            ))}
            <option value="india">Anywhere in India</option>
            <option value="remote">Remote, anywhere</option>
          </select>
        </Field>
        <Field label="Posted within">
          <select value={s.postedWithinDays} onChange={(e) => set({ postedWithinDays: Number(e.target.value) as SearchProfile['postedWithinDays'] })}>
            <option value={1}>24 hours</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </Field>
        <Field label="Experience">
          <select value={s.experience} onChange={(e) => set({ experience: e.target.value as SearchProfile['experience'] })}>
            <option value="fresher">Fresher / student</option>
            <option value="0-2">0–2 years</option>
            <option value="2-5">2–5 years</option>
            <option value="5+">5+ years</option>
          </select>
        </Field>
      </div>

      <div className="row wrap" style={{ gap: 6 }}>
        <span className="small muted">Work mode</span>
        {(['onsite', 'hybrid', 'remote'] as const).map((m) => (
          <button key={m} type="button" className={`chip${s.workModes.includes(m) ? ' on' : ''}`} aria-pressed={s.workModes.includes(m)} onClick={() => toggleMode(m)} disabled={s.scope === 'remote'}>
            {m === 'onsite' ? 'On-site' : m === 'hybrid' ? 'Hybrid' : 'Remote'}
          </button>
        ))}
      </div>
      <Field label="Minimum stipend or salary (₹ per month, optional)">
        <input
          type="number"
          min={0}
          step={1000}
          defaultValue={s.minMonthlyPay || ''}
          placeholder="e.g. 10000"
          onBlur={(e) => set({ minMonthlyPay: Number(e.target.value) || undefined })}
        />
      </Field>
      {children}
      <SourceHealth />
        </div>
      )}
    </section>
  );
}

function SourceHealth() {
  const fetches = useLiveQuery(() => db.sourceFetches.toArray(), []) ?? [];
  const [open, setOpen] = useState(false);
  const rows = SOURCES.filter((src) => src.site).map((src) => ({ src, f: fetches.find((x) => x.id === src.id) }));
  const blocked = rows.filter((r) => r.f?.error);
  return (
    <details className="small" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="muted">
        Sources: {rows.filter((r) => r.f && !r.f.error).length} working{blocked.length ? `, ${blocked.length} ${blocked.length === 1 ? 'needs' : 'need'} attention` : ''}
      </summary>
      <ul className="checklist" style={{ marginTop: 6 }}>
        {rows.map(({ src, f }) => (
          <li key={src.id} className={f?.error ? 'caution' : f ? 'ok' : 'neutral'}>
            {f?.error ? <CircleAlert size={13} /> : <CircleCheck size={13} />}
            <span className="grow">
              <a href={src.site} onClick={(e) => (e.preventDefault(), openUrl(src.site))}>
                {src.label}
              </a>{' '}
              <span className="muted">{f ? (f.error ? f.error.replace(/^Blocked: /, '') : `${f.count} jobs · ${timeAgo(f.fetchedAt)}`) : 'not searched yet'}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
