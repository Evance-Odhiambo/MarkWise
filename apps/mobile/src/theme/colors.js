// src/theme/colors.js
// Backward-compatible light-mode singleton used by legacy screens.
// All values are derived from palette.js — no magic strings here.
//
// New screens: use `useTheme()` from 'src/theme' instead.
// This file always reflects the LIGHT theme.

import palette from './palette';

const colors = {

  // ── Brand / semantic colors ───────────────────────────────────────────────
  primary: {
    main:     palette.indigo600,                   // #4F46E5
    light:    palette.indigo200,                   // #C7D2FE
    dark:     palette.indigo700,                   // #4338CA
    gradient: [palette.indigo600, palette.purple600],
    soft:     'rgba(79,70,229,0.10)',
    disabled: palette.indigo200,
  },
  secondary: {
    main:     palette.amber500,
    light:    palette.amber300,
    dark:     palette.amber600,
    gradient: [palette.amber500, palette.amber300],
    soft:     'rgba(245,158,11,0.10)',
  },
  success: {
    main:     palette.emerald500,
    light:    palette.emerald400,
    dark:     palette.emerald600,
    gradient: [palette.emerald500, palette.emerald400],
    soft:     'rgba(16,185,129,0.10)',
  },
  danger: {
    main:     palette.red500,
    light:    palette.red400,
    dark:     palette.red600,
    gradient: [palette.red500, palette.red400],
    soft:     'rgba(239,68,68,0.10)',
  },
  warning: {
    main:     palette.amber500,
    light:    palette.amber300,
    dark:     palette.amber600,
    gradient: [palette.amber500, palette.amber300],
    soft:     'rgba(245,158,11,0.10)',
  },
  info: {
    main:     palette.blue500,
    light:    palette.blue400,
    dark:     palette.blue700,
    gradient: [palette.blue500, palette.blue400],
    soft:     'rgba(59,130,246,0.10)',
  },
  purple: {
    main:     palette.purple600,
    light:    palette.purple400,
    dark:     palette.purple700,
    gradient: [palette.purple600, palette.purple400],
    soft:     'rgba(124,58,237,0.10)',
  },
  pink: {
    main:     palette.pink500,
    light:    palette.pink400,
    dark:     palette.pink700,
    gradient: [palette.pink500, palette.pink400],
    soft:     'rgba(236,72,153,0.10)',
  },
  teal: {
    main:     palette.teal500,
    light:    palette.teal400,
    dark:     palette.teal600,
    gradient: [palette.teal500, palette.teal400],
    soft:     'rgba(20,184,166,0.10)',
  },

  // ── Light theme chrome (page / surface / text / border) ──────────────────
  background: {
    primary:   palette.slate50,    // #c2d8ee  page
    secondary: palette.slate100,   // #F1F5F9
    tertiary:  palette.slate200,   // #E2E8F0
    card:      palette.white,      // #FFFFFF
    dark:      palette.slate900,   // kept for camera-overlay compat
  },
  surface: {
    primary:   palette.white,
    secondary: palette.slate50,
    tertiary:  palette.slate100,
    elevated:  palette.white,
    card:      palette.white,
  },
  text: {
    primary:   palette.slate900,   // 15.3:1 on slate-50 ✓ AAA
    secondary: palette.slate600,   //  5.9:1 on slate-50 ✓ AA
    tertiary:  palette.slate500,   //  4.5:1 on slate-50 ✓ AA
    muted:     palette.slate400,
    disabled:  palette.slate300,
    inverse:   palette.white,
  },
  border: {
    light:  palette.slate200,
    medium: palette.slate300,
    heavy:  palette.slate400,
  },
  overlay: {
    light:  'rgba(0,0,0,0.32)',
    medium: 'rgba(0,0,0,0.56)',
    heavy:  'rgba(0,0,0,0.80)',
  },

  // ── Achievement / badge tiers ─────────────────────────────────────────────
  premium: {
    gold:     palette.gold,
    silver:   palette.silver,
    bronze:   palette.bronze,
    diamond:  palette.diamond,
    platinum: palette.platinum,
  },

  // ── Legacy light sub-object (used by some screens for nested lookups) ─────
  light: {
    background: {
      primary:   palette.slate50,
      secondary: palette.slate100,
      tertiary:  palette.slate200,
    },
    surface: {
      primary:   palette.white,
      secondary: palette.slate50,
      elevated:  palette.white,
    },
    text: {
      primary:   palette.slate900,
      secondary: palette.slate600,
      tertiary:  palette.slate500,
      muted:     palette.slate400,
    },
    border: {
      light:  palette.slate200,
      medium: palette.slate300,
    },
  },
};

export default colors;
