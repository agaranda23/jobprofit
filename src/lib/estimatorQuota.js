/**
 * estimatorQuota.js — client-side wrapper for the work-it-out-quota function.
 *
 * Mirrors the pattern from generateQuote.js: attach Supabase JWT, call the
 * Netlify function, return a structured result.
 *
 * Functions:
 *   checkEstimatorQuota()   → { allowed, used, quota, isPro }
 *   incrementEstimatorQuota() → { newCount } | { error }
 *
 * On any failure, checkEstimatorQuota() returns { allowed: true, isPro: false }
 * so the flow is never blocked by a transient network error.
 */

import { supabase } from './supabase';

async function getAccessToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks the current user's estimator quota.
 * Safe to call before opening the estimator sheet.
 *
 * @returns {Promise<{ allowed: boolean, used: number, quota: number, isPro: boolean }>}
 */
export async function checkEstimatorQuota() {
  const token = await getAccessToken();
  if (!token) return { allowed: true, used: 0, quota: 3, isPro: false };

  try {
    const res = await fetch('/.netlify/functions/work-it-out-quota', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'check' }),
    });

    if (!res.ok) return { allowed: true, used: 0, quota: 3, isPro: false };
    const data = await res.json();
    return {
      allowed: data.allowed ?? true,
      used:    data.used    ?? 0,
      quota:   data.quota   ?? 3,
      isPro:   data.isPro   ?? false,
    };
  } catch {
    // Network failure — allow the flow to proceed (optimistic)
    return { allowed: true, used: 0, quota: 3, isPro: false };
  }
}

/**
 * Increments the estimator quota counter after a successful result delivery.
 * Fire-and-forget — failures are silent (worst case: 1 extra free use).
 *
 * @returns {Promise<{ newCount: number } | { error: string }>}
 */
export async function incrementEstimatorQuota() {
  const token = await getAccessToken();
  if (!token) return { error: 'Not signed in' };

  try {
    const res = await fetch('/.netlify/functions/work-it-out-quota', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'increment' }),
    });

    const data = await res.json();
    if (res.status === 402 || data?.error === 'quota_exceeded') {
      return { error: 'quota_exceeded', message: data?.message };
    }
    if (!res.ok || data?.error) return { error: data?.error || 'Server error' };
    return { newCount: data.newCount ?? 0 };
  } catch (err) {
    return { error: err?.message || 'Network failure' };
  }
}
