/**
 * Icon — the single import point for all icons in JobProfit.
 *
 * Nobody in the codebase should import lucide-react directly.
 * Swap an icon later by changing one registry entry here.
 *
 * Props
 * ─────
 * name        {string}  — Semantic key from REGISTRY (e.g. "today", "money").
 *                         Unknown name renders nothing + console.warn in dev.
 * size        {16|20|24|32}  — Pixel size. Default 20.
 * variant     {"inherit"|"muted"|"brand"|"danger"|"success"}
 *                         — Maps to a CSS custom property (see VARIANT_COLOR).
 *                           Default "inherit" (inherits `color` from parent).
 * strokeWidth {number}  — SVG stroke-width. Default 2; auto 1.5 when size===32.
 * label       {string}  — If set → role="img" + aria-label (decorative if omitted).
 * className   {string}  — Extra class for layout/spacing only. Never use for colour.
 */

import {
  Home,
  LayoutGrid,
  Calendar,
  Settings,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  X,
  Check,
  Plus,
  Minus,
  Trash2,
  Edit2,
  Phone,
  MessageSquare,
  MessageCircle,
  Mail,
  FileText,
  Download,
  Upload,
  Share2,
  Camera,
  Mic,
  Bell,
  BellOff,
  User,
  Users,
  Building2,
  Briefcase,
  Clock,
  AlertTriangle,
  Info,
  Search,
  Filter,
  MoreVertical,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Star,
  Zap,
  TrendingUp,
  BarChart2,
  PieChart,
  Map,
  Navigation,
  Send,
  Copy,
  ExternalLink,
  Link,
  Paperclip,
  Image,
  Loader2,
  CheckCircle2,
  CircleCheck,
  XCircle,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ClipboardList,
  Hammer,
  ReceiptText,
} from 'lucide-react';

// ── Custom inline SVG glyphs ─────────────────────────────────────────────────
// Used when no Lucide icon exists for the semantic meaning.

function GbpGlyph({ size, strokeWidth, ...svgProps }) {
  // A clean "£" SVG path that obeys currentColor, mirrors Lucide's visual weight,
  // and sits on the same 24×24 viewBox so size tokens work identically.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
    >
      {/* Vertical stem */}
      <line x1="9" y1="7" x2="9" y2="17" />
      {/* Top arch of £ */}
      <path d="M9 7 C9 4.5 13.5 4.5 13.5 7 C13.5 9 11 10 9 10" />
      {/* Crossbar */}
      <line x1="7" y1="13" x2="13" y2="13" />
      {/* Base with flick */}
      <path d="M7 17 L15 17" />
    </svg>
  );
}

// ── Semantic registry ────────────────────────────────────────────────────────
// Key = semantic name callers use. Value = Lucide component OR a custom fn.
// Add future-wave entries here; callers never change.

const REGISTRY = {
  // Navigation
  today:    Home,
  jobs:     LayoutGrid,
  schedule: Calendar,
  money:    GbpGlyph,       // custom: no Lucide £ glyph
  settings: Settings,

  // Disclosure / wayfinding
  'chevron-right':  ChevronRight,
  'chevron-down':   ChevronDown,
  'chevron-left':   ChevronLeft,
  'chevron-up':     ChevronUp,
  'arrow-left':     ArrowLeft,
  'arrow-right':    ArrowRight,
  close:            X,

  // Actions
  check:    Check,
  add:      Plus,
  remove:   Minus,
  delete:   Trash2,
  edit:     Edit2,
  send:     Send,
  copy:     Copy,
  share:    Share2,
  download: Download,
  upload:   Upload,
  refresh:  RefreshCw,
  search:   Search,
  filter:   Filter,
  more:     MoreVertical,
  'more-h': MoreHorizontal,
  link:     Link,
  'external-link': ExternalLink,
  attach:   Paperclip,

  // Communication
  phone:   Phone,
  sms:     MessageSquare,
  email:   Mail,
  bell:    Bell,
  'bell-off': BellOff,

  // Content / media
  file:    FileText,
  image:   Image,
  camera:  Camera,
  mic:     Mic,

  // People / business
  user:     User,
  team:     Users,
  business: Building2,
  job:      Briefcase,

  // Status / feedback
  clock:    Clock,
  warning:  AlertTriangle,
  info:     Info,
  success:  CheckCircle2,
  error:    XCircle,
  alert:    AlertCircle,
  help:     HelpCircle,
  loading:  Loader2,
  star:     Star,

  // Wave 2 — Jobs/Work pipeline stages
  lead:          ClipboardList,  // 📋 pipeline lead / job list
  'quote-sent':  Send,           // 📨 quote out / sent
  'active-job':  Hammer,         // 🔨 job on / active
  invoice:       ReceiptText,    // 🧾 invoiced
  complete:      CircleCheck,    // ✅ job complete
  paid:          CircleCheck,    // 💷 paid (brand variant applied at call site)
  overdue:       AlertTriangle,  // 🚨 overdue / final notice
  'chase-firm':  Clock,          // ⏰ firm reminder (danger variant at call site)
  chase:         MessageCircle,  // 💬 friendly nudge

  // Data / finance
  'trend-up':  TrendingUp,
  'bar-chart': BarChart2,
  'pie-chart': PieChart,
  sparkles:    Sparkles,
  zap:         Zap,

  // Maps / location
  map:      Map,
  navigate: Navigation,

  // Auth
  lock:   Lock,
  unlock: Unlock,
  eye:    Eye,
  'eye-off': EyeOff,
};

// ── Variant → CSS custom property ───────────────────────────────────────────
// Maps the prop value to the project's existing token names in index.css.
// "inherit" is omitted on purpose — we set no `color` style so currentColor
// falls through to whatever the parent sets.

const VARIANT_COLOR = {
  muted:   'var(--text-dim)',
  brand:   'var(--accent)',
  danger:  'var(--danger)',
  success: 'var(--accent)',   // no --success token; brand green reads as positive
};

// ── Component ────────────────────────────────────────────────────────────────

export default function Icon({
  name,
  size = 20,
  variant = 'inherit',
  strokeWidth,
  label,
  className = '',
}) {
  const LucideComponent = REGISTRY[name];

  if (!LucideComponent) {
    if (import.meta.env.DEV) {
      console.warn(`[Icon] Unknown semantic name: "${name}". Add it to REGISTRY in Icon.jsx.`);
    }
    return null;
  }

  // strokeWidth: caller can override; otherwise auto 1.5 at 32px, else 2
  const sw = strokeWidth ?? (size === 32 ? 1.5 : 2);

  // Accessibility: decorative unless caller provides a label
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true' };

  // Colour: only set the style prop when we have a mapping; otherwise inherit
  const colorStyle = VARIANT_COLOR[variant] ? { color: VARIANT_COLOR[variant] } : undefined;

  return (
    <span
      className={`jp-icon${className ? ` ${className}` : ''}`}
      style={colorStyle}
      {...a11y}
    >
      <LucideComponent
        size={size}
        strokeWidth={sw}
        aria-hidden="true"
      />
    </span>
  );
}
