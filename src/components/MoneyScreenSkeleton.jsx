/**
 * MoneyScreenSkeleton — loading placeholder for the Money (Finance) screen.
 *
 * Shown while profile === null (the ~200–600ms window between Splash exit
 * and the first Supabase profile response). Matches the actual layout of:
 *   1. The "money in 5 seconds" strip (three equal cells)
 *   2. The profit hero card (label + big figure + meta line + YTD line)
 *   3. The two-up stat cards (Paid in / Jobs done)
 *
 * Does NOT introduce an artificial minimum time — if profile loads before
 * the first paint the skeleton is never mounted.
 */
import Skeleton from './Skeleton';

export default function MoneyScreenSkeleton() {
  return (
    <div className="money-skeleton" aria-label="Loading money data" aria-busy="true">

      {/* 1. Five-second strip — three equal cells separated by hairlines */}
      <div className="money-skeleton__strip" role="presentation">
        <div className="money-skeleton__strip-cell">
          <Skeleton w="52px" h="18px" radius="var(--radius-xs)" />
          <Skeleton w="36px" h="11px" radius="var(--radius-xs)" />
        </div>
        <div className="money-skeleton__strip-divider" aria-hidden="true" />
        <div className="money-skeleton__strip-cell">
          <Skeleton w="52px" h="18px" radius="var(--radius-xs)" />
          <Skeleton w="36px" h="11px" radius="var(--radius-xs)" />
        </div>
        <div className="money-skeleton__strip-divider" aria-hidden="true" />
        <div className="money-skeleton__strip-cell">
          <Skeleton w="52px" h="18px" radius="var(--radius-xs)" />
          <Skeleton w="36px" h="11px" radius="var(--radius-xs)" />
        </div>
      </div>

      {/* 2. Hero profit card — label + big figure + two sub-lines */}
      <div className="money-skeleton__hero" role="presentation">
        <Skeleton w="110px" h="11px" radius="var(--radius-xs)" />
        <Skeleton w="140px" h="46px" radius="var(--radius-sm)" />
        <Skeleton w="180px" h="14px" radius="var(--radius-xs)" />
        <Skeleton w="140px" h="12px" radius="var(--radius-xs)" />
      </div>

      {/* 3. Two-up stat cards */}
      <div className="money-skeleton__twoup" role="presentation">
        <div className="money-skeleton__twoup-card">
          <Skeleton w="56px" h="11px" radius="var(--radius-xs)" />
          <Skeleton w="72px" h="22px" radius="var(--radius-xs)" />
        </div>
        <div className="money-skeleton__twoup-card">
          <Skeleton w="56px" h="11px" radius="var(--radius-xs)" />
          <Skeleton w="40px" h="22px" radius="var(--radius-xs)" />
        </div>
      </div>

    </div>
  );
}
