// @vitest-environment jsdom
/**
 * OhnarWordmark component tests
 *
 * Verifies that the OHNAR full logo lockup renders correctly:
 *   - Both theme variants (light + dark) are present as imgs
 *   - Both imgs are aria-hidden (decorative)
 *   - The root span carries role="img" aria-label="OHNAR" so assistive tech
 *     announces the brand name exactly once
 *   - No visible text is rendered ("OHNAR" lives only in the aria-label attribute)
 *   - The `size` prop sets font-size inline
 *   - Extra className is merged onto the root span
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import OhnarWordmark from '../OhnarWordmark';

describe('OhnarWordmark', () => {
  it('renders the light-theme lockup img pointing to /ohnar-logo.png', () => {
    const { container } = render(<OhnarWordmark />);
    const img = container.querySelector('img.ohnar-wm__lockup--light');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/ohnar-logo.png');
  });

  it('renders the dark-theme lockup img pointing to /ohnar-logo-dark.png', () => {
    const { container } = render(<OhnarWordmark />);
    const img = container.querySelector('img.ohnar-wm__lockup--dark');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/ohnar-logo-dark.png');
  });

  it('both lockup imgs are aria-hidden (decorative — root span carries the accessible name)', () => {
    const { container } = render(<OhnarWordmark />);
    const imgs = container.querySelectorAll('img.ohnar-wm__lockup');
    expect(imgs.length).toBe(2);
    imgs.forEach((img) => {
      expect(img.getAttribute('aria-hidden')).toBe('true');
      expect(img.getAttribute('alt')).toBe('');
    });
  });

  it('root span has role="img" and aria-label="OHNAR" so screen readers read the brand name once', () => {
    const { container } = render(<OhnarWordmark />);
    const root = container.querySelector('.ohnar-wm');
    expect(root).toBeTruthy();
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('OHNAR');
  });

  it('does not render "OHNAR" as plain visible text (brand name is in aria-label attribute only)', () => {
    const { container } = render(<OhnarWordmark />);
    // textContent of the whole component should be empty — no text nodes
    expect(container.textContent).toBe('');
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

  it('both lockup imgs share the .ohnar-wm__lockup base class', () => {
    const { container } = render(<OhnarWordmark />);
    const light = container.querySelector('.ohnar-wm__lockup--light');
    const dark = container.querySelector('.ohnar-wm__lockup--dark');
    expect(light.classList.contains('ohnar-wm__lockup')).toBe(true);
    expect(dark.classList.contains('ohnar-wm__lockup')).toBe(true);
  });
});
