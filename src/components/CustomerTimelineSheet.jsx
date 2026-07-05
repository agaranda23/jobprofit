/**
 * CustomerTimelineSheet — Customer Timeline, slice 1.
 *
 * A pushed sheet (over the job drawer, same chrome as DocumentsHub — shared
 * .modal-backdrop.modal-backdrop--top + .modal-sheet classes) showing every
 * logged interaction with one customer, newest first, grouped under date
 * headers. Entirely derived from props already loaded by AppShell — no
 * network call of its own.
 *
 * Rail styling (the dot + connecting line per row) reuses
 * .stage-timeline__dot / .stage-timeline__line from StageTimeline.jsx so the
 * feed reads as one continuous thread, resetting at each date-group header
 * (a header divider between two events would otherwise make a single
 * absolutely-positioned line span visually broken — resetting per group is
 * the correct fix, not a shortcut).
 */

import { useMemo, useState } from 'react';
import Icon from './Icon';
import { gbp } from '../lib/today';
import { buildWhatsAppLink } from '../lib/invoiceMessage';
import {
  normaliseCustomerName,
  getCustomerJobs,
  buildTimeline,
  bucketEvents,
  computeLifetime,
} from '../lib/customerTimeline';

const INITIAL_EVENT_LIMIT = 50;

/** Mirrors resolvePhone() duplicated across JobDetailDrawer/WorkScreen/ReviewSheet/sendQuote —
 *  same small local-helper convention rather than a shared import (see those files). */
function resolvePhone(job) {
  return job?.customerPhone || job?.phone || job?.mobile || job?.whatsapp || '';
}

/** Mirrors buildMapsUrl() in JobDetailDrawer.jsx — platform-aware Maps deep-link. */
function buildMapsUrl(addr) {
  const enc = encodeURIComponent(addr);
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return `https://maps.apple.com/?q=${enc}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${enc}`;
}

