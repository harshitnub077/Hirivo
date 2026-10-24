// The Autopilot queue: jobs the user handed over, one row each, with a readable log of every step.
import { db, type AutopilotJob } from '../../db';

/** Same id scheme as the side panel's jobIdFor, so Autopilot and Analyze share one job record. */
export function jobIdOf(url: string): string {
  try {
    const u = new URL(url);
    const liJob = u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (u.hostname.endsWith('linkedin.com') && liJob) return `linkedin:${liJob}`;
    return `${u.hostname}${u.pathname}`.replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '');
  } catch {
    return url;
  }
}

export async function enqueue(jobs: { url: string; title: string; company: string }[], { force = false } = {}): Promise<number> {
  const now = Date.now();
  let added = 0;
  for (const j of jobs) {
    const id = jobIdOf(j.url);
    const existing = await db.autopilot.get(id);
    if (existing && (existing.status === 'working' || existing.status === 'queued' || (existing.status === 'done' && !force))) continue;
    await db.autopilot.put({
      id,
      url: j.url,
      title: j.title,
      company: j.company,
      status: 'queued',
      steps: [{ at: now, text: 'Handed to Autopilot.', tone: 'neutral' }],
      emailed: existing?.emailed || [],
      force,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    added++;
  }
  return added;
}

export async function logStep(id: string, text: string, tone: AutopilotJob['steps'][number]['tone'] = 'neutral', patch: Partial<AutopilotJob> = {}) {
  const row = await db.autopilot.get(id);
  if (!row) return;
  await db.autopilot.put({ ...row, ...patch, steps: [...row.steps, { at: Date.now(), text, tone }].slice(-40), updatedAt: Date.now() });
}

export async function setJob(id: string, patch: Partial<AutopilotJob>) {
  await db.autopilot.update(id, { ...patch, updatedAt: Date.now() });
}

/** After a browser restart, jobs left half-done go back in the queue. */
export async function requeueStale(now = Date.now()) {
  const stale = await db.autopilot.where('status').equals('working').filter((j) => now - j.updatedAt > 15 * 60_000).toArray();
  for (const j of stale) await setJob(j.id, { status: 'queued', stage: undefined });
}

export async function nextQueued() {
  return (await db.autopilot.where('status').equals('queued').sortBy('createdAt'))[0];
}
