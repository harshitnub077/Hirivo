import React, { useState } from 'react';
import { Check, Copy, ExternalLink, FileJson, Mail, RefreshCw, Unplug } from 'lucide-react';
import type { UserSettings } from '../../db';
import { checkClientInputs, connectGmail, disconnectGmail, parseClientFile } from '../../services/gmail';
import { openUrl } from '../../services/outreach';
import { Callout, Field, Pill, useCopy } from '../ui';

const redirectUrl = () => (typeof chrome !== 'undefined' && chrome.runtime?.id ? `https://${chrome.runtime.id}.chromiumapp.org/` : 'https://<your-extension-id>.chromiumapp.org/');

const CONSOLE = 'https://console.cloud.google.com';

/** Optional Gmail power mode with the user's own Google OAuth client. */
export function GmailSection({ settings }: { settings: UserSettings }) {
  const gmail = settings.gmail;
  const [clientId, setClientId] = useState(gmail?.clientId || '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();
  const [fileNote, setFileNote] = useState<{ tone: 'ok' | 'caution'; text: string } | null>(null);

  const loadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const c = parseClientFile(await file.text(), redirectUrl());
      setClientId(c.clientId);
      setSecret(c.clientSecret);
      setFileNote(
        c.redirectOk
          ? { tone: 'ok', text: 'Client loaded, and its redirect address is right. Press Connect Gmail.' }
          : { tone: 'caution', text: 'Client loaded, but the redirect address in step 4 isn’t on it yet. Add it to the client in Google Cloud, save, then press Connect Gmail.' }
      );
    } catch (err: any) {
      setFileNote({ tone: 'caution', text: err.message });
    }
  };
  const inputProblem = !gmail && (clientId.trim() || secret.trim()) ? checkClientInputs(clientId, secret) : null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectGmail(clientId, secret || gmail?.clientSecret || '');
      setSecret('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const link = (label: string, path: string) => (
    <a href={`${CONSOLE}${path}`} onClick={(e) => (e.preventDefault(), openUrl(`${CONSOLE}${path}`))}>
      {label} <ExternalLink size={11} aria-hidden="true" />
    </a>
  );

  if (gmail && !gmail.needsReconnect) {
    return (
      <div className="stack">
        <Callout tone="ok">
          Connected as <b>{gmail.email}</b>. Emails are saved as real Gmail drafts, follow-ups go in the same thread, and replies are spotted every 3 hours
          (or with Check now in Pipeline). You still press Send in Gmail.
        </Callout>
        <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => disconnectGmail()}>
          <Unplug size={14} /> Disconnect Gmail
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {gmail?.needsReconnect ? (
        <Callout tone="caution">
          Google asked Hirivo to sign in again for {gmail.email}. Press Reconnect. If this happens every week, your Google app is in Testing mode (see step 3).
        </Callout>
      ) : (
        <p className="small muted">
          Optional. Without it, Hirivo opens a prefilled Gmail window and you mark replies yourself. With it, Hirivo saves real drafts, keeps follow-ups in the
          same thread and notices replies on its own. It uses your own Google app, so your email never passes through anyone else.
        </p>
      )}

      {!gmail && (
        <ol className="setup-steps">
          <li>
            {link('Create a Google Cloud project', '/projectcreate')} (any name, e.g. “Hirivo for me”).
          </li>
          <li>
            {link('Turn on the Gmail API', '/flows/enableapi?apiid=gmail.googleapis.com')}: one click, pick your project.
          </li>
          <li>
            Open {link('Google Auth Platform', '/auth/overview')} → <b>Get started</b>: app name, your email, audience <b>External</b>. Then under{' '}
            {link('Audience → Test users', '/auth/audience')} add the <b>exact Gmail address you will sign in with</b> (otherwise Google shows “Access blocked … has not
            completed the verification process”). Under {link('Data access', '/auth/scopes')} add <span className="mono">gmail.compose</span> and{' '}
            <span className="mono">gmail.readonly</span>.
            <span className="muted"> Optional: press “Publish app” on the Audience page, or Google signs you out every 7 days.</span>
          </li>
          <li>
            {link('Create a client', '/auth/clients/create')}: type <b>Web application</b>, and under <b>Authorized redirect URIs</b> add exactly:
            <div className="row" style={{ marginTop: 6 }}>
              <code className="mono redirect">{redirectUrl()}</code>
              <button className="btn sm icon" title="Copy" onClick={() => copy('redirect', redirectUrl())}>
                {copied === 'redirect' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </li>
          <li>
            In the dialog that appears, press <b>Download JSON</b> and load that file here. Or copy the Client ID and the Client secret (it starts with{' '}
            <span className="mono">GOCSPX-</span>) into the boxes below.
          </li>
        </ol>
      )}

      {!gmail && (
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <FileJson size={14} /> Load the client JSON file
          <input type="file" accept=".json,application/json" hidden onChange={loadFile} />
        </label>
      )}
      {fileNote && <Callout tone={fileNote.tone}>{fileNote.text}</Callout>}

      <Field label="Client ID">
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
      </Field>
      {!gmail && (
        <Field label="Client secret" hint="Stays on this computer and is never exported.">
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" />
        </Field>
      )}
      <button className="btn primary" onClick={connect} disabled={busy || !clientId.trim() || (!gmail && (!secret.trim() || Boolean(inputProblem)))}>
        {busy ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />} {gmail ? 'Reconnect Gmail' : 'Connect Gmail'}
      </button>
      {inputProblem && !error && clientId.trim() && secret.trim() && <p className="small" style={{ color: 'var(--caution)' }}>{inputProblem}</p>}
      {error && <Callout tone="caution">{error}</Callout>}
      {gmail && <Pill tone="caution">Needs reconnect</Pill>}
    </div>
  );
}
