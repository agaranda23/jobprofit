import { useState } from 'react';

/**
 * MoreDisclosure — tappable row that reveals Photos and Notes.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Full-width row at the bottom of the drawer body
 *   - Light grey background, green dot when hasContent is true
 *   - summary string is built by the parent (e.g. "Photos (3) · Notes (2)")
 *   - Tap expands all children below in sequence (not a tab strip)
 *   - Tap again collapses
 *
 * Note on Schedule: per PRD, Schedule stays at the spine (SpineBlock) in Step 2.
 * The word "Schedule" is NOT in the More label. If schedule grows (multi-day,
 * shifts) it can move here in Step 3+.
 *
 * Props:
 *   summary    – string – e.g. "Photos (3) · Notes (2)"
 *   hasContent – boolean – when true, a green indicator dot shows
 *   children   – the sections to reveal (PhotosSection + NotesSection)
 */
export default function MoreDisclosure({ summary, hasContent = false, children }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="jd-more">
      <button
        type="button"
        className="jd-more-row"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="jd-more-left">
          {hasContent && (
            <span className="jd-more-dot" aria-hidden="true" />
          )}
          <span className="jd-more-label">More</span>
          {summary && (
            <span className="jd-more-summary"> · {summary}</span>
          )}
        </span>
        <span className="jd-more-chev" aria-hidden="true">
          {open ? '▴' : '⌄'}
        </span>
      </button>

      {open && (
        <div className="jd-more-body">
          {children}
        </div>
      )}
    </div>
  );
}
