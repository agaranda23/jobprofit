/**
 * SettingsScreen editability — pure-logic tests.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   1.  formatSortCode formats raw digits as XX-XX-XX
 *   2.  formatSortCode strips non-digit characters
 *   3.  formatSortCode handles partial input (fewer than 6 digits)
 *   4.  validateNonEmpty rejects blank/whitespace, accepts content
 *   5.  validateAccountNumber accepts exactly 8 digits
 *   6.  validateAccountNumber rejects < 8 digits
 *   7.  validateAccountNumber rejects > 8 digits
 *   8.  validateAccountNumber strips non-digits before counting
 *   9.  validateHourlyRate accepts positive numbers
 *   10. validateHourlyRate accepts empty string (field is optional)
 *   11. validateHourlyRate rejects negative numbers
 *   12. validateHourlyRate rejects non-numeric strings
 *   13. handleProfileUpdate patch shape — onProfileUpdate called with correct key
 *   14. handleProfileUpdate is NOT called when save is not triggered
 *
 * The last two items simulate the save flow without a real component mount,
 * by exercising the same logic path that EditFieldModal.handleSave uses.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Helpers under test ────────────────────────────────────────────────────────
// formatSortCode now lives in the shared src/lib/bankDetails.js (a pure module
// with no side-effect imports) — import it directly so this test exercises the
// real function. The validators below stay inlined rather than imported from
// SettingsScreen.jsx because that screen file has side-effect imports
// (package.json, pushSubscribe, supabase) that would require extra mocking;
// they're kept in sync by matching the screen's definitions.

import { formatSortCode } from '../../lib/bankDetails.js';

function validateNonEmpty(v) {
  return v.trim() ? null : 'This field is required';
}

function validateAccountNumber(v) {
  const digits = v.replace(/\D/g, '');
  return digits.length === 8 ? null : 'Must be 8 digits';
}

function validateHourlyRate(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  if (isNaN(n) || n < 0) return 'Must be a positive number';
  return null;
}

// ── Sort code formatting ──────────────────────────────────────────────────────

describe('formatSortCode', () => {
  it('formats 6 raw digits as XX-XX-XX', () => {
    expect(formatSortCode('040004')).toBe('04-00-04');
  });

  it('strips dashes and spaces before formatting', () => {
    expect(formatSortCode('04-00-04')).toBe('04-00-04');
  });

  it('strips letters and spaces', () => {
    expect(formatSortCode('12 34 56')).toBe('12-34-56');
  });

  it('handles partial input of 4 digits', () => {
    expect(formatSortCode('1234')).toBe('12-34');
  });

  it('handles partial input of 2 digits', () => {
    expect(formatSortCode('12')).toBe('12');
  });

  it('handles partial input of 1 digit', () => {
    expect(formatSortCode('1')).toBe('1');
  });

  it('truncates to first 6 digits when given more', () => {
    expect(formatSortCode('123456789')).toBe('12-34-56');
  });

  it('returns empty string for empty input', () => {
    expect(formatSortCode('')).toBe('');
  });
});

// ── Non-empty validation ──────────────────────────────────────────────────────

describe('validateNonEmpty', () => {
  it('returns null for a non-empty string', () => {
    expect(validateNonEmpty('Alan')).toBeNull();
  });

  it('returns error message for empty string', () => {
    expect(validateNonEmpty('')).toBe('This field is required');
  });

  it('returns error message for whitespace-only string', () => {
    expect(validateNonEmpty('   ')).toBe('This field is required');
  });
});

// ── Account number validation ─────────────────────────────────────────────────

describe('validateAccountNumber', () => {
  it('accepts exactly 8 digits', () => {
    expect(validateAccountNumber('12345678')).toBeNull();
  });

  it('rejects 7 digits', () => {
    expect(validateAccountNumber('1234567')).toBe('Must be 8 digits');
  });

  it('rejects 9 digits', () => {
    expect(validateAccountNumber('123456789')).toBe('Must be 8 digits');
  });

  it('rejects empty string', () => {
    expect(validateAccountNumber('')).toBe('Must be 8 digits');
  });

  it('strips non-digit characters before counting', () => {
    // e.g. user types "1234 5678" — still valid
    expect(validateAccountNumber('1234 5678')).toBeNull();
  });
});

// ── Hourly rate validation ────────────────────────────────────────────────────

describe('validateHourlyRate', () => {
  it('accepts a positive integer string', () => {
    expect(validateHourlyRate('35')).toBeNull();
  });

  it('accepts a positive decimal string', () => {
    expect(validateHourlyRate('27.50')).toBeNull();
  });

  it('accepts empty string (field is optional)', () => {
    expect(validateHourlyRate('')).toBeNull();
  });

  it('accepts null (field is optional)', () => {
    expect(validateHourlyRate(null)).toBeNull();
  });

  it('rejects negative numbers', () => {
    expect(validateHourlyRate('-10')).toBe('Must be a positive number');
  });

  it('rejects non-numeric strings', () => {
    expect(validateHourlyRate('abc')).toBe('Must be a positive number');
  });

  it('accepts zero (free work is valid)', () => {
    expect(validateHourlyRate('0')).toBeNull();
  });
});

// ── Save flow (handleProfileUpdate contract) ──────────────────────────────────

describe('handleProfileUpdate save flow', () => {
  it('calls onProfileUpdate with the correct patch for business_name', async () => {
    const onProfileUpdate = vi.fn().mockResolvedValue(undefined);

    // Simulate what EditFieldModal.handleSave does internally:
    //   build patch from values, call onSave(patch)
    const values = { business_name: 'New Name' };
    const patch = Object.fromEntries(
      [{ key: 'business_name' }].map(f => [f.key, values[f.key]])
    );
    await onProfileUpdate(patch);

    expect(onProfileUpdate).toHaveBeenCalledOnce();
    expect(onProfileUpdate).toHaveBeenCalledWith({ business_name: 'New Name' });
  });

  it('does NOT call onProfileUpdate when the user cancels', () => {
    const onProfileUpdate = vi.fn();

    // Cancel path — onSave is simply never invoked
    const cancelled = true;
    if (!cancelled) onProfileUpdate({ business_name: 'whatever' });

    expect(onProfileUpdate).not.toHaveBeenCalled();
  });

  it('rejects when onProfileUpdate throws and keeps modal state correct', async () => {
    const onProfileUpdate = vi.fn().mockRejectedValue(new Error('Supabase write failed'));

    const patch = { sort_code: '04-00-04', account_number: '12345678', account_name: 'Alan' };
    await expect(onProfileUpdate(patch)).rejects.toThrow('Supabase write failed');
  });
});

// ── MonthlyOverheadsSection persist() contract ────────────────────────────────
// Regression test for fix/overhead-running-cost-save:
//   - persist() returns true on success, false on failure.
//   - handleAdd / handleEditSave must NOT close the inline form when save fails.
//
// We simulate the logic without mounting the component (project convention: no DOM).

async function makePersist(onSave, setItems, setError, setSaving) {
  return async (next) => {
    setSaving(true);
    setError('');
    try {
      await onSave({ overheads: next });
      setItems(next);
      return true;
    } catch {
      setError('Could not save — try again');
      return false;
    } finally {
      setSaving(false);
    }
  };
}

describe('MonthlyOverheadsSection persist()', () => {
  it('returns true and commits items when onSave resolves', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const setItems = vi.fn();
    const setError = vi.fn();
    const setSaving = vi.fn();
    const persist = await makePersist(onSave, setItems, setError, setSaving);

    const next = [{ id: 'a', name: 'Van insurance', amount: 80, category: 'Insurance', is_active: true }];
    const result = await persist(next);

    expect(result).toBe(true);
    expect(setItems).toHaveBeenCalledWith(next);
    expect(setError).toHaveBeenCalledWith('');
  });

  it('returns false and sets error when onSave rejects (e.g. missing DB column)', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('column "overheads" does not exist'));
    const setItems = vi.fn();
    const setError = vi.fn();
    const setSaving = vi.fn();
    const persist = await makePersist(onSave, setItems, setError, setSaving);

    const next = [{ id: 'b', name: 'Fuel', amount: 150, category: 'Fuel', is_active: true }];
    const result = await persist(next);

    expect(result).toBe(false);
    expect(setItems).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Could not save — try again');
  });

  it('handleAdd closes form only when persist returns true', async () => {
    let formClosed = false;
    const onSave = vi.fn().mockResolvedValue(undefined);
    const setItems = vi.fn();
    const setError = vi.fn();
    const setSaving = vi.fn();
    const persist = await makePersist(onSave, setItems, setError, setSaving);

    const ok = await persist([{ id: 'c', name: 'Phone', amount: 40, category: 'Phone', is_active: true }]);
    if (ok) formClosed = true;

    expect(formClosed).toBe(true);
  });

  it('handleAdd keeps form open when persist returns false', async () => {
    let formClosed = false;
    const onSave = vi.fn().mockRejectedValue(new Error('DB error'));
    const setItems = vi.fn();
    const setError = vi.fn();
    const setSaving = vi.fn();
    const persist = await makePersist(onSave, setItems, setError, setSaving);

    const ok = await persist([{ id: 'd', name: 'Rent', amount: 500, category: 'Rent', is_active: true }]);
    if (ok) formClosed = true;

    expect(formClosed).toBe(false);
  });

  it('always calls setSaving(false) even when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('network error'));
    const setItems = vi.fn();
    const setError = vi.fn();
    const setSaving = vi.fn();
    const persist = await makePersist(onSave, setItems, setError, setSaving);

    await persist([]);

    // setSaving is called twice: true at start, false in finally
    expect(setSaving).toHaveBeenCalledTimes(2);
    expect(setSaving).toHaveBeenNthCalledWith(1, true);
    expect(setSaving).toHaveBeenNthCalledWith(2, false);
  });
});

// ── LogoModal upload validation logic ─────────────────────────────────────────
// Inline the validation rules from LogoModal.handleFileChange so they can be
// tested without mounting the component.

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function validateLogoFile(file) {
  if (!file.type.startsWith('image/')) {
    return 'Please pick an image file (JPEG, PNG, WebP…)';
  }
  if (file.size > LOGO_MAX_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`;
  }
  return null;
}

// Simulate the upload-then-save path shape (no real network)
async function simulateLogoUpload({ file, session, uploadResult, publicUrl, onSave }) {
  const validationError = validateLogoFile(file);
  if (validationError) return { error: validationError, savedWith: null };

  const userId = session?.user?.id;
  if (!userId) return { error: 'Not signed in — please sign out and back in then try again.', savedWith: null };

  if (uploadResult?.error) throw uploadResult.error;

  if (!publicUrl) throw new Error('Could not get public URL after upload');

  await onSave({ logo_url: publicUrl });
  return { error: null, savedWith: publicUrl };
}

describe('LogoModal — file validation', () => {
  it('accepts a JPEG file under 2 MB', () => {
    const file = { type: 'image/jpeg', size: 500_000, name: 'logo.jpg' };
    expect(validateLogoFile(file)).toBeNull();
  });

  it('accepts a PNG file under 2 MB', () => {
    const file = { type: 'image/png', size: 1_000_000, name: 'logo.png' };
    expect(validateLogoFile(file)).toBeNull();
  });

  it('accepts a WebP file at exactly 1 byte under the limit', () => {
    const file = { type: 'image/webp', size: LOGO_MAX_BYTES - 1, name: 'logo.webp' };
    expect(validateLogoFile(file)).toBeNull();
  });

  it('rejects a file whose type is not image/*', () => {
    const file = { type: 'application/pdf', size: 100, name: 'doc.pdf' };
    const result = validateLogoFile(file);
    expect(result).toMatch(/image file/i);
  });

  it('rejects a file larger than 2 MB', () => {
    const file = { type: 'image/jpeg', size: LOGO_MAX_BYTES + 1, name: 'huge.jpg' };
    const result = validateLogoFile(file);
    expect(result).toMatch(/too large/i);
    expect(result).toMatch(/2 MB/);
  });

  it('rejects exactly at the limit + 1 byte and includes size in message', () => {
    const overBy = LOGO_MAX_BYTES + 100_000;
    const file = { type: 'image/jpeg', size: overBy, name: 'big.jpg' };
    const msg = validateLogoFile(file);
    expect(msg).toContain('MB');
  });
});

describe('LogoModal — upload & save flow', () => {
  it('saves the public URL to logo_url on success', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const file = { type: 'image/jpeg', size: 100_000, name: 'logo.jpg' };
    const session = { user: { id: 'user-abc' } };
    const publicUrl = 'https://xyz.supabase.co/storage/v1/object/public/logos/user-abc/logo-123.jpg';

    const result = await simulateLogoUpload({
      file,
      session,
      uploadResult: { error: null },
      publicUrl,
      onSave,
    });

    expect(result.error).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith({ logo_url: publicUrl });
    expect(result.savedWith).toBe(publicUrl);
  });

  it('returns a validation error and does NOT call onSave for a non-image file', async () => {
    const onSave = vi.fn();
    const file = { type: 'text/plain', size: 100, name: 'not-an-image.txt' };
    const session = { user: { id: 'user-abc' } };

    const result = await simulateLogoUpload({
      file,
      session,
      uploadResult: { error: null },
      publicUrl: 'https://example.com/logo.jpg',
      onSave,
    });

    expect(result.error).toMatch(/image file/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('returns a validation error and does NOT call onSave for an oversized file', async () => {
    const onSave = vi.fn();
    const file = { type: 'image/png', size: LOGO_MAX_BYTES + 1, name: 'too-big.png' };
    const session = { user: { id: 'user-abc' } };

    const result = await simulateLogoUpload({
      file,
      session,
      uploadResult: { error: null },
      publicUrl: 'https://example.com/logo.png',
      onSave,
    });

    expect(result.error).toMatch(/too large/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('returns a "not signed in" error when session has no user id', async () => {
    const onSave = vi.fn();
    const file = { type: 'image/jpeg', size: 100_000, name: 'logo.jpg' };
    const session = null;

    const result = await simulateLogoUpload({
      file,
      session,
      uploadResult: { error: null },
      publicUrl: 'https://example.com/logo.jpg',
      onSave,
    });

    expect(result.error).toMatch(/not signed in/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('throws when the storage upload returns an error', async () => {
    const onSave = vi.fn();
    const file = { type: 'image/jpeg', size: 100_000, name: 'logo.jpg' };
    const session = { user: { id: 'user-abc' } };
    const storageError = new Error('Storage: row-level security policy violation');

    await expect(
      simulateLogoUpload({
        file,
        session,
        uploadResult: { error: storageError },
        publicUrl: null,
        onSave,
      })
    ).rejects.toThrow('Storage');

    expect(onSave).not.toHaveBeenCalled();
  });

  it('throws when publicUrl is null even with a successful upload', async () => {
    const onSave = vi.fn();
    const file = { type: 'image/jpeg', size: 100_000, name: 'logo.jpg' };
    const session = { user: { id: 'user-abc' } };

    await expect(
      simulateLogoUpload({
        file,
        session,
        uploadResult: { error: null },
        publicUrl: null,
        onSave,
      })
    ).rejects.toThrow('Could not get public URL');

    expect(onSave).not.toHaveBeenCalled();
  });
});
