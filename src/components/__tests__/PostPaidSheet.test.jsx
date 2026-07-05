// @vitest-environment jsdom
/**
 * PostPaidSheet — Capture Layer Slice A regression.
 *
 * Covers the one new behaviour added for the comms-log capture layer:
 * tapping "Leave a Google review" opens the WhatsApp review-request link
 * AND fires onReviewSent() so AppShell can log a 'review' commsLog touch.
 * onReviewSent must NOT fire when there's no review link (the nudge path).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PostPaidSheet from '../PostPaidSheet';

function baseJob(overrides = {}) {
  return { id: 'j1', customer: 'Dave Smith', phone: '07700900000', total: 250, ...overrides };
}

function baseProfile(overrides = {}) {
  return { google_review_link: 'https://g.page/r/example/review', ...overrides };
}

describe('PostPaidSheet — review send logs a commsLog touch', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('opens the WhatsApp review link and calls onReviewSent when a review link is set', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    const onReviewSent = vi.fn();
    render(
      <PostPaidSheet
        active
        job={baseJob()}
        profile={baseProfile()}
        onClose={vi.fn()}
        onBookAgain={vi.fn()}
        onGoToReviewSettings={vi.fn()}
        onReviewSent={onReviewSent}
      />
    );

    fireEvent.click(screen.getByTestId('review-button'));

    expect(openSpy).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener');
    expect(onReviewSent).toHaveBeenCalledTimes(1);
  });

  it('does not render a review send button (and never calls onReviewSent) when no review link is set', () => {
    const onReviewSent = vi.fn();
    render(
      <PostPaidSheet
        active
        job={baseJob()}
        profile={baseProfile({ google_review_link: '' })}
        onClose={vi.fn()}
        onBookAgain={vi.fn()}
        onGoToReviewSettings={vi.fn()}
        onReviewSent={onReviewSent}
      />
    );

    expect(screen.queryByTestId('review-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-link-nudge')).toBeInTheDocument();
    expect(onReviewSent).not.toHaveBeenCalled();
  });

  it('is a no-op-safe optional prop — omitting onReviewSent does not throw', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    render(
      <PostPaidSheet
        active
        job={baseJob()}
        profile={baseProfile()}
        onClose={vi.fn()}
        onBookAgain={vi.fn()}
        onGoToReviewSettings={vi.fn()}
      />
    );
    expect(() => fireEvent.click(screen.getByTestId('review-button'))).not.toThrow();
    expect(openSpy).toHaveBeenCalled();
  });
});
