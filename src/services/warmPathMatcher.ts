import { db, LinkedInConnection } from '../db';

export interface WarmPathMatch {
  connection: LinkedInConnection;
  matchType: 'DIRECT_COMPANY' | 'ALUMNI_AT_COMPANY';
  matchScore: number;
}

export function parseLinkedInConnectionsCSV(csvText: string): LinkedInConnection[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const connections: LinkedInConnection[] = [];

  // LinkedIn CSVs often have introductory notes in the first 2-3 lines
  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('first name') && lower.includes('company')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('Invalid LinkedIn Connections CSV format. Could not locate "First Name" and "Company" headers.');
  }

  // Helper to split CSV row handling quoted fields
  const parseRow = (row: string): string[] => {
    const result: string[] = [];
    let insideQuotes = false;
    let current = '';

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[headerIndex]).map((h) => h.toLowerCase());
  const fnIdx = headers.findIndex((h) => h.includes('first name'));
  const lnIdx = headers.findIndex((h) => h.includes('last name'));
  const compIdx = headers.findIndex((h) => h === 'company');
  const posIdx = headers.findIndex((h) => h === 'position');
  const emailIdx = headers.findIndex((h) => h.includes('email'));
  const dateIdx = headers.findIndex((h) => h.includes('connected on'));
  const urlIdx = headers.findIndex((h) => h === 'url' || h.includes('profile url'));
  const schoolIdx = headers.findIndex((h) => /^(school|education|university|college)/.test(h));

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.length <= Math.max(fnIdx, compIdx)) continue;

    const firstName = fnIdx !== -1 ? row[fnIdx] : '';
    const lastName = lnIdx !== -1 ? row[lnIdx] : '';
    const company = compIdx !== -1 ? row[compIdx] : '';
    const position = posIdx !== -1 ? row[posIdx] : '';
    const email = emailIdx !== -1 ? row[emailIdx] : '';
    const connectedOn = dateIdx !== -1 ? row[dateIdx] : '';
    const url = urlIdx !== -1 ? row[urlIdx] : '';
    const school = schoolIdx !== -1 ? row[schoolIdx] : '';

    if (!firstName && !company) continue;

    const companyNormalized = company.toLowerCase().trim();

    connections.push({
      id: `${firstName}_${lastName}_${companyNormalized}_${i}`,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      company,
      companyNormalized,
      position,
      email,
      connectedOn,
      ...(url ? { url } : {}),
      ...(school ? { school } : {}),
    });
  }

  return connections;
}

export async function importConnectionsToDB(connections: LinkedInConnection[]): Promise<number> {
  await db.connections.bulkPut(connections);
  return connections.length;
}

export async function findWarmPaths(targetCompanyName: string): Promise<WarmPathMatch[]> {
  const normTarget = targetCompanyName.toLowerCase().trim();
  if (!normTarget || normTarget.length < 2) return [];

  // Query all connections from IndexedDB
  const all = await db.connections.toArray();

  const matches: WarmPathMatch[] = [];

  for (const conn of all) {
    const comp = conn.companyNormalized;
    if (!comp) continue;

    if (comp === normTarget || comp.includes(normTarget) || normTarget.includes(comp)) {
      matches.push({
        connection: conn,
        matchType: 'DIRECT_COMPANY',
        matchScore: comp === normTarget ? 100 : 80,
      });
    }
  }

  // Sort highest match first
  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

export function generateWarmReferralNote(
  connection: LinkedInConnection,
  jobTitle: string,
  userFullName: string
): string {
  const greeting = connection.firstName ? `Hey ${connection.firstName},` : 'Hi there,';
  return `${greeting}

Hope you're doing well! I saw that ${connection.company} is currently looking for a ${jobTitle} and immediately thought of you since you're on the team.

I've been working on relevant projects recently and would love to learn more about the team's engineering priorities. Would you be open to a quick 10-minute chat or passing along my resume for a referral?

Either way, hope all is great with you!

Best,
${userFullName || 'A Connection'}`;
}
