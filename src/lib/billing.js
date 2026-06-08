/**
 * billing.js — client-side helpers for Stripe Checkout + Billing Portal.
 *
 * Both helpers get the current Supabase session token, POST to the matching
 * Netlify function, then redirect the browser to the returned Stripe URL.
 *
 * Error contract: both functions return { error: string } on failure so the
 * caller can show a message without crashing. They never throw.
 *
 * Usage:
 *   const { error } = await startCheckout();
 *   if (error) showMessage(error);
 *
 *   const { error } = await openBillingPortal();
 *   if (error) showMessage(error);
 */

import { supabase } from './supabase.js';

/**
 * Internal helper — POST to a Netlify billing function with optional body params.
 * Returns the parsed JSON body on success, or { error } on failure.
 *
 * @param {string} path — e.g. '/.netlify/functions/create-checkout'
 * @param {Record<string,unknown>} [body] — extra fields merged into POST body
 * @returns {Promise<{ url?: string, error?: string }>}
 */
async function _billingPost(path, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { error: 'You must be signed in to continue' };

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });

  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) return { error: parsed.error || 'Request failed — please try again' };
  if (!parsed.url) return { error: 'No checkout URL returned — please try again' };
  return parsed;
}

/**
 * Start a Stripe Checkout session for the Pro subscription.
 * On success the browser is redirected to Stripe — this function does not return.
 *
 * @returns {Promise<{ error?: string }>}
 */
export async function startCheckout() {
  try {
    const result = await _billingPost('/.netlify/functions/create-checkout');
    if (result.error) return result;
    window.location.href = result.url;
    return {};
  } catch (err) {
    console.error('billing: startCheckout failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}

/**
 * Moment-1 checkout — add a card, get +1 month free, then £12/mo from chargeDate.
 *
 * Passes coupon_id to create-checkout so the Netlify function applies the
 * Stripe coupon. The coupon must be created in the Stripe Dashboard first —
 * see PR description for the exact spec.
 *
 * STUB: the coupon_id env var (STRIPE_TRIAL_EXTENSION_COUPON_ID) must be set
 * in Netlify. Until it is, this falls back to startCheckout() without a coupon
 * (still functional; founder must complete the Stripe setup to get the free month).
 *
 * @param {{ source?: string }} [opts]
 * @returns {Promise<{ error?: string }>}
 */
export async function startCheckoutWithCoupon(opts = {}) {
  try {
    const result = await _billingPost('/.netlify/functions/create-checkout', {
      coupon_mode: 'trial_extension',
      source: opts.source ?? 'trial_end',
    });
    if (result.error) return result;
    window.location.href = result.url;
    return {};
  } catch (err) {
    console.error('billing: startCheckoutWithCoupon failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}

/**
 * Moment-2 checkout — immediate £12/mo, no coupon, charged today.
 * Used when the trial has already expired and the user taps "Go Pro — £12/month".
 *
 * @param {{ source?: string }} [opts]
 * @returns {Promise<{ error?: string }>}
 */
export async function startCheckoutImmediate(opts = {}) {
  try {
    const result = await _billingPost('/.netlify/functions/create-checkout', {
      coupon_mode: 'none',
      source: opts.source ?? 'drop_to_free',
    });
    if (result.error) return result;
    window.location.href = result.url;
    return {};
  } catch (err) {
    console.error('billing: startCheckoutImmediate failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}

/**
 * Open the Stripe Billing Portal so the user can manage or cancel their subscription.
 * On success the browser is redirected to Stripe — this function does not return.
 * Cancel = 2 taps from Settings (this row + portal CTA) with instant effect.
 *
 * @returns {Promise<{ error?: string }>}
 */
export async function openBillingPortal() {
  try {
    const result = await _billingPost('/.netlify/functions/create-portal');
    if (result.error) return result;
    window.location.href = result.url;
    return {};
  } catch (err) {
    console.error('billing: openBillingPortal failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}
