import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, XCircle } from 'lucide-react';
import { db, JobSnapshot } from '../../db';
import { Pill } from '../ui';

/** One row per requirement: what the job asks for, and the resume fact that proves it (or the gap). */
export function EvidenceTable({ job }: { job: JobSnapshot }) {
  const facts = useLiveQuery(() => db.facts.toArray(), []) ?? [];
  const rows = job.fitEvidence || [];
  return (
    <ul className="evidence" aria-label="Requirements and your evidence">
      {rows.map((r) => {
        const fact = r.factId && r.factId !== 'SKILLS' ? facts.find((f) => f.id === r.factId) : undefined;
        return (
          <li key={r.id} className={r.met ? 'ok' : 'risk'}>
            {r.met ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <div>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <span>{r.text}</span>
                <span className="kind">{r.kind === 'must' ? 'Must' : 'Nice'}</span>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
                {r.factId === 'SKILLS' ? (
                  <Pill>Listed in skills</Pill>
                ) : r.factId ? (
                  <span className="fact" title={fact?.claim}>
                    {r.factId}
                  </span>
                ) : (
                  <Pill tone="risk">Gap</Pill>
                )}
                <span className="small muted">{r.reason}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
