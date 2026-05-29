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
 * Start a Stripe Checkout session for the Pro subscription.
 * On success the browser is redirected to Stripe — this function does not return.
 *
 * @returns {Promise<{ error?: string }>}
 */
export async function startCheckout() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      return { error: 'You must be signed in to upgrade' };
    }

    const res = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { error: body.error || 'Could not start checkout — please try again' };
    }

    if (!body.url) {
      return { error: 'No checkout URL returned — please try again' };
    }

    window.location.href = body.url;
    // Browser is now navigating away — nothing else runs
    return {};
  } catch (err) {
    console.error('billing: startCheckout failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}

/**
 * Open the Stripe Billing Portal so the user can manage or cancel their subscription.
 * On success the browser is redirected to Stripe — this function does not return.
 *
 * @returns {Promise<{ error?: string }>}
 */
export async function openBillingPortal() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      return { error: 'You must be signed in to manage billing' };
    }

    const res = await fetch('/.netlify/functions/create-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { error: body.error || 'Could not open billing portal — please try again' };
    }

    if (!body.url) {
      return { error: 'No portal URL returned — please try again' };
    }

    window.location.href = body.url;
    return {};
  } catch (err) {
    console.error('billing: openBillingPortal failed', err?.message);
    return { error: 'Could not reach the server — check your connection and try again' };
  }
}
