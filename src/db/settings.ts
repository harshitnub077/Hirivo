import { db, UserSettings } from './index';

const DEFAULTS: UserSettings = {
  id: 'config',
  groqApiKey: '',
  geminiApiKey: '',
  openrouterApiKey: '',
  activeProvider: 'groq',
  dailySendCap: 15,
  todaySendCount: 0,
  lastSendDate: '',
  userFullName: '',
  userEmail: '',
  userCollege: '',
  earlyBirdAlerts: true,
  autoFillForms: true,
};

export async function getSettings(): Promise<UserSettings> {
  const saved = await db.settings.get('config');
  return { ...DEFAULTS, ...saved, id: 'config' };
}

// Merge-update so no caller can wipe fields it doesn't know about.
// In a transaction, so a Gmail token refresh in the background can't overwrite a profile edit
// made in the panel at the same moment (or the other way round).
export async function patchSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await getSettings()), ...patch, id: 'config' };
    await db.settings.put(next);
    return next;
  });
}

/** The user's local calendar day, so daily limits reset at their midnight, not UTC's. */
export function todayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
