import { beforeEach, describe, expect, it } from 'vitest';
import { db, OutreachRecord } from '../../src/db';
import { getSettings, patchSettings } from '../../src/db/settings';
import {
  buildAuthUrl,
  buildRawMessage,
  createDraft,
  detectReply,
  draftFollowupInThread,
  draftOpenUrl,
  findReplies,
  getAccessToken,
  GmailNeedsReconnect,
  hasRequiredScopes,
  parseAuthRedirect,
  pkceChallenge,
  toBase64Url,
  type AuthDeps,
  type ThreadMessage,
} from '../../src/services/gmail';
import { dueFollowupStage } from '../../src/services/outreach';

const NOW = Date.UTC(2026, 9, 24, 10);
const fromB64Url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));

/** A fake fetch that routes by URL and records every call. */
function fakeFetch(routes: [RegExp, (init?: RequestInit) => unknown, number?][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const route = routes.find(([re]) => re.test(String(input)));
    if (!route) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(route[1](init)), { status: route[2] ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const connected = (over: Record<string, unknown> = {}) =>
  patchSettings({
    gmail: { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', email: 'aarav@gmail.com', accessToken: 'tok', expiresAt: NOW + 3_600_000, refreshToken: 'r', connectedAt: NOW, ...over },
  });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('OAuth pieces', () => {
  it('computes the PKCE challenge (RFC 7636 test vector)', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('builds a code + PKCE request for both Gmail scopes', () => {
    const u = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'https://abc.chromiumapp.org/', challenge: 'ch', state: 'st', loginHint: 'a@b.com', silent: true }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'none',
      login_hint: 'a@b.com',
      scope: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly',
    });
  });
  it('checks the redirect state and errors', () => {
    expect(parseAuthRedirect('https://abc.chromiumapp.org/?code=42&state=st', 'st')).toBe('42');
    expect(() => parseAuthRedirect('https://abc.chromiumapp.org/?code=42&state=evil', 'st')).toThrow(/unexpected/);
    expect(() => parseAuthRedirect('https://abc.chromiumapp.org/?error=access_denied&state=st', 'st')).toThrow(/not granted/);
    expect(hasRequiredScopes('https://www.googleapis.com/auth/gmail.compose')).toBe(false);
  });
  it('opens the draft in the right Gmail account', () => {
    expect(draftOpenUrl('a+b@gmail.com', '18c2')).toBe('https://mail.google.com/mail/?authuser=a%2Bb%40gmail.com#drafts?compose=18c2');
  });
});

describe('messages', () => {
  it('builds an RFC 2822 message with UTF-8 subject, body and reply headers', () => {
    const raw = buildRawMessage({ to: 'neha@zeta.tech', subject: 'Re: Checkout — ₹ speed', body: 'Hi Neha,\nBumping this.', inReplyTo: '<m1@mail.gmail.com>' });
    const [head, body] = raw.split('\r\n\r\n');
    expect(head).toContain('To: neha@zeta.tech');
    expect(head).toContain('In-Reply-To: <m1@mail.gmail.com>');
    expect(head).toContain('References: <m1@mail.gmail.com>');
    expect(utf8(head.match(/=\?UTF-8\?B\?(.+)\?=/)![1])).toBe('Re: Checkout — ₹ speed');
    expect(utf8(body)).toBe('Hi Neha,\r\nBumping this.');
    expect(fromB64Url(toBase64Url(raw))).toBe(raw);
  });
});

describe('reply detection', () => {
  const thread: ThreadMessage[] = [
    { id: '1', labelIds: ['SENT'], headers: { from: 'Aarav Mehta <aarav@gmail.com>' } },
    { id: '2', labelIds: ['DRAFT'], headers: { from: 'Aarav Mehta <aarav@gmail.com>' } },
  ];
  it('ignores the user’s own messages and drafts', () => expect(detectReply(thread, 'aarav@gmail.com')).toBeUndefined());
  it('counts a message from anyone else (even a colleague of the recipient)', () => {
    expect(detectReply([...thread, { id: '3', labelIds: ['INBOX'], headers: { from: 'Ravi <ravi@zeta.tech>' } }], 'AARAV@gmail.com')?.id).toBe('3');
  });

  it('a reply in Gmail flips the record to Replied within one poll, and follow-ups stop', async () => {
    const base = {
      jobId: 'j', companyName: 'Zeta', jobTitle: 'FE', recipientName: 'Neha Rao', recipientEmail: 'neha@zeta.tech', contactType: 'COLD_HIRING_MGR' as const,
      emailSubject: 'Checkout speed', emailBody: '…', linkedInNote: '', factsCited: [], createdAt: NOW - 5 * 86_400_000,
      followup1Date: NOW - 86_400_000, followup2Date: NOW + 4 * 86_400_000, followupsDone: 0,
    };
    const records: OutreachRecord[] = [
      { ...base, id: 'a', status: 'SENT', gmailThreadId: 't-replied' },
      { ...base, id: 'b', status: 'SENT', gmailThreadId: 't-quiet' },
      { ...base, id: 'c', status: 'SENT' }, // sent without Gmail power mode: not polled
    ];
    await db.outreach.bulkPut(records);
    const threads: Record<string, ThreadMessage[]> = {
      't-replied': [...thread, { id: '9', labelIds: ['INBOX', 'UNREAD'], headers: { from: '"Neha Rao" <neha@zeta.tech>' } }],
      't-quiet': thread,
    };
    const replies = await findReplies(records, 'aarav@gmail.com', async (id) => threads[id]);
    expect(replies).toEqual([{ id: 'a', from: '"Neha Rao" <neha@zeta.tech>' }]);

    for (const r of replies) await db.outreach.update(r.id, { status: 'REPLIED', repliedAt: NOW });
    const a = (await db.outreach.get('a'))!;
    expect(a.status).toBe('REPLIED');
    expect(dueFollowupStage(a, NOW)).toBe(0);
    expect(dueFollowupStage((await db.outreach.get('b'))!, NOW)).toBe(1);
  });
});

describe('without setup', () => {
  it('changes nothing: no polling, no network, not connected', async () => {
    const { gmailConnected, pollGmailReplies } = await import('../../src/services/gmail');
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch;
    try {
      expect(await gmailConnected()).toBeUndefined();
      expect(await pollGmailReplies()).toEqual([]);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('tokens', () => {
  it('uses a cached token while it is valid', async () => {
    await connected();
    const f = fakeFetch([]);
    expect(await getAccessToken({ fetch: f.fn, now: () => NOW })).toBe('tok');
    expect(f.calls).toHaveLength(0);
  });

  it('refreshes an expired token with the refresh token', async () => {
    await connected({ expiresAt: NOW - 1 });
    const f = fakeFetch([[/oauth2\.googleapis\.com\/token/, () => ({ access_token: 'new', expires_in: 3600 })]]);
    expect(await getAccessToken({ fetch: f.fn, now: () => NOW })).toBe('new');
    expect(new URLSearchParams(String(f.calls[0].init?.body)).get('grant_type')).toBe('refresh_token');
    expect((await getSettings()).gmail).toMatchObject({ accessToken: 'new', expiresAt: NOW + 3_600_000 });
  });

  it('asks to reconnect when the refresh token expired and silent sign-in fails', async () => {
    await connected({ expiresAt: NOW - 1 });
    const f = fakeFetch([[/oauth2\.googleapis\.com\/token/, () => ({ error: 'invalid_grant' }), 400]]);
    const deps: AuthDeps = { fetch: f.fn, now: () => NOW, redirectUri: 'https://abc.chromiumapp.org/', launch: async () => Promise.reject(new Error('interaction required')) };
    await expect(getAccessToken(deps)).rejects.toBeInstanceOf(GmailNeedsReconnect);
    expect((await getSettings()).gmail?.needsReconnect).toBe(true);
  });

  it('silently re-authorises when Google allows it', async () => {
    await connected({ expiresAt: NOW - 1 });
    const f = fakeFetch([
      [/oauth2\.googleapis\.com\/token/, (init) => (String(init?.body).includes('refresh_token') ? { error: 'invalid_grant' } : { access_token: 'silent', expires_in: 3600, refresh_token: 'r2' }), 200],
    ]);
    // Make the refresh call fail but the code exchange succeed.
    const fetchImpl = (async (url: string, init?: RequestInit) =>
      String(init?.body).includes('grant_type=refresh_token') ? new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) : f.fn(url, init)) as typeof fetch;
    const deps: AuthDeps = {
      fetch: fetchImpl,
      now: () => NOW,
      redirectUri: 'https://abc.chromiumapp.org/',
      launch: async (url, interactive) => {
        expect(interactive).toBe(false);
        const state = new URL(url).searchParams.get('state');
        return `https://abc.chromiumapp.org/?code=c1&state=${state}`;
      },
    };
    expect(await getAccessToken(deps)).toBe('silent');
    expect((await getSettings()).gmail).toMatchObject({ refreshToken: 'r2', needsReconnect: false });
  });
});

describe('drafts', () => {
  it('creates a draft and returns its thread', async () => {
    await connected();
    const f = fakeFetch([[/\/drafts$/, () => ({ id: 'd1', message: { id: 'm1', threadId: 't1' } })]]);
    const d = await createDraft({ to: 'neha@zeta.tech', subject: 'Checkout speed', body: 'Hi Neha' }, { fetch: f.fn, now: () => NOW });
    expect(d).toEqual({ draftId: 'd1', messageId: 'm1', threadId: 't1' });
    const sent = JSON.parse(String(f.calls[0].init?.body));
    expect(fromB64Url(sent.message.raw)).toContain('To: neha@zeta.tech');
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('drafts a follow-up in the same thread, replying to its latest real message', async () => {
    await connected();
    const f = fakeFetch([
      [
        /\/threads\/t1/,
        () => ({
          messages: [
            { id: 'm1', labelIds: ['SENT'], payload: { headers: [{ name: 'Message-ID', value: '<m1@x>' }, { name: 'From', value: 'aarav@gmail.com' }] } },
            { id: 'm2', labelIds: ['DRAFT'], payload: { headers: [{ name: 'Message-ID', value: '<draft@x>' }] } },
          ],
        }),
      ],
      [/\/drafts$/, () => ({ id: 'd2', message: { id: 'm3', threadId: 't1' } })],
    ]);
    await draftFollowupInThread({ gmailThreadId: 't1', recipientEmail: 'neha@zeta.tech', emailSubject: 'Checkout speed' }, 'Bumping this.', { fetch: f.fn, now: () => NOW });
    const draft = JSON.parse(String(f.calls[1].init?.body));
    expect(draft.message.threadId).toBe('t1');
    const raw = fromB64Url(draft.message.raw);
    expect(raw).toContain('In-Reply-To: <m1@x>');
    expect(utf8(raw.match(/=\?UTF-8\?B\?(.+?)\?=/)![1])).toBe('Re: Checkout speed');
  });
});
