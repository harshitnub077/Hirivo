// The background-tab limit (at most 2 at a time, rule 9). The MV3 worker sleeps and loses its memory,
// so the held slots live in storage (chrome.storage.session in the worker) and are checked against the
// tabs that are really open. Nothing here touches `chrome`; index.ts wires it up.

export interface Lease {
  id: string;
  tabId?: number; // set once the tab exists
  expiresAt: number; // a lease from a worker that died mid-job stops counting after this
  closeOnExpiry: boolean; // scrape/read tabs are always meant to close; form tabs may be the user's to finish
}

/** Leases that still hold a slot, and the ones that don't (expired, or their tab is gone). */
export function liveLeases(leases: Lease[], openTabIds: Set<number>, now: number) {
  const live: Lease[] = [];
  const stale: Lease[] = [];
  for (const l of leases) {
    const tabOpen = l.tabId === undefined || openTabIds.has(l.tabId);
    (now < l.expiresAt && tabOpen ? live : stale).push(l);
  }
  return { live, stale };
}

/** The lease list with `lease` added, or null when every slot is taken. */
export function tryAcquire(live: Lease[], lease: Lease, limit: number): Lease[] | null {
  return live.length < limit ? [...live, lease] : null;
}

export function bindTab(leases: Lease[], id: string, tabId: number, expiresAt?: number): Lease[] {
  return leases.map((l) => (l.id === id ? { ...l, tabId, expiresAt: expiresAt ?? l.expiresAt } : l));
}

export function releaseLease(leases: Lease[], id: string): Lease[] {
  return leases.filter((l) => l.id !== id);
}

export interface TabSlotDeps {
  load(): Promise<Lease[]>;
  save(leases: Lease[]): Promise<void>;
  openTabIds(): Promise<Set<number>>;
  closeTab(tabId: number): unknown;
  now?: () => number;
  limit?: number;
  ttlMs?: number;
  /** How often a waiting call re-checks; a slot held by an earlier worker has no in-memory waker. */
  retryMs?: number;
  newId?: () => string;
}

export interface SlotOptions {
  closeOnExpiry?: boolean;
  ttlMs?: number;
}

export type Claim = (tabId: number) => Promise<void>;

export function createTabSlots(deps: TabSlotDeps) {
  const now = deps.now ?? Date.now;
  const limit = deps.limit ?? 2;
  const defaultTtl = deps.ttlMs ?? 120_000;
  const retryMs = deps.retryMs ?? 1000;
  let counter = 0;
  const newId = deps.newId ?? (() => `${now().toString(36)}-${Math.random().toString(36).slice(2)}-${counter++}`);

  // One read-modify-write of the lease list at a time. Only one worker instance runs at once.
  let lock: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  const wakers = new Set<() => void>();
  const wake = () => [...wakers].forEach((w) => w());
  const waitForWake = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, retryMs);
      wakers.add(done);
    });

  async function prune(): Promise<Lease[]> {
    const [leases, open] = await Promise.all([deps.load(), deps.openTabIds()]);
    const { live, stale } = liveLeases(leases, open, now());
    for (const l of stale) if (l.closeOnExpiry && l.tabId !== undefined && open.has(l.tabId)) Promise.resolve(deps.closeTab(l.tabId)).catch(() => undefined);
    return live;
  }

  async function acquire(closeOnExpiry: boolean, ttlMs: number): Promise<string> {
    const id = newId();
    for (;;) {
      const got = await locked(async () => {
        const live = await prune();
        const next = tryAcquire(live, { id, expiresAt: now() + ttlMs, closeOnExpiry }, limit);
        await deps.save(next ?? live);
        return next !== null;
      });
      if (got) return id;
      await waitForWake();
    }
  }

  /** Runs `fn` holding one slot. `fn` calls `claim(tabId)` right after creating its tab. */
  async function withTabSlot<T>(fn: (claim: Claim) => Promise<T>, opts: SlotOptions = {}): Promise<T> {
    const ttlMs = opts.ttlMs ?? defaultTtl;
    const id = await acquire(opts.closeOnExpiry ?? true, ttlMs);
    const claim: Claim = (tabId) => locked(async () => deps.save(bindTab(await deps.load(), id, tabId, now() + ttlMs)));
    try {
      return await fn(claim);
    } finally {
      await locked(async () => deps.save(releaseLease(await deps.load(), id))).catch(() => undefined);
      wake();
    }
  }

  return { withTabSlot, wake };
}
