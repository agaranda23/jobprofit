/**
 * secureImageUrl.js — unit tests.
 *
 * No DOM, no React, no Supabase. Pure logic.
 *
 * Covers the mixed-content bug: an old http:// logo_url must render as
 * https:// everywhere it's used (LogoModal.jsx, public invoice/receipt
 * pages, Settings, DocumentPreview, the PDF logo fetch) — this is the
 * single helper all of those call sites share.
 */

import { describe, it, expect } from 'vitest';
import { secureImageUrl } from '../secureImageUrl';

describe('secureImageUrl', () => {
  it('upgrades a bare http:// URL to https://', () => {
    expect(secureImageUrl('http://example.com/logo.png')).toBe('https://example.com/logo.png');
  });

  it('upgrades http:// case-insensitively', () => {
    expect(secureImageUrl('HTTP://example.com/logo.png')).toBe('https://example.com/logo.png');
  });

  it('upgrades a Supabase-style http:// storage URL', () => {
    const url = 'http://xyzco.supabase.co/storage/v1/object/public/logos/u1/logo-123.png';
    expect(secureImageUrl(url)).toBe(
      'https://xyzco.supabase.co/storage/v1/object/public/logos/u1/logo-123.png'
    );
  });

  it('leaves an already-https:// URL untouched', () => {
    const url = 'https://example.com/logo.png';
    expect(secureImageUrl(url)).toBe(url);
  });

  it('leaves a protocol-relative // URL untouched', () => {
    const url = '//cdn.example.com/logo.png';
    expect(secureImageUrl(url)).toBe(url);
  });

  it('leaves a data: URI untouched', () => {
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
    expect(secureImageUrl(url)).toBe(url);
  });

  it('leaves an empty string untouched', () => {
    expect(secureImageUrl('')).toBe('');
  });

  it('leaves null untouched', () => {
    expect(secureImageUrl(null)).toBeNull();
  });

  it('leaves undefined untouched', () => {
    expect(secureImageUrl(undefined)).toBeUndefined();
  });

  it('does not touch a URL that merely contains "http://" mid-string', () => {
    // e.g. a URL shortener/redirect param — only a LEADING http:// is rewritten
    const url = 'https://example.com/redirect?to=http://other.com/x.png';
    expect(secureImageUrl(url)).toBe(url);
  });
});
