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
export async function patchSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const next = { ...(await getSettings()), ...patch, id: 'config' };
  await db.settings.put(next);
  return next;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
