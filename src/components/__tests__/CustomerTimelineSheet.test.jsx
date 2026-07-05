// @vitest-environment jsdom
/**
 * CustomerTimelineSheet — Customer Timeline slice 1.
 *
 * Covers:
 *  1. Empty state — customer with only one event (just created).
 *  2. No-contact-details state — chips replaced by "+ Add phone…" ghost row.
 *  3. Feed render — date-group headers + event rows, newest first.
 *  4. Tapping an event row for a different job calls onSelectJob with that job.
 *  5. "Show earlier" reveals events beyond the initial 50.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomerTimelineSheet from '../CustomerTimelineSheet';

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    summary: 'Bathroom refit',
    total: 500,
    createdAt: '2026-06-01T09:00:00Z',
    ...overrides,
  };
}

describe('CustomerTimelineSheet — empty state', () => {
  it('shows the "start with {FirstName}" empty state when there is only one event', () => {
    const job = makeJob(); // only createdAt → 1 event
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);
    expect(screen.getByText('This is the start with Sarah.')).toBeInTheDocument();
    expect(screen.getByText(/Every quote, invoice, payment and note/)).toBeInTheDocument();
  });

  it('renders an "Add a note" action wired to onAddNote in the empty state', () => {
    const job = makeJob();
    const onAddNote = vi.fn();
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} onAddNote={onAddNote} />);
    fireEvent.click(screen.getByText('+ Add a note'));
    expect(onAddNote).toHaveBeenCalled();
  });

  it('omits the "Add a note" action when onAddNote is not provided', () => {
    const job = makeJob();
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);
    expect(screen.queryByText('+ Add a note')).not.toBeInTheDocument();
  });
});

describe('CustomerTimelineSheet — contact state', () => {
  it('shows Call/Text/WhatsApp/Map chips when a phone or address is present', () => {
    const job = makeJob({ customerPhone: '07700900000', quoteSentAt: '2026-06-02T09:00:00Z' });
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Map')).toBeInTheDocument();
  });

  it('shows the "Add phone" ghost row when the customer has no phone or address', () => {
    const job = makeJob({ quoteSentAt: '2026-06-02T09:00:00Z' }); // no phone, no address
    const onAddPhone = vi.fn();
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} onAddPhone={onAddPhone} />);
    const addBtn = screen.getByText('+ Add phone to call or text in one tap');
    expect(addBtn).toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(onAddPhone).toHaveBeenCalled();
  });
});

describe('CustomerTimelineSheet — feed', () => {
  it('renders date-group headers and event rows, newest first', () => {
    const job = makeJob({
      quoteSentAt: '2026-06-02T09:00:00Z',
      acceptedAt: '2026-06-05T09:00:00Z',
    });
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);
    // 3 events total (created, quote_sent, accepted) → not the 1-event empty state.
    expect(screen.getByText('Quote accepted')).toBeInTheDocument();
    expect(screen.getByText('Quote sent — £500')).toBeInTheDocument();
    expect(screen.getByText('Job created')).toBeInTheDocument();
  });

  it('shows the quiet job-name sub-label when the customer has multiple jobs', () => {
    const jobA = makeJob({ id: 'a', summary: 'Bathroom refit', quoteSentAt: '2026-06-02T09:00:00Z' });
    const jobB = makeJob({ id: 'b', summary: 'Kitchen tap', createdAt: '2026-06-03T09:00:00Z' });
    render(<CustomerTimelineSheet job={jobA} jobs={[jobA, jobB]} receipts={[]} onClose={vi.fn()} />);
    expect(screen.getAllByText('Bathroom refit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kitchen tap').length).toBeGreaterThan(0);
  });

  it('tapping an event for a different job calls onSelectJob with that job object', () => {
    const jobA = makeJob({ id: 'a', summary: 'Bathroom refit', createdAt: '2026-06-01T09:00:00Z' });
    const jobB = makeJob({ id: 'b', summary: 'Kitchen tap', createdAt: '2026-06-03T09:00:00Z' });
    const onSelectJob = vi.fn();
    render(
      <CustomerTimelineSheet job={jobA} jobs={[jobA, jobB]} receipts={[]} onClose={vi.fn()} onSelectJob={onSelectJob} />
    );
    // jobB's "Job created" row is the newest event — sorted first.
    const rows = screen.getAllByText('Job created');
    fireEvent.click(rows[0].closest('button'));
    expect(onSelectJob).toHaveBeenCalledWith(jobB);
  });
});

describe('CustomerTimelineSheet — lifetime strip', () => {
  it('shows billed/paid/jobs, and owed only when > 0', () => {
    const job = makeJob({ total: 1000, payments: [{ amount: 400 }], quoteSentAt: '2026-06-02T09:00:00Z' });
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);
    expect(screen.getByText('£1,000 billed')).toBeInTheDocument();
    expect(screen.getByText('£400 paid')).toBeInTheDocument();
    expect(screen.getByText('£600 owed')).toBeInTheDocument();
    expect(screen.getByText('1 job')).toBeInTheDocument();
  });
});

describe('CustomerTimelineSheet — "Show earlier"', () => {
  it('renders a "Show earlier" button when there are more than 50 events, and reveals them on tap', () => {
    // Build a job with 60 dated notes → 60 events + 1 created = 61 events.
    const jobNotes = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      subject: `Note ${i}`,
      body: '',
      date: new Date(2026, 0, i + 1).toISOString(),
    }));
    const job = makeJob({ jobNotes });
    render(<CustomerTimelineSheet job={job} jobs={[job]} receipts={[]} onClose={vi.fn()} />);

    expect(screen.getByText('Show earlier')).toBeInTheDocument();
    // Oldest note (Note 0) should not be visible yet (only newest 50 shown).
    expect(screen.queryByText('Note: "Note 0"')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Show earlier'));
    expect(screen.getByText('Note: "Note 0"')).toBeInTheDocument();
    expect(screen.queryByText('Show earlier')).not.toBeInTheDocument();
  });
});
