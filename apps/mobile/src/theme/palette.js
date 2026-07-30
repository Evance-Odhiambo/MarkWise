// src/theme/palette.js
// Raw color tokens — hex values only, no semantics.
// Import this in theme.js and colors.js; never import directly into screens.

const palette = {

  // ── Indigo (primary action) ───────────────────────────────────────────────
  indigo200: '#C7D2FE',
  indigo600: '#4F46E5',
  indigo700: '#4338CA',

  // ── Purple ───────────────────────────────────────────────────────────────
  purple400: '#A78BFA',
  purple600: '#7C3AED',
  purple700: '#6D28D9',

  // ── Emerald (success) ────────────────────────────────────────────────────
  emerald400: '#34D399',
  emerald500: '#10B981',
  emerald600: '#059669',

  // ── Amber (warning / secondary) ──────────────────────────────────────────
  amber300: '#FBBF24',
  amber500: '#F59E0B',
  amber600: '#D97706',

  // ── Red (error / danger) ─────────────────────────────────────────────────
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',

  // ── Blue (info) ───────────────────────────────────────────────────────────
  blue400: '#60A5FA',
  blue500: '#3B82F6',
  blue700: '#1D4ED8',

  // ── Teal ─────────────────────────────────────────────────────────────────
  teal400: '#2DD4BF',
  teal500: '#14B8A6',
  teal600: '#0D9488',

  // ── Pink ─────────────────────────────────────────────────────────────────
  pink400: '#F472B6',
  pink500: '#EC4899',
  pink700: '#BE185D',

  // ── Slate (neutral scale) ─────────────────────────────────────────────────
  slate50:  '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',

  // ── Learning-optimized warm neutrals ─────────────────────────────────────
  // Warm off-white reduces blue-light glare and eye strain during prolonged reading.
  // Chosen for primary app backgrounds in light mode.
  warm50:   '#FDFBF7',   // warm paper-white — primary page background
  warm100:  '#F7F5F0',   // warm light gray — secondary surfaces
  warm900:  '#1C1C1E',   // warm near-black — dark mode page background (softer than slate900)

  // ── Premium / badge tiers ────────────────────────────────────────────────
  gold:     '#FFD700',
  silver:   '#C0C0C0',
  bronze:   '#CD7F32',
  diamond:  '#B9F2FF',
  platinum: '#E5E4E2',

  // ── Base ─────────────────────────────────────────────────────────────────
  white:       '#FFFFFF',
  black:       '#000000',
  transparent: 'transparent',
};

export default palette;
