import { describe, expect, it } from 'vitest';
import { keywordMatch } from '../../src/services/keywordMatch';

const JD = `We're hiring a Frontend Engineer. You'll build our checkout in React and TypeScript, with Next.js on the server.
Requirements: 2+ years with React, strong TypeScript, GraphQL APIs, and testing with Jest or Playwright. Experience with CI/CD and Docker is a plus.
Bonus: Kubernetes. Let's go build the future of payments.`;
const RESUME = `Built a React + TypeScript dashboard. Wrote Jest tests. Deployed with docker on AWS. Node.js APIs.`;

describe('keywordMatch', () => {
  const r = keywordMatch(JD, RESUME);
  it('lists what the job names, most mentioned first', () => {
    expect(new Set(r.present.slice(0, 2))).toEqual(new Set(['React', 'TypeScript']));
    expect(r.present).toEqual(expect.arrayContaining(['Jest', 'Docker']));
    expect(r.missing).toEqual(expect.arrayContaining(['Next.js', 'GraphQL', 'Playwright', 'CI/CD', 'Kubernetes']));
  });
  it('does not treat everyday words as skills', () => {
    expect([...r.present, ...r.missing]).not.toContain('Go'); // "Let's go build"
  });
  it('computes the share of named keywords the resume has', () => {
    expect(r.share).toBe(Math.round((r.present.length / (r.present.length + r.missing.length)) * 100));
  });
  it('matches aliases (golang → Go, postgres → PostgreSQL)', () => {
    const m = keywordMatch('Go, Kafka and Postgres. We use Go for everything; golang experts welcome.', 'Golang services on postgres');
    expect(m.present).toEqual(expect.arrayContaining(['Go', 'PostgreSQL']));
    expect(m.missing).toEqual(['Kafka']);
  });
});
