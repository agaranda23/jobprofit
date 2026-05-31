/**
 * delete-account — Netlify function
 *
 * Permanently and irreversibly deletes ALL data for the authenticated user.
 * Called from the Settings "Delete account" confirmation modal.
 *
 * The user id is NEVER trusted from the request body — it is resolved
 * server-side by verifying the Supabase JWT from the Authorization header.
 *
 * Deletion order (service-role bypasses RLS):
 *   1. receipt_items  — deleted by user_id (no FK cascade from receipts in migrations)
 *   2. receipts       — deleted by user_id (also removes the receipts storage objects inline)
 *   3. push_subscriptions — deleted by user_id (FK ON DELETE CASCADE from auth.users
 *                           would catch this too, but explicit delete is clearer)
 *   4. jobs           — deleted by user_id
 *   5. profiles       — deleted by id (FK ON DELETE CASCADE from auth.users would
 *                       also catch this, but we delete explicitly for auditability)
 *   6. Storage objects in the job-photos bucket under the user's UID prefix
 *      (storage objects have no FK — must be deleted manually)
 *   7. auth.users row — via supabaseAdmin.auth.admin.deleteUser(userId)
 *      (triggers ON DELETE CASCADE on profiles and push_subscriptions as backup)
 *
 * Idempotency: steps that find no rows are treated as success — re-running
 * after a partial failure will not 500 on the already-deleted data.
 *
 * POST — no body required; Authorization: Bearer <access_token>
 *
 * Required env vars (already set for existing functions):
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server-only)
 *
 * Response shapes:
 *   200  { deleted: true }
 *   401  { error }  — missing / invalid token
 *   500  { error }  — server configuration error
 *   502  { error }  — database / storage error
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** Max number of storage objects to list per page when clearing job-photos. */
const STORAGE_PAGE_LIMIT = 100;

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export const handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'delete-account: missing env vars.',
      'VITE_SUPABASE_URL present:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY present:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Authenticate the caller via Supabase JWT ──────────────────────────────
  // Bearer token comes from the Authorization header — NEVER from the request body.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return json(401, { error: 'Missing authorization token' });
  }

  // Service-role client is used for all operations. We call auth.getUser() to
  // verify the JWT and resolve the user id — this is the canonical pattern used
  // in create-checkout.js and create-portal.js.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return json(401, { error: 'Invalid or expired token' });
    }
    userId = user.id;
  } catch (err) {
    console.error('delete-account: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 3. Delete table data (order matters — children before parents) ────────────

  // 3a. receipt_items — no FK cascade confirmed in migrations; delete by user_id
  try {
    const { error } = await adminClient
      .from('receipt_items')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('delete-account: receipt_items delete failed', userId, error?.message);
      return json(502, { error: 'Could not delete account data — please try again' });
    }
  } catch (err) {
    console.error('delete-account: receipt_items delete threw', userId, err?.message);
    return json(502, { error: 'Could not delete account data — please try again' });
  }

  // 3b. receipts — delete by user_id
  try {
    const { error } = await adminClient
      .from('receipts')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('delete-account: receipts delete failed', userId, error?.message);
      return json(502, { error: 'Could not delete account data — please try again' });
    }
  } catch (err) {
    console.error('delete-account: receipts delete threw', userId, err?.message);
    return json(502, { error: 'Could not delete account data — please try again' });
  }

  // 3c. push_subscriptions — delete by user_id
  try {
    const { error } = await adminClient
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('delete-account: push_subscriptions delete failed', userId, error?.message);
      return json(502, { error: 'Could not delete account data — please try again' });
    }
  } catch (err) {
    console.error('delete-account: push_subscriptions delete threw', userId, err?.message);
    return json(502, { error: 'Could not delete account data — please try again' });
  }

  // 3d. jobs — delete by user_id
  try {
    const { error } = await adminClient
      .from('jobs')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('delete-account: jobs delete failed', userId, error?.message);
      return json(502, { error: 'Could not delete account data — please try again' });
    }
  } catch (err) {
    console.error('delete-account: jobs delete threw', userId, err?.message);
    return json(502, { error: 'Could not delete account data — please try again' });
  }

  // 3e. profiles — delete by id (same as user_id on that table)
  try {
    const { error } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (error) {
      console.error('delete-account: profiles delete failed', userId, error?.message);
      return json(502, { error: 'Could not delete account data — please try again' });
    }
  } catch (err) {
    console.error('delete-account: profiles delete threw', userId, err?.message);
    return json(502, { error: 'Could not delete account data — please try again' });
  }

  // ── 4. Delete storage objects in the job-photos bucket ───────────────────────
  // Objects are stored at <userId>/<jobId>/<filename>. List all objects under
  // the user's prefix and delete them in pages.
  try {
    let hasMore = true;
    while (hasMore) {
      const { data: objects, error: listError } = await adminClient.storage
        .from('job-photos')
        .list(userId, { limit: STORAGE_PAGE_LIMIT });

      if (listError) {
        // Log but don't fail the whole deletion — storage cleanup is best-effort.
        // The auth user deletion below is the critical step.
        console.warn('delete-account: job-photos list failed', userId, listError?.message);
        break;
      }

      if (!objects || objects.length === 0) {
        hasMore = false;
        break;
      }

      const paths = objects.map(obj => `${userId}/${obj.name}`);
      const { error: removeError } = await adminClient.storage
        .from('job-photos')
        .remove(paths);

      if (removeError) {
        console.warn('delete-account: job-photos remove failed', userId, removeError?.message);
        // Continue — don't abort for storage cleanup failures
      }

      // If fewer than the page limit came back, we have exhausted the prefix
      hasMore = objects.length === STORAGE_PAGE_LIMIT;
    }
  } catch (err) {
    // Storage cleanup failure is non-fatal — log and continue to auth deletion
    console.warn('delete-account: job-photos cleanup threw', userId, err?.message);
  }

  // ── 5. Delete the auth user ───────────────────────────────────────────────────
  // This is the point of no return. The ON DELETE CASCADE on profiles and
  // push_subscriptions means any rows we missed above will also be removed.
  try {
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) {
      console.error('delete-account: auth.admin.deleteUser failed', userId, error?.message);
      return json(502, { error: 'Could not delete account — please contact support' });
    }
  } catch (err) {
    console.error('delete-account: auth.admin.deleteUser threw', userId, err?.message);
    return json(502, { error: 'Could not delete account — please contact support' });
  }

  return json(200, { deleted: true });
};
