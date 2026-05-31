/**
 * whatsNew — changelog entries for the "What's new" row in Settings.
 *
 * Add new entries at the TOP of the array (newest first).
 * Each entry: { date, title, emoji, blurb }
 *   date  — ISO date string (YYYY-MM-DD), displayed as e.g. "31 May 2026"
 *   title — short feature name, shown bold
 *   emoji — single emoji for visual scanning
 *   blurb — one sentence explaining the value, no internal jargon
 */

export const WHATS_NEW = [
  {
    date: '2026-05-30',
    title: 'Photo gallery picker',
    emoji: '📷',
    blurb: 'Pick photos from your camera roll directly when logging job evidence — no more camera-only restriction.',
  },
  {
    date: '2026-05-29',
    title: 'Offline reliability',
    emoji: '📶',
    blurb: 'Jobs and updates queue locally when you lose signal and sync automatically when you are back online.',
  },
  {
    date: '2026-05-28',
    title: 'Chase reminders list',
    emoji: '🔔',
    blurb: 'See every overdue invoice ranked by days outstanding — tap a row to jump straight to the job.',
  },
  {
    date: '2026-05-27',
    title: 'CSV export',
    emoji: '📊',
    blurb: 'Export all your jobs and revenue to a spreadsheet in one tap — ready to send to your accountant.',
  },
  {
    date: '2026-05-24',
    title: 'Jobs-tab search',
    emoji: '🔍',
    blurb: 'Search across all your jobs by customer name, description, or amount — results update as you type.',
  },
  {
    date: '2026-05-22',
    title: 'Part-paid chip',
    emoji: '💰',
    blurb: 'Jobs with a partial payment now show a "Part paid" chip so you always know what is still outstanding.',
  },
  {
    date: '2026-05-21',
    title: 'Quote-accepted notifications',
    emoji: '✅',
    blurb: 'Get a push notification the moment a customer signs your quote — even when the app is closed.',
  },
  {
    date: '2026-05-20',
    title: 'Send receipts',
    emoji: '🧾',
    blurb: 'Generate and share a professional receipt PDF straight from any paid job — one tap, done.',
  },
  {
    date: '2026-05-15',
    title: 'Create-quote flow',
    emoji: '📝',
    blurb: 'Build a quote with line items using voice or text, then send a link to the customer to sign on their phone.',
  },
];

/**
 * Format a YYYY-MM-DD date string as "D Month YYYY" (e.g. "31 May 2026").
 * @param {string} isoDate
 * @returns {string}
 */
export function formatWhatsNewDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
