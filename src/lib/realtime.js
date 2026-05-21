/**
 * Phase H — Realtime subscription helper for the `jobs` table.
 *
 * Usage:
 *   const unsub = subscribeToJobs(userId, onChange);
 *   // ... later, on signout or unmount:
 *   unsub();
 *
 * The onChange callback receives the raw supabase-js postgres_changes payload.
 * Callers are responsible for deciding what to do with it (typically refetch).
 *
 * Performance note: at sole-trader scale (<1000 jobs) a full refetch on every
 * change event is fast enough. If this ever needs finer granularity (e.g. parse
 * only the changed row from the payload), that can be done without touching this
 * module — just update the onChange handler in the caller.
 *
 * Multi-tab: each tab creates its own channel. Events fire in all tabs
 * simultaneously. Refetches are idempotent, so this is safe and expected.
 *
 * Reconnection: supabase-js handles reconnect automatically. The subscribe()
 * callback fires with status='SUBSCRIBED' after every (re)connect. Callers
 * should do an immediate refetch on that status to catch any missed events.
 */

import { supabase } from './supabase';

/**
 * Subscribes to postgres_changes events on public.jobs filtered to the given
 * user's rows. Listens to INSERT, UPDATE, and DELETE.
 *
 * @param {string}   userId    – the authenticated user's UUID
 * @param {Function} onChange  – called with (payload) on every change event
 * @param {Function} [onReconnect] – called with no args when the channel
 *                               reconnects after a disconnect. Typically used
 *                               to trigger an immediate refetch to catch missed
 *                               events. If omitted, no action on reconnect.
 * @returns {Function} unsub   – call this to tear down the channel cleanly
 */
export function subscribeToJobs(userId, onChange, onReconnect) {
  if (!userId) {
    console.warn('subscribeToJobs: no userId — skipping subscription');
    return () => {};
  }

  const channelName = `jobs:user-${userId}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onChange(payload);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && typeof onReconnect === 'function') {
        // Fire on every successful (re)subscribe so the caller can refetch
        // to catch events that arrived while the channel was reconnecting.
        onReconnect();
      }
      if (status === 'CHANNEL_ERROR') {
        console.warn('realtime channel error on', channelName);
      }
    });

  return () => {
    supabase.removeChannel(channel).catch((err) => {
      console.warn('realtime unsub failed for', channelName, err?.message);
    });
  };
}
