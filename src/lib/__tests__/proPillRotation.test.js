// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { nextPillPerk, PILL_PERKS } from '../proPillRotation';

beforeEach(() => {
  localStorage.clear();
});

describe('nextPillPerk', () => {
  it('returns the first perk (true-profit) on a fresh device', () => {
    expect(nextPillPerk()).toBe('true-profit');
  });

  it('rotates through all 3 perks across repeated calls (one per "load")', () => {
    expect(nextPillPerk()).toBe('true-profit');
    expect(nextPillPerk()).toBe('remove-footer');
    expect(nextPillPerk()).toBe('tax-pot');
  });

  it('wraps back around to the first perk after a full cycle', () => {
    for (let i = 0; i < PILL_PERKS.length; i++) nextPillPerk();
    expect(nextPillPerk()).toBe('true-profit');
  });

  it('persists the rotation index across calls via localStorage', () => {
    nextPillPerk(); // true-profit, stores 0
    expect(localStorage.getItem('jp.getProPillRotation')).toBe('0');
    nextPillPerk(); // remove-footer, stores 1
    expect(localStorage.getItem('jp.getProPillRotation')).toBe('1');
  });

  it('defaults to the first perk when localStorage is unavailable', () => {
    const original = window.localStorage;
    // Simulate a private-browsing / storage-denied environment.
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
      },
      configurable: true,
    });
    expect(nextPillPerk()).toBe('true-profit');
    Object.defineProperty(window, 'localStorage', { value: original, configurable: true });
  });
});
