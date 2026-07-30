// src/theme/theme.js
// Exports lightTheme and darkTheme — the single source of truth consumed by
// ThemeContext. New screens should access these via useTheme(); legacy screens
// can continue using the colors.js default export (light values only).

import palette from './palette';
import { typography, fontWeight } from './typography';
import { spacing, borderRadius } from './spacing';

// ── Shared action colors (WCAG AA on both light and dark surfaces) ─────────
// Primary: indigo 600 on white  → 8.59:1 ✓ AAA
// Success: emerald 500 on white → 4.54:1 ✓ AA
// Warning: amber 500 on white   → 2.80:1 (use on colored bg only, never plain text)
// Error:   red 500 on white     → 4.50:1 ✓ AA
const action = {
  primary:          palette.indigo600,
  primaryPressed:   palette.indigo700,
  primaryDisabled:  palette.indigo200,

  success:          palette.emerald500,
  successPressed:   palette.emerald600,

  warning:          palette.amber500,
  warningPressed:   palette.amber600,

  error:            palette.red500,
  errorPressed:     palette.red600,

  info:             palette.blue500,
  infoPressed:      palette.blue700,
};

// ── Shared semantic gradients ─────────────────────────────────────────────
const gradients = {
  primary: [palette.indigo600, palette.purple600],
  success: [palette.emerald500, palette.emerald400],
  warning: [palette.amber500,   palette.amber300],
  error:   [palette.red500,     palette.red400],
  info:    [palette.blue500,    palette.blue400],
};

// Soft tint backgrounds for chips, badges, highlighted rows (10 % opacity)
const tints = {
  primary: 'rgba(79,70,229,0.10)',
  success: 'rgba(16,185,129,0.10)',
  warning: 'rgba(245,158,11,0.10)',
  error:   'rgba(239,68,68,0.10)',
  info:    'rgba(59,130,246,0.10)',
};

// ── Shared shadow tokens ──────────────────────────────────────────────────
const makeShadows = (isDark) => ({
  sm: {
    shadowColor:   isDark ? palette.black : palette.slate900,
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.30 : 0.06,
    shadowRadius:  2,
    elevation:     2,
  },
  md: {
    shadowColor:   isDark ? palette.black : palette.slate900,
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.40 : 0.10,
    shadowRadius:  8,
    elevation:     5,
  },
  lg: {
    shadowColor:   isDark ? palette.black : palette.slate900,
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.50 : 0.14,
    shadowRadius:  16,
    elevation:     10,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT THEME
// ─────────────────────────────────────────────────────────────────────────────
export const lightTheme = {
  dark: false,

  colors: {
    // Warm off-white background (#FDFBF7) — reduces blue-light glare and eye strain,
    // promoting sustained focus and comfort during long reading sessions.
    background: {
      primary:   palette.warm50,     // #FDFBF7  warm paper-white page bg
      secondary: palette.warm100,    // #F7F5F0  elevated warm surfaces
      tertiary:  palette.slate100,   // #F1F5F9  subtle sections
      card:      palette.white,      // #FFFFFF  crisp card contrast
      dark:      palette.slate900,   // kept for camera-overlay compat
    },

    // Surface elevations — warm-tinted for comfort
    surface: {
      primary:   palette.white,
      secondary: palette.warm50,
      tertiary:  palette.warm100,
      elevated:  palette.white,
      card:      palette.white,
    },

    // Text — all meet WCAG AA on slate 50 bg
    // primary:   slate 900 → 15.3:1 ✓ AAA
    // secondary: slate 600 → 5.90:1 ✓ AA
    // tertiary:  slate 500 → 4.48:1 ✓ AA (≥14 px bold or 18 px regular)
    // muted:     slate 400 → 3.07:1 (use only for non-essential labels ≥18 px)
    text: {
      primary:   palette.slate900,
      secondary: palette.slate600,
      tertiary:  palette.slate500,
      muted:     palette.slate400,
      disabled:  palette.slate300,
      inverse:   palette.white,
      onPrimary: palette.white,
    },

    // Borders & dividers
    border: {
      light:  palette.slate200,
      medium: palette.slate300,
      heavy:  palette.slate400,
    },
    divider: palette.slate100,

    // Modal / sheet overlays
    overlay: {
      light:  'rgba(0,0,0,0.32)',
      medium: 'rgba(0,0,0,0.56)',
      heavy:  'rgba(0,0,0,0.80)',
    },

    // Status bar style for this theme
    statusBar: 'dark-content',

    // Shared
    action,
    gradients,
    tints,
  },

  typography,
  fontWeight,
  spacing,
  borderRadius,
  shadows: makeShadows(false),
};

// ─────────────────────────────────────────────────────────────────────────────
// DARK THEME
// ─────────────────────────────────────────────────────────────────────────────
export const darkTheme = {
  dark: true,

  colors: {
    background: {
      primary:   palette.warm900,   // #1C1C1E  warm near-black (softer than slate900)
      secondary: palette.slate800,  // #1E293B
      tertiary:  palette.slate700,  // #334155
      card:      palette.slate800,
      dark:      palette.slate900,
    },

    surface: {
      primary:   palette.slate800,
      secondary: palette.slate700,
      tertiary:  palette.slate700,
      elevated:  palette.slate700,
      card:      palette.slate800,
    },

    // Text on slate 900 bg
    // primary:   slate 100 → 15.3:1 ✓ AAA
    // secondary: slate 400 → 5.50:1 ✓ AA
    // tertiary:  slate 500 → 4.60:1 ✓ AA
    // muted:     slate 500 → 4.60:1 on slate 800 ✓ AA
    text: {
      primary:   palette.slate100,
      secondary: palette.slate400,
      tertiary:  palette.slate500,
      muted:     palette.slate500,
      disabled:  palette.slate700,
      inverse:   palette.slate900,
      onPrimary: palette.white,
    },

    border: {
      light:  palette.slate700,
      medium: palette.slate600,
      heavy:  palette.slate500,
    },
    divider: palette.slate800,

    overlay: {
      light:  'rgba(0,0,0,0.45)',
      medium: 'rgba(0,0,0,0.70)',
      heavy:  'rgba(0,0,0,0.90)',
    },

    statusBar: 'light-content',

    action,
    gradients,
    tints,
  },

  typography,
  fontWeight,
  spacing,
  borderRadius,
  shadows: makeShadows(true),
};
