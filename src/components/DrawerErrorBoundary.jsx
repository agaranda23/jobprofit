/**
 * DrawerErrorBoundary — wraps JobDetailDrawer so a render crash shows a tappable
 * fallback instead of a blank white screen.
 *
 * Resets automatically when the `jobId` key changes (user opens a different job).
 * This is intentional: the drawer is keyed by jobId in WorkScreen so switching
 * jobs always mounts a fresh boundary with no prior error state.
 *
 * This is now a thin wrapper around AppErrorBoundary (variant="drawer") so the
 * same fallback UI lives in one place.  All existing props (onClose, children)
 * are forwarded unchanged.
 */
import AppErrorBoundary from './AppErrorBoundary';
export default AppErrorBoundary;
