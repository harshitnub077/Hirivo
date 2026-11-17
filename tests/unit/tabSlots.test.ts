// The 2-background-tab limit (rule 9) must hold across MV3 worker restarts, and for every tab Hirivo opens.
import { describe, expect, it } from 'vitest';
import { bindTab, createTabSlots, liveLeases, releaseLease, tryAcquire, type Lease } from '../../src/background/tabSlots';

const lease = (id: string, extra: Partial<Lease> = {}): Lease => ({ id, expiresAt: 1000, closeOnExpiry: true, ...extra });

describe('tab slot helpers', () => {
  it('drops leases whose tab closed or whose time ran out', () => {
    const { live, stale } = liveLeases([lease('a', { tabId: 1 }), lease('b', { tabId: 2 }), lease('c'), lease('d', { expiresAt: 10 })], new Set([1]), 100);
    expect(live.map((l) => l.id)).toEqual(['a', 'c']);
    expect(stale.map((l) => l.id)).toEqual(['b', 'd']);
  });

  it('refuses a third slot', () => {
    const two = tryAcquire([lease('a')], lease('b'), 2)!;
    expect(two.map((l) => l.id)).toEqual(['a', 'b']);
    expect(tryAcquire(two, lease('c'), 2)).toBeNull();
  });

  it('binds a tab and releases a lease', () => {
    const bound = bindTab([lease('a'), lease('b')], 'b', 7, 5000);
    expect(bound[1]).toMatchObject({ tabId: 7, expiresAt: 5000 });
    expect(bound[0].tabId).toBeUndefined();
    expect(releaseLease(bound, 'a').map((l) => l.id)).toEqual(['b']);
  });
});

function fakeChrome() {
  const store = { leases: [] as Lease[] };
  const open = new Set<number>();
  const closed: number[] = [];
  let clock = 0;
  let nextTab = 1;
  const deps = () => ({
    load: async () => store.leases.map((l) => ({ ...l })),
    save: async (l: Lease[]) => void (store.leases = l.map((x) => ({ ...x }))),
    openTabIds: async () => new Set(open),
    closeTab: (id: number) => {
      open.delete(id);
      closed.push(id);
    },
    now: () => clock,
    retryMs: 5,
    ttlMs: 1000,
  });
  const openTab = () => {
    const id = nextTab++;
    open.add(id);
    return id;
  };
  return { store, open, closed, deps, openTab, advance: (ms: number) => (clock += ms) };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createTabSlots', () => {
  it('makes a third tab wait until one of the first two finishes', async () => {
    const f = fakeChrome();
    const { withTabSlot } = createTabSlots(f.deps());
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      withTabSlot(async (claim) => {
        started.push(i);
        await claim(f.openTab());
        await g.promise;
      })
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[0].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(f.store.leases).toEqual([]);
  });

  it('keeps the limit after the worker restarts', async () => {
    const f = fakeChrome();
    const before = createTabSlots(f.deps());
    const gate = deferred();
    // Two tabs held by the first worker instance, which then "dies" (its promises never settle).
    void before.withTabSlot(async (claim) => (await claim(f.openTab()), gate.promise));
    void before.withTabSlot(async (claim) => (await claim(f.openTab()), gate.promise));
    await tick();
    expect(f.store.leases).toHaveLength(2);

    const after = createTabSlots(f.deps()); // fresh module memory, same session storage
    let ran = false;
    const third = after.withTabSlot(async () => void (ran = true));
    await tick(40);
    expect(ran).toBe(false);

    f.open.delete(f.store.leases[0].tabId!); // the user (or Chrome) closes one of those tabs
    await third;
    expect(ran).toBe(true);
  });

  it('frees a slot whose lease expired, closing a leaked scrape tab but never a form tab', async () => {
    const f = fakeChrome();
    const dead = createTabSlots(f.deps());
    const never = new Promise<void>(() => undefined);
    void dead.withTabSlot(async (claim) => (await claim(f.openTab()), never)); // tab 1, scrape
    void dead.withTabSlot(async (claim) => (await claim(f.openTab()), never), { closeOnExpiry: false }); // tab 2, form
    await tick();
    f.advance(2000);
    const fresh = createTabSlots(f.deps());
    await fresh.withTabSlot(async () => undefined);
    expect(f.closed).toEqual([1]);
    expect(f.open.has(2)).toBe(true);
  });

  it('releases the slot when the job throws', async () => {
    const f = fakeChrome();
    const { withTabSlot } = createTabSlots(f.deps());
    await expect(withTabSlot(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(f.store.leases).toEqual([]);
  });

  it('releases a kept form tab once the report is back, while the tab stays open', async () => {
    const f = fakeChrome();
    const { withTabSlot } = createTabSlots(f.deps());
    const tabId = await withTabSlot(async (claim) => {
      const id = f.openTab();
      await claim(id);
      return id;
    }, { closeOnExpiry: false });
    expect(f.open.has(tabId)).toBe(true);
    expect(f.store.leases).toEqual([]);
  });
});
