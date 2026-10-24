import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Mail, RefreshCw, Unplug } from 'lucide-react';
import type { UserSettings } from '../../db';
import { connectGmail, disconnectGmail } from '../../services/gmail';
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
            In Google Cloud, {link('create a project', '/projectcreate')} (any name, e.g. “Hirivo for me”).
          </li>
          <li>
            Turn on the {link('Gmail API', '/apis/library/gmail.googleapis.com')} for that project.
          </li>
          <li>
            Open {link('Google Auth Platform', '/auth/overview')}: choose <b>External</b>, add your own email under <b>Audience → Test users</b>, and under{' '}
            <b>Data access</b> add the scopes <span className="mono">gmail.compose</span> and <span className="mono">gmail.readonly</span>.
            <span className="muted"> In Testing mode Google signs you out every 7 days; press “Publish app” to avoid that. Google will call it unverified, which is expected for an app only you use.</span>
          </li>
          <li>
            Under {link('Clients', '/auth/clients')}, create a client of type <b>Web application</b> and add this exact <b>Authorized redirect URI</b>:
            <div className="row" style={{ marginTop: 6 }}>
              <code className="mono redirect">{redirectUrl()}</code>
              <button className="btn sm icon" title="Copy" onClick={() => copy('redirect', redirectUrl())}>
                {copied === 'redirect' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </li>
          <li>Copy the Client ID and Client secret into the boxes below and press Connect. Approve both Gmail permissions.</li>
        </ol>
      )}

      <Field label="Client ID">
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
      </Field>
      {!gmail && (
        <Field label="Client secret" hint="Stays on this computer and is never exported.">
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" />
        </Field>
      )}
      <button className="btn primary" onClick={connect} disabled={busy || !clientId.trim() || (!gmail && !secret.trim())}>
        {busy ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />} {gmail ? 'Reconnect Gmail' : 'Connect Gmail'}
      </button>
      {error && <Callout tone="caution">{error}</Callout>}
      {gmail && <Pill tone="caution">Needs reconnect</Pill>}
    </div>
  );
}
