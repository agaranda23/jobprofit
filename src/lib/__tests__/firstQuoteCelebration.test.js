// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasSeenFirstQuoteCelebration,
  markFirstQuoteCelebrationSeen,
  shouldCelebrateFirstQuote,
} from '../firstQuoteCelebration';

const USER = 'user-123';

beforeEach(() => {
  localStorage.clear();
});

describe('hasSeenFirstQuoteCelebration / markFirstQuoteCelebrationSeen', () => {
  it('has not been seen by default', () => {
    expect(hasSeenFirstQuoteCelebration(USER)).toBe(false);
  });

  it('is seen after marking', () => {
    markFirstQuoteCelebrationSeen(USER);
    expect(hasSeenFirstQuoteCelebration(USER)).toBe(true);
  });

  it('treats a missing userId as already-seen (never fires without an identity)', () => {
    expect(hasSeenFirstQuoteCelebration(null)).toBe(true);
    expect(hasSeenFirstQuoteCelebration(undefined)).toBe(true);
  });

  it('marking with no userId is a safe no-op', () => {
    expect(() => markFirstQuoteCelebrationSeen(null)).not.toThrow();
  });

  it('is per-user — marking one user does not mark another', () => {
    markFirstQuoteCelebrationSeen('user-A');
    expect(hasSeenFirstQuoteCelebration('user-B')).toBe(false);
  });
});

describe('shouldCelebrateFirstQuote', () => {
  it('true when there is no prior quote and the flag has not been seen', () => {
    const jobs = [{ id: 'j1', status: 'active' }, { id: 'j2', status: 'paid' }];
    expect(shouldCelebrateFirstQuote(jobs, USER)).toBe(true);
  });

  it('false when a prior job already carries a quoteStatus', () => {
    const jobs = [{ id: 'j1', quoteStatus: 'draft' }];
    expect(shouldCelebrateFirstQuote(jobs, USER)).toBe(false);
  });

  it('false when the celebration has already been shown on this device', () => {
    markFirstQuoteCelebrationSeen(USER);
    const jobs = [{ id: 'j1', status: 'active' }];
    expect(shouldCelebrateFirstQuote(jobs, USER)).toBe(false);
  });

  it('true for a brand-new user with an empty jobs array', () => {
    expect(shouldCelebrateFirstQuote([], USER)).toBe(true);
  });

  it('handles a non-array existingJobs value safely', () => {
    expect(shouldCelebrateFirstQuote(null, USER)).toBe(true);
    expect(shouldCelebrateFirstQuote(undefined, USER)).toBe(true);
  });

  it('false when userId is missing (never fires without an identity)', () => {
    expect(shouldCelebrateFirstQuote([], null)).toBe(false);
  });
});
