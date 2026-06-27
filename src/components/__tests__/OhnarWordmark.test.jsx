// @vitest-environment jsdom
/**
 * OhnarWordmark component tests
 *
 * Verifies that the OHNAR brand lockup renders correctly:
 *   - The O-ring image is present and aria-hidden (decorative)
 *   - The "HNAR" text is present and aria-hidden (decorative)
 *   - The root span carries role="img" aria-label="OHNAR" so assistive tech
 *     announces the brand name exactly once
 *   - The `size` prop sets font-size inline
 *   - Extra className is merged onto the root span
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import OhnarWordmark from '../OhnarWordmark';

describe('OhnarWordmark', () => {
  it('renders the O-ring img with src pointing to the brand asset', () => {
    const { container } = render(<OhnarWordmark />);
    const img = container.querySelector('img.ohnar-wm__o');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/ohnar-O-tight-512.png');
  });

  it('img is aria-hidden (decorative — root span carries the accessible name)', () => {
    const { container } = render(<OhnarWordmark />);
    const img = container.querySelector('img.ohnar-wm__o');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('renders "HNAR" text in an aria-hidden span', () => {
    const { container } = render(<OhnarWordmark />);
    const hnar = container.querySelector('.ohnar-wm__hnar');
    expect(hnar).toBeTruthy();
    expect(hnar.textContent).toBe('HNAR');
    expect(hnar.getAttribute('aria-hidden')).toBe('true');
  });

  it('root span has role="img" and aria-label="OHNAR" so screen readers read the brand name once', () => {
    const { container } = render(<OhnarWordmark />);
    const root = container.querySelector('.ohnar-wm');
    expect(root).toBeTruthy();
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('OHNAR');
  });

  it('does not render "OHNAR" as plain visible text (would double the O next to the ring)', () => {
    const { container } = render(<OhnarWordmark />);
    // textContent of the whole component should be "HNAR" only
    // (the aria-label="OHNAR" is an attribute, not DOM text)
    expect(container.textContent).toBe('HNAR');
  });

  it('applies the size prop as inline font-size on the root span', () => {
    const { container } = render(<OhnarWordmark size="36px" />);
    const root = container.querySelector('.ohnar-wm');
    expect(root.style.fontSize).toBe('36px');
  });

  it('does not set inline font-size when size prop is omitted', () => {
    const { container } = render(<OhnarWordmark />);
    const root = container.querySelector('.ohnar-wm');
    expect(root.style.fontSize).toBe('');
  });

  it('merges extra className onto the root span', () => {
    const { container } = render(<OhnarWordmark className="pbjp-wordmark" />);
    const root = container.querySelector('.ohnar-wm');
    expect(root.classList.contains('ohnar-wm')).toBe(true);
    expect(root.classList.contains('pbjp-wordmark')).toBe(true);
  });
});
