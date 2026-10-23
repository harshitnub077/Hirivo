// scripts/verify-seeds.js
// Checks every candidate company's public ATS feed and writes only the live ones to
// src/services/watchlistSeeds.json. Nothing in the seed list is ever "verified" by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = JSON.parse(fs.readFileSync(path.join(root, 'scripts/seed-candidates.json'), 'utf8'));

const FEEDS = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

async function countOpenRoles(ats, slug) {
  const res = await fetch(FEEDS[ats](slug), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return 0;
  const data = await res.json();
  const jobs = Array.isArray(data) ? data : data.jobs;
  return Array.isArray(jobs) ? jobs.length : 0;
}

const live = [];
for (const c of candidates) {
  try {
    const openRoles = await countOpenRoles(c.ats, c.slug);
    console.log(`${openRoles > 0 ? 'live' : 'DROP'}  ${c.ats.padEnd(10)} ${c.slug.padEnd(32)} ${openRoles}`);
    if (openRoles > 0) live.push({ ...c, openRolesAtCheck: openRoles });
  } catch (err) {
    console.log(`DROP  ${c.ats.padEnd(10)} ${c.slug.padEnd(32)} ${err.message}`);
  }
}

const out = { verifiedAt: new Date().toISOString().slice(0, 10), companies: live };
fs.writeFileSync(path.join(root, 'src/services/watchlistSeeds.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${live.length}/${candidates.length} candidates live -> src/services/watchlistSeeds.json`);
