// A board's success page must only mark the job it belongs to as applied.
import { describe, expect, it } from 'vitest';
import { boardKey, matchAppliedJob } from '../../src/background/appliedMatch';

describe('boardKey', () => {
  it('normalises board hosts to host plus first path segment', () => {
    expect(boardKey('https://boards.greenhouse.io/acme/jobs/123')).toBe('greenhouse.io/acme');
    expect(boardKey('https://job-boards.greenhouse.io/acme/jobs/123/confirmation')).toBe('greenhouse.io/acme');
    expect(boardKey('https://jobs.lever.co/acme/abc-123/thanks')).toBe('jobs.lever.co/acme');
    expect(boardKey('not a url')).toBe('');
  });
});

describe('matchAppliedJob', () => {
  const gh = { id: 'gh', url: 'https://boards.greenhouse.io/acme/jobs/123' };

  it('does not mark the only applying job when the submission was on another board', () => {
    expect(matchAppliedJob([gh], 'https://jobs.lever.co/other/xyz/thanks')).toBeUndefined();
  });

  it('matches the job on the same board', () => {
    expect(matchAppliedJob([gh], 'https://job-boards.greenhouse.io/acme/jobs/123/confirmation')).toBe(gh);
  });

  it('ignores a page with no board key', () => {
    expect(matchAppliedJob([gh], '')).toBeUndefined();
  });

  it('uses the job path to choose between two jobs on one board, and gives up when it cannot', () => {
    const other = { id: 'gh2', url: 'https://boards.greenhouse.io/acme/jobs/456' };
    expect(matchAppliedJob([gh, other], 'https://boards.greenhouse.io/acme/jobs/456/confirmation')).toBe(other);
    expect(matchAppliedJob([gh, other], 'https://boards.greenhouse.io/acme/confirmation')).toBeUndefined();
  });
});
