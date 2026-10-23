import { UserSettings, ResumeRecord } from '../db';

export interface AutofillProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  workAuthorization: 'Yes' | 'No';
  sponsorshipNeeded: 'No' | 'Yes';
}

export function buildAutofillProfile(settings: UserSettings | null): AutofillProfile {
  const fullName = settings?.userFullName || 'Alex Chen';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  return {
    fullName,
    firstName,
    lastName,
    email: settings?.userEmail || 'alex.chen@example.com',
    phone: settings?.userPhone || '+1 (555) 234-5678',
    location: settings?.preferredLocation || 'San Francisco, CA',
    linkedinUrl: settings?.linkedinUrl || 'https://linkedin.com/in/alexchen',
    githubUrl: settings?.githubUrl || 'https://github.com/alexchen',
    portfolioUrl: settings?.portfolioUrl || 'https://alexchen.dev',
    workAuthorization: 'Yes',
    sponsorshipNeeded: 'No',
  };
}
