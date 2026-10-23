import { db, OutreachRecord } from '../db';

export interface CreateDraftParams {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  jobId: string;
  companyName: string;
  jobTitle: string;
  contactType: OutreachRecord['contactType'];
  factsCited: string[];
}

export interface DraftCreationResult {
  success: boolean;
  draftId?: string;
  threadId?: string;
  error?: string;
  webDraftUrl?: string;
  dailyCount: number;
  dailyCap: number;
}

// Convert string to URL-safe Base64
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createGmailDraft(params: CreateDraftParams): Promise<DraftCreationResult> {
  const settings = await db.settings.get('config');
  const today = new Date().toISOString().split('T')[0];

  let todayCount = settings?.todaySendCount || 0;
  if (settings?.lastSendDate !== today) {
    todayCount = 0;
  }

  const cap = settings?.dailySendCap || 15;
  if (todayCount >= cap) {
    return {
      success: false,
      dailyCount: todayCount,
      dailyCap: cap,
      error: `Daily outreach cap of ${cap} reached. To protect your email reputation and avoid spam flags, pause until tomorrow.`,
    };
  }

  // Get OAuth token via Chrome Identity
  let token: string | undefined;
  try {
    const auth = await chrome.identity.getAuthToken({ interactive: true });
    token = auth.token;
  } catch (err: any) {
    return {
      success: false,
      dailyCount: todayCount,
      dailyCap: cap,
      error: `Google authorization failed: ${err.message || 'Please enable Gmail permissions in Chrome.'}`,
    };
  }

  if (!token) {
    return {
      success: false,
      dailyCount: todayCount,
      dailyCap: cap,
      error: 'Could not obtain valid Gmail authentication token.',
    };
  }

  // Construct RFC 2822 standard email message
  const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`;
  const messageParts = [
    `To: ${params.recipientEmail}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.body,
  ];
  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = base64UrlEncode(rawMessage);

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          raw: encodedMessage,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gmail API Draft creation failed (${res.status}): ${errText}`);
    }

    const draftData = await res.json();
    const draftId = draftData.id;
    const threadId = draftData.message?.threadId;

    // Increment today's count
    const newCount = todayCount + 1;
    await db.settings.put({
      id: 'config',
      groqApiKey: settings?.groqApiKey || '',
      geminiApiKey: settings?.geminiApiKey || '',
      openrouterApiKey: settings?.openrouterApiKey || '',
      activeProvider: settings?.activeProvider || 'groq',
      dailySendCap: cap,
      todaySendCount: newCount,
      lastSendDate: today,
      userFullName: settings?.userFullName || '',
      userEmail: settings?.userEmail || '',
      userCollege: settings?.userCollege || '',
    });

    // Save Outreach Record in IndexedDB with Day 4 & Day 9 schedule
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const outreachRecord: OutreachRecord = {
      id: crypto.randomUUID(),
      jobId: params.jobId,
      companyName: params.companyName,
      jobTitle: params.jobTitle,
      recipientName: params.recipientName,
      recipientEmail: params.recipientEmail,
      contactType: params.contactType,
      emailSubject: params.subject,
      emailBody: params.body,
      linkedInNote: '',
      factsCited: params.factsCited,
      gmailDraftId: draftId,
      gmailThreadId: threadId,
      status: 'DRAFT_CREATED',
      createdAt: now,
      followup1Date: now + 4 * dayMs,
      followup2Date: now + 9 * dayMs,
    };
    await db.outreach.put(outreachRecord);

    return {
      success: true,
      draftId,
      threadId,
      dailyCount: newCount,
      dailyCap: cap,
      webDraftUrl: `https://mail.google.com/mail/u/0/#drafts`,
    };
  } catch (err: any) {
    return {
      success: false,
      dailyCount: todayCount,
      dailyCap: cap,
      error: err.message || 'Unknown error creating draft in Gmail.',
    };
  }
}

export async function checkThreadReplies(threadId: string, recipientEmail: string): Promise<boolean> {
  try {
    const auth = await chrome.identity.getAuthToken({ interactive: false });
    if (!auth?.token) return false;

    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return false;

    const thread = await res.json();
    const messages = thread.messages || [];

    // Check if any message from the recipient exists
    const normRecipient = recipientEmail.toLowerCase().trim();
    for (const msg of messages) {
      const headers = msg.payload?.headers || [];
      const fromHeader = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value?.toLowerCase() || '';
      if (fromHeader.includes(normRecipient)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
