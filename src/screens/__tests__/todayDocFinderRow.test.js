/**
 * JP-LU3 — Today doc-finder row removed
 *
 * Node-env source-guard tests (no jsdom needed):
 *
 *   TodayScreen.jsx
 *     1. Does NOT contain the 'foreman-view-group' CSS class (wrapper div removed).
 *     2. Does NOT contain the 'foreman-view-btn' CSS class (view buttons removed).
 *     3. Does NOT import DocumentSearchOverlay (import line deleted).
 *     4. Does NOT declare a 'docOverlay' state variable (useState call deleted).
 *
 * WorkScreen is not checked here — its own DocumentSearchOverlay wiring is untouched.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TODAY_JSX = path.resolve(__dirname, '../TodayScreen.jsx');
const todaySrc  = fs.readFileSync(TODAY_JSX, 'utf8');

describe('TodayScreen.jsx — doc-finder row removed (JP-LU3)', () => {
  it('does not contain foreman-view-group class', () => {
    expect(todaySrc).not.toContain('foreman-view-group');
  });

  it('does not contain foreman-view-btn class', () => {
    expect(todaySrc).not.toContain('foreman-view-btn');
  });

  it('does not import DocumentSearchOverlay', () => {
    expect(todaySrc).not.toContain('DocumentSearchOverlay');
  });

  it('does not declare a docOverlay state variable', () => {
    expect(todaySrc).not.toContain('docOverlay');
  });
});
