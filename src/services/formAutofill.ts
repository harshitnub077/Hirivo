import { UserSettings } from '../db';

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
  college: string;
  workAuthorization: 'Yes' | 'No';
  sponsorshipNeeded: 'No' | 'Yes';
}

// Empty fields stay empty: the autofill skips them rather than typing placeholder data into a real application.
export function buildAutofillProfile(settings: UserSettings | null): AutofillProfile {
  const fullName = settings?.userFullName || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  return {
    fullName,
    firstName,
    lastName,
    email: settings?.userEmail || '',
    phone: settings?.userPhone || '',
    location: settings?.preferredLocation || '',
    linkedinUrl: settings?.linkedinUrl || '',
    githubUrl: settings?.githubUrl || '',
    portfolioUrl: settings?.portfolioUrl || '',
    college: settings?.userCollege || '',
    workAuthorization: 'Yes',
    sponsorshipNeeded: 'No',
  };
}
