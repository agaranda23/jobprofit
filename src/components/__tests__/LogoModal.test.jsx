// @vitest-environment jsdom
/**
 * LogoModal — paste-URL hardening tests (mixed-content fix).
 *
 * Root cause of the "Not secure" bug: handleUrlSave used to save
 * `urlValue.trim()` verbatim, so an http:// paste was written straight to
 * profile.logo_url and rendered as mixed content on every https page that
 * shows the logo — including the trader's own PUBLIC customer-facing
 * quote/invoice/receipt pages.
 *
 * Fix: handleUrlSave now
 *   - auto-upgrades a bare http:// paste to https:// before saving,
 *   - rejects (inline error, no save) anything that isn't https:// / // / data:,
 *   - still saves `null` for an emptied field (existing "clear logo" behaviour).
 *
 * No Supabase mock needed — these tests only exercise the "Paste URL" tab,
 * which never touches supabase.storage (that's the "Upload image" tab only).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn() })) },
  },
}));

import LogoModal from '../LogoModal';

function openUrlTab() {
  fireEvent.click(screen.getByRole('button', { name: /paste url/i }));
}

function urlInput() {
  return screen.getByLabelText(/image url/i);
}

describe('LogoModal — paste-URL never saves an http:// logo_url', () => {
  it('auto-upgrades a bare http:// paste to https:// before saving', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<LogoModal currentUrl="" userId="u1" onSave={onSave} onClose={() => {}} />);

    openUrlTab();
    fireEvent.change(urlInput(), { target: { value: 'http://example.com/logo.png' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ logo_url: 'https://example.com/logo.png' }));
  });

  it('saves an https:// paste unchanged', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<LogoModal currentUrl="" userId="u1" onSave={onSave} onClose={() => {}} />);

    openUrlTab();
    fireEvent.change(urlInput(), { target: { value: 'https://example.com/logo.png' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ logo_url: 'https://example.com/logo.png' }));
  });

  it('rejects a scheme-less string with an inline error and never calls onSave', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<LogoModal currentUrl="" userId="u1" onSave={onSave} onClose={() => {}} />);

    openUrlTab();
    fireEvent.change(urlInput(), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid image url/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('clearing the field and saving still clears the logo (logo_url: null)', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<LogoModal currentUrl="https://example.com/logo.png" userId="u1" onSave={onSave} onClose={() => {}} />);

    openUrlTab();
    fireEvent.change(urlInput(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ logo_url: null }));
  });

  it('renders the live preview of an http:// currentUrl upgraded to https://', () => {
    render(<LogoModal currentUrl="http://example.com/logo.png" userId="u1" onSave={vi.fn()} onClose={() => {}} />);
    expect(screen.getByAltText('Current logo')).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});
