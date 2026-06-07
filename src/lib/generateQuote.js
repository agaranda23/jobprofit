// Call the generate-quote Netlify function to build an AI-itemised quote.
// Mirrors the error-handling pattern in receiptOCR.js.
//
// Returns:
//   { lineItems, total, vatRegistered, hourlyRate }   — success
//   { error: string }                                  — any failure
//   { error: 'quota_exceeded', message, quota, used } — free tier exhausted

import { supabase } from './supabase';

/**
 * Calls the generate-quote function and returns structured line items.
 * Attaches the user's Supabase JWT as a Bearer token so the function can
 * verify the caller's identity without exposing the service-role key.
 *
 * @param {string} description - rough job description (from voice or text)
 * @returns {Promise<{lineItems, total, vatRegistered, hourlyRate}|{error:string}>}
 */
export async function generateQuote(description) {
  const text = (description || '').trim();
  if (!text) return { error: 'No description provided' };

  // Get the current session token so the server-side function can verify identity
  let accessToken;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token;
  } catch (_e) {
    return { error: 'Not signed in' };
  }

  if (!accessToken) {
    return { error: 'Not signed in' };
  }

  let res;
  try {
    res = await fetch('/.netlify/functions/generate-quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ description: text }),
    });
  } catch (e) {
    return { error: 'Network failure: ' + e.message };
  }

  let data;
  try {
    data = await res.json();
  } catch (_e) {
    return { error: 'Bad response from server' };
  }

  // Quota exceeded — surface a structured error for the UI to handle
  if (res.status === 402 || data?.error === 'quota_exceeded') {
    return {
      error: 'quota_exceeded',
      message: data?.message || "You've used your free AI quotes this month.",
      quota: data?.quota,
      used: data?.used,
    };
  }

  if (!res.ok || data?.error) {
    return { error: data?.error || `Server error (${res.status})` };
  }

  // Validate returned shape
  if (!Array.isArray(data?.lineItems) || data.lineItems.length === 0) {
    return { error: 'AI returned no line items' };
  }

  return {
    lineItems: data.lineItems,
    total: typeof data.total === 'number' ? data.total : null,
    vatRegistered: !!data.vatRegistered,
    hourlyRate: data.hourlyRate ?? null,
  };
}
