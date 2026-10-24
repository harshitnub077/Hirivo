// Gmail power mode: the user's OWN Google OAuth client ("bring your own"), so Hirivo never needs
// Google's restricted-scope verification. Authorization-code flow with PKCE (Google's recommended
// flow; the implicit flow is legacy) via chrome.identity.launchWebAuthFlow. With it connected,
// Hirivo creates real drafts (follow-ups in the same thread) and checks threads for replies.
// The user still presses Send in Gmail. Without it, nothing changes: the compose-URL flow stays.
import { db } from '../db';
import { getSettings, patchSettings } from '../db/settings';
import type { OutreachRecord, UserSettings } from '../db';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];
export const GMAIL_ORIGINS = ['https://gmail.googleapis.com/*', 'https://oauth2.googleapis.com/*'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailState = NonNullable<UserSettings['gmail']>;

export class GmailNeedsReconnect extends Error {
  constructor(message = 'Gmail needs to be reconnected (You → Gmail).') {
    super(message);
  }
}

// ---------- PKCE and URLs (pure) ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string; loginHint?: string; silent?: boolean }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    prompt: o.silent ? 'none' : 'consent',
  });
  if (o.loginHint) p.set('login_hint', o.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Reads the code from the redirect, checking the state we sent. */
export function parseAuthRedirect(redirectUrl: string, expectedState: string): string {
  const u = new URL(redirectUrl);
  const error = u.searchParams.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Gmail access was not granted.' : `Google sign-in failed (${error}).`);
  if (u.searchParams.get('state') !== expectedState) throw new Error('Google sign-in returned an unexpected response. Try again.');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('Google sign-in returned no code.');
  return code;
}

export function hasRequiredScopes(scope: string | undefined): boolean {
  const granted = new Set((scope || '').split(/\s+/));
  return GMAIL_SCOPES.every((s) => granted.has(s));
}

export function draftsFolderUrl(email: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`;
}

export function draftOpenUrl(email: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts?compose=${encodeURIComponent(messageId)}`;
}

// ---------- Messages (pure) ----------

const utf8B64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export interface MailAttachment {
  name: string;
  type: string;
  base64: string;
}

const wrap76 = (b64: string) => b64.replace(/.{76}/g, '$&\r\n');

export function buildRawMessage(m: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; attachment?: MailAttachment }): string {
  const headers = [
    `To: ${m.to}`,
    `Subject: =?UTF-8?B?${utf8B64(m.subject)}?=`,
    'MIME-Version: 1.0',
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.references || m.inReplyTo}`] : []),
  ];
  const body = wrap76(utf8B64(m.body.replace(/\r?\n/g, '\r\n')));
  if (!m.attachment) {
    return `${[...headers, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'].join('\r\n')}\r\n\r\n${body}`;
  }
  // multipart/mixed: the text, then the resume as a file.
  const boundary = `hirivo-${Math.random().toString(36).slice(2)}`;
  const file = m.attachment.name.replace(/["\r\n]/g, '');
  const encodedName = /^[\x20-\x7e]+$/.test(file) ? `"${file}"` : `"=?UTF-8?B?${utf8B64(file)}?="`;
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    `--${boundary}`,
    `Content-Type: ${m.attachment.type || 'application/octet-stream'}; name=${encodedName}`,
    `Content-Disposition: attachment; filename=${encodedName}`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(m.attachment.base64),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export const toBase64Url = (raw: string) => btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface ThreadMessage {
  id: string;
  labelIds?: string[];
  headers: Record<string, string>; // lower-cased header names
}

const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();

// Bounces and out-of-office notes land in the same thread but are not a person answering.
const AUTOMATED_SENDER = /^(?:mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i;
const AUTOMATED_SUBJECT = /^(?:automatic reply|auto(?:matic)?[- ]?reply|out of (?:the )?office|undeliverable|delivery status notification|mail delivery failed|returned mail)\b/i;

/** A reply is a message in the thread from someone other than the user: not a draft, not one the
 * user sent (from any alias), and not a bounce or auto-reply. */
export function detectReply(messages: ThreadMessage[], userEmail: string): ThreadMessage | undefined {
  const me = userEmail.toLowerCase();
  return messages.find((m) => {
    const labels = m.labelIds || [];
    if (labels.includes('DRAFT') || labels.includes('SENT') || !m.headers.from) return false;
    const from = addressOf(m.headers.from);
    return from !== me && !AUTOMATED_SENDER.test(from) && !AUTOMATED_SUBJECT.test(m.headers.subject || '');
  });
}

// ---------- Tokens ----------

type Fetch = typeof fetch;

async function tokenRequest(body: Record<string, string>, fetchImpl: Fetch) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Google token error ${res.status}`);
    (err as any).code = data.error;
    throw err;
  }
  return data as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
}

export interface AuthDeps {
  fetch: Fetch;
  /** chrome.identity.launchWebAuthFlow; undefined where unavailable (tests, no permission). */
  launch?: (url: string, interactive: boolean) => Promise<string>;
  redirectUri?: string;
  now?: () => number;
}

const defaultDeps = (): AuthDeps => ({
  fetch: (...a) => fetch(...a),
  launch:
    typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow
      ? (url, interactive) => chrome.identity.launchWebAuthFlow({ url, interactive }).then((r) => r || Promise.reject(new Error('Sign-in was closed.')))
      : undefined,
  redirectUri: typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : undefined,
  now: () => Date.now(),
});

async function codeFlow(state: GmailState | { clientId: string; clientSecret: string }, deps: AuthDeps, silent: boolean, loginHint?: string) {
  if (!deps.launch || !deps.redirectUri) throw new GmailNeedsReconnect();
  const verifier = randomVerifier();
  const nonce = randomVerifier().slice(0, 16);
  const url = buildAuthUrl({ clientId: state.clientId, redirectUri: deps.redirectUri, challenge: await pkceChallenge(verifier), state: nonce, loginHint, silent });
  const code = parseAuthRedirect(await deps.launch(url, !silent), nonce);
  return tokenRequest(
    { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: state.clientId, client_secret: state.clientSecret, redirect_uri: deps.redirectUri },
    deps.fetch
  );
}

/** A valid access token: cached, refreshed, or silently re-authorised. Marks needsReconnect when all fail. */
export async function getAccessToken(deps: AuthDeps = defaultDeps()): Promise<string> {
  const s = (await getSettings()).gmail;
  if (!s) throw new GmailNeedsReconnect('Gmail is not connected.');
  const now = (deps.now || Date.now)();
  if (s.accessToken && s.expiresAt - now > 120_000) return s.accessToken;
  try {
    if (!s.refreshToken) throw Object.assign(new Error('no refresh token'), { code: 'invalid_grant' });
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret }, deps.fetch);
    await patchSettings({ gmail: { ...s, accessToken: t.access_token, expiresAt: now + t.expires_in * 1000, needsReconnect: false } });
    return t.access_token;
  } catch (err: any) {
    // Offline or Google hiccup: the refresh token may be fine. Try again next time instead of
    // asking the user to reconnect.
    if (!err?.code) throw err;
    // Refresh tokens from a Testing-mode Google app expire after 7 days; try a silent sign-in first.
    try {
      const t = await codeFlow(s, deps, true, s.email);
      await patchSettings({ gmail: { ...s, accessToken: t.access_token, expiresAt: now + t.expires_in * 1000, refreshToken: t.refresh_token || s.refreshToken, needsReconnect: false } });
      return t.access_token;
    } catch {
      await patchSettings({ gmail: { ...s, needsReconnect: true } });
      throw new GmailNeedsReconnect();
    }
  }
}

async function api<T>(path: string, init: RequestInit = {}, deps: AuthDeps = defaultDeps()): Promise<T> {
  const token = await getAccessToken(deps);
  const res = await deps.fetch(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (res.status === 401) throw new GmailNeedsReconnect();
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------- Connect / disconnect (side panel, from a click) ----------

/** Google's "Access blocked: … has not completed the Google verification process" page ends in a
 * closed window with no detail. The usual cause is a Testing-mode app whose test users don't include
 * the account the user signed in with, so say exactly that. */
export function signInHelp(message: string): string {
  if (/did not approve|was closed|not granted|access_denied|canceled|cancelled/i.test(message)) {
    return 'Google didn’t let this account in. If it said “has not completed the Google verification process”, open Google Auth Platform → Audience → Test users and add the exact Gmail address you are signing in with (or press “Publish app”), then press Connect again.';
  }
  if (/redirect_uri_mismatch/i.test(message)) return 'Google rejected the redirect address. Copy the exact address from step 4 into your client’s Authorized redirect URIs.';
  return message;
}

export async function connectGmail(clientId: string, clientSecret: string, override: Partial<AuthDeps> = {}): Promise<GmailState> {
  if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new Error('That doesn’t look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).');
  if (!clientSecret.trim()) throw new Error('Paste the client secret too. It stays on this computer.');
  if (typeof chrome !== 'undefined' && chrome.permissions) {
    // Optional permissions: asked only here, so nothing changes for people who never connect.
    const ok = await chrome.permissions.request({ permissions: ['identity'], origins: GMAIL_ORIGINS });
    if (!ok) throw new Error('Hirivo needs your OK to use Google sign-in and the Gmail API.');
  }
  // chrome.identity exists only once the permission is granted, so build the helpers now.
  const deps: AuthDeps = { ...defaultDeps(), ...override };
  const t = await codeFlow({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }, deps, false).catch((err: Error) => {
    throw new Error(signInHelp(err.message));
  });
  if (!hasRequiredScopes(t.scope)) throw new Error('Google didn’t grant both Gmail permissions (compose and read). Connect again and tick both boxes.');
  const now = (deps.now || Date.now)();
  const profile = await (
    await deps.fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })
  ).json();
  const state: GmailState = {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    email: String(profile.emailAddress || ''),
    accessToken: t.access_token,
    expiresAt: now + t.expires_in * 1000,
    refreshToken: t.refresh_token,
    connectedAt: now,
    needsReconnect: false,
  };
  await patchSettings({ gmail: state });
  return state;
}

export async function disconnectGmail(deps: AuthDeps = defaultDeps()) {
  const s = (await getSettings()).gmail;
  if (s?.refreshToken || s?.accessToken) {
    await deps
      .fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: s.refreshToken || s.accessToken }).toString(),
      })
      .catch(() => undefined);
  }
  await patchSettings({ gmail: undefined });
}

export async function gmailConnected(): Promise<GmailState | undefined> {
  const s = (await getSettings()).gmail;
  return s && !s.needsReconnect ? s : undefined;
}

// ---------- Drafts and threads ----------

export async function createDraft(m: { to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string; attachment?: MailAttachment }, deps?: AuthDeps) {
  const raw = toBase64Url(buildRawMessage(m));
  const draft = await api<{ id: string; message: { id: string; threadId: string } }>(
    '/drafts',
    { method: 'POST', body: JSON.stringify({ message: { raw, ...(m.threadId ? { threadId: m.threadId } : {}) } }) },
    deps
  );
  return { draftId: draft.id, messageId: draft.message.id, threadId: draft.message.threadId };
}

/** Sends a saved draft (gmail.compose covers sending). Used only by Autopilot, which the user turned on. */
export async function sendDraft(draftId: string, deps?: AuthDeps) {
  return api<{ id: string; threadId: string; labelIds?: string[] }>('/drafts/send', { method: 'POST', body: JSON.stringify({ id: draftId }) }, deps);
}

export async function getThread(threadId: string, deps?: AuthDeps): Promise<ThreadMessage[]> {
  const t = await api<{ messages?: { id: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } }[] }>(
    `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`,
    {},
    deps
  );
  return (t.messages || []).map((m) => ({
    id: m.id,
    labelIds: m.labelIds,
    headers: Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])),
  }));
}

/** Draft a follow-up inside the original thread, replying to its latest message. */
export async function draftFollowupInThread(r: Pick<OutreachRecord, 'gmailThreadId' | 'recipientEmail' | 'emailSubject'>, body: string, deps?: AuthDeps) {
  if (!r.gmailThreadId) throw new Error('This message has no Gmail thread.');
  const thread = await getThread(r.gmailThreadId, deps);
  const last = [...thread].reverse().find((m) => !(m.labelIds || []).includes('DRAFT'));
  const subject = /^re:/i.test(r.emailSubject) ? r.emailSubject : `Re: ${r.emailSubject}`;
  const msgId = last?.headers['message-id'];
  const refs = [last?.headers.references, msgId].filter(Boolean).join(' ');
  return createDraft({ to: r.recipientEmail, subject, body, threadId: r.gmailThreadId, inReplyTo: msgId, references: refs || undefined }, deps);
}

/** Polls every open thread, marks replies, and returns them. Needs a connected account. */
export async function pollGmailReplies(): Promise<{ record: OutreachRecord; from: string }[]> {
  const gmail = await gmailConnected();
  if (!gmail) return [];
  const open = await db.outreach.where('status').equals('SENT').toArray();
  const found = await findReplies(open, gmail.email, (id) => getThread(id));
  const out: { record: OutreachRecord; from: string }[] = [];
  for (const f of found) {
    await db.outreach.update(f.id, { status: 'REPLIED', repliedAt: Date.now() });
    const record = open.find((r) => r.id === f.id);
    if (record) out.push({ record, from: f.from });
  }
  return out;
}

/** One polling pass: which open threads now have a reply. Pure apart from the injected thread reader. */
export async function findReplies(
  records: OutreachRecord[],
  userEmail: string,
  readThread: (threadId: string) => Promise<ThreadMessage[]>
): Promise<{ id: string; from: string }[]> {
  const replies: { id: string; from: string }[] = [];
  for (const r of records) {
    if (r.status !== 'SENT' || !r.gmailThreadId) continue;
    let thread: ThreadMessage[];
    try {
      thread = await readThread(r.gmailThreadId);
    } catch (err) {
      // A thread the user deleted (404) shouldn't stop every other thread from being checked.
      if (err instanceof GmailNeedsReconnect) throw err;
      continue;
    }
    const reply = detectReply(thread, userEmail);
    if (reply) replies.push({ id: r.id, from: reply.headers.from });
  }
  return replies;
}