function fmtShort(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

/** Most recently created job in the list that satisfies `predicate`, or undefined. */
function mostRecentWith(jobs, predicate) {
  return [...jobs]
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
    .find(predicate);
}

export default function CustomerTimelineSheet({
  job,
  jobs,
  receipts,
  onClose,
  onSelectJob,
  onAddNote,
  onAddPhone,
}) {
  // R1 — all hooks declared before any early return (see PR #125 trap, and
  // DocumentsHub.jsx's GatedSignature for the same pattern in this codebase).
  const [showAll, setShowAll] = useState(false);

  const customerJobs = useMemo(() => getCustomerJobs(job, jobs), [job, jobs]);
  const events = useMemo(() => buildTimeline(customerJobs, receipts), [customerJobs, receipts]);
  const visibleEvents = showAll ? events : events.slice(0, INITIAL_EVENT_LIMIT);
  const groups = useMemo(() => bucketEvents(visibleEvents), [visibleEvents]);
  const lifetime = useMemo(() => computeLifetime(customerJobs), [customerJobs]);

  if (!job) return null;

  const customerName = (job.customer || '').trim() || 'Customer';
  const firstName = customerName.split(/\s+/)[0] || customerName;

  const phoneJob = mostRecentWith(customerJobs, j => !!resolvePhone(j));
  const addressJob = mostRecentWith(customerJobs, j => !!j?.address);
  const phone = phoneJob ? resolvePhone(phoneJob) : '';
  const address = addressJob ? addressJob.address : '';
  const hasContact = !!phone || !!address;

  const smsLink = phone ? `sms:${phone}?body=${encodeURIComponent(`Hi ${firstName}, `)}` : '';
  const waLink = phone ? buildWhatsAppLink({ phone, message: `Hi ${firstName}, ` }) : '';

  const hasMore = events.length > INITIAL_EVENT_LIMIT && !showAll;

  const handleSelect = (ev) => {
    if (!onSelectJob) return;
    const target = customerJobs.find(j => String(j.id) === String(ev.jobId)) || job;
    onSelectJob(target);
  };

  return (
    <div className="modal-backdrop modal-backdrop--top" onClick={onClose}>
      <div
        className="modal-sheet ct-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Timeline with ${customerName}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-sheet-header">
          <h2 className="modal-sheet-title">{customerName}</h2>
          <button type="button" className="modal-sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Contact chips — same shape/classes as the JobDetailDrawer header action
            row (.jd-header-action-row / .jt-action-btn), so they read as the same
            control even though this sheet renders its own copy (no shared JS
            coupling to a 4,600-line file's module-scoped helpers). */}
        {hasContact ? (
          <div className="jd-header-action-row ct-contact-row">
            {phone ? (
              <a href={`tel:${phone}`} className="jt-action-btn" aria-label={`Call ${firstName}`}>
                <Icon name="phone" size={16} /><span>Call</span>
              </a>
            ) : (
              <button type="button" className="jt-action-btn jt-action-btn--missing" onClick={onAddPhone} aria-label="Add a phone number to call">
                <Icon name="phone" size={16} /><span>Call</span>
              </button>
            )}
            {phone ? (
              <a href={smsLink} className="jt-action-btn" aria-label={`Text ${firstName}`}>
                <Icon name="text" size={16} /><span>Text</span>
              </a>
            ) : (
              <button type="button" className="jt-action-btn jt-action-btn--missing" onClick={onAddPhone} aria-label="Add a phone number to text">
                <Icon name="text" size={16} /><span>Text</span>
              </button>
            )}
            {phone ? (
              <button
                type="button"
                className="jt-action-btn"
                aria-label={`WhatsApp ${firstName}`}
                onClick={() => window.open(waLink, '_blank', 'noopener')}
              >
                <Icon name="whatsapp" size={16} /><span>WhatsApp</span>
              </button>
            ) : (
              <button type="button" className="jt-action-btn jt-action-btn--missing" onClick={onAddPhone} aria-label="Add a phone number to message on WhatsApp">
                <Icon name="whatsapp" size={16} /><span>WhatsApp</span>
              </button>
            )}
            <button
              type="button"
              className={`jt-action-btn${address ? '' : ' jt-action-btn--missing'}`}
              aria-label={address ? `Navigate to ${address}` : 'Add address'}
              onClick={() => { if (address) window.open(buildMapsUrl(address), '_blank', 'noopener'); }}
            >
              <Icon name="navigate" size={16} /><span>Map</span>
            </button>
          </div>
        ) : (
          <button type="button" className="ct-add-contact-btn" onClick={onAddPhone}>
            + Add phone to call or text in one tap
          </button>
        )}

        {/* Lifetime strip */}
        <div className="ct-lifetime-strip">
          <span>{gbp(lifetime.billed)} billed</span>
          <span className="ct-lifetime-dot" aria-hidden="true">·</span>
          <span>{gbp(lifetime.paid)} paid</span>
          {lifetime.owed > 0 && (
            <>
              <span className="ct-lifetime-dot" aria-hidden="true">·</span>
              <span className="ct-lifetime-owed">{gbp(lifetime.owed)} owed</span>
            </>
          )}
          <span className="ct-lifetime-dot" aria-hidden="true">·</span>
          <span>{lifetime.jobCount} job{lifetime.jobCount === 1 ? '' : 's'}</span>
        </div>

        {/* Feed */}
        <div className="ct-feed">
          {events.length <= 1 ? (
            <div className="ct-empty-state">
              <p className="ct-empty-title">This is the start with {firstName}.</p>
              <p className="ct-empty-sub">
                Every quote, invoice, payment and note you log will show up here — the whole story in one place.
              </p>
              {onAddNote && (
                <button type="button" className="ct-empty-action" onClick={onAddNote}>
                  + Add a note
                </button>
              )}
            </div>
          ) : (
            <>
              {groups.map(group => (
                <div key={group.label} className="ct-date-group">
                  <div className="ct-date-header">{group.label}</div>
                  <div className="stage-timeline" role="list">
                    {group.events.map((ev, i) => (
                      <div key={`${ev.jobId}-${ev.type}-${ev.ts}-${i}`} className="stage-timeline__item ct-event" role="listitem">
                        {i !== 0 && (
                          <div className="stage-timeline__line stage-timeline__line--reached" aria-hidden="true" />
                        )}
                        <div className="stage-timeline__dot stage-timeline__dot--reached" aria-hidden="true" />
                        <button
                          type="button"
                          className="ct-event-btn"
                          onClick={() => handleSelect(ev)}
                          aria-label={`${ev.summary}${ev.sub ? ' · ' + ev.sub : ''}, go to job`}
                        >
                          <span className="ct-event-icon"><Icon name={ev.icon} size={16} variant="muted" /></span>
                          <span className="ct-event-body">
                            <span className="ct-event-summary">{ev.summary}</span>
                            {ev.sub && <span className="ct-event-sub">{ev.sub}</span>}
                          </span>
                          <span className="ct-event-date">{fmtShort(ev.ts)}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {hasMore && (
                <button type="button" className="ct-show-earlier" onClick={() => setShowAll(true)}>
                  Show earlier
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
