/**
 * Regression test: TodayScreen must import supabase so recordChaseCloud
 * does not throw a ReferenceError when the Today chase CTA fires.
 *
 * Bug: lines ~249 and ~271 called recordChaseCloud(promptJob.id, supabase)
 * but supabase was never imported → ReferenceError on first chase tap.
 * Fix: added `import { supabase } from '../lib/supabase'` to TodayScreen.jsx.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../TodayScreen.jsx'),
  'utf8',
);

describe('TodayScreen — supabase import regression', () => {
  it('imports supabase from lib/supabase so recordChaseCloud does not ReferenceError', () => {
    // The import must be present; without it every chase tap on the Today tab
    // throws "ReferenceError: supabase is not defined".
    expect(SRC).toContain("import { supabase } from '../lib/supabase'");
  });

  it('calls recordChaseCloud with the imported supabase reference', () => {
    // Both call-sites must pass `supabase` (not undefined / some other identifier).
    const matches = (SRC.match(/recordChaseCloud\([^)]+,\s*supabase\)/g) || []);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
